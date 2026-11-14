import {
  cleanupStagedUploads,
  cleanupDetachedStaging,
} from "./collaboration-upload-cleanup";
import { serviceDB } from "./service-db";
import { googleToken, unseal, notificationSender, notificationDomain } from "./google-email";
import { storageAdapter, storageProvider } from "./storage-provider";
import { dropboxProjectFolder } from "./dropbox-storage";
import { attachmentMime } from "./collaboration";
export type ReplyPart = {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: ReplyPart[];
};
export type ReplyMessage = {
  id: string;
  labelIds?: string[];
  payload?: ReplyPart & { headers?: { name: string; value: string }[] };
};
const tokenPattern =
  new RegExp("pms-reply-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@" + notificationDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[>\\s]|$)", "gi");
export function discussionReply(message: ReplyMessage) {
  const hs = message.payload?.headers || [],
    header = (n: string) =>
      hs.find((h) => h.name.toLowerCase() === n)?.value || "";
  if (
    message.labelIds?.some((x) => ["SENT", "SPAM", "TRASH"].includes(x)) ||
    header("list-id") ||
    /^auto-/i.test(header("auto-submitted")) ||
    /^(bulk|list|junk)$/i.test(header("precedence").trim())
  )
    return null;
  const from = header("from").trim(),
    sender = (from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] || from).toLowerCase();
  if (
    hs.filter((h) => h.name.toLowerCase() === "from").length !== 1 ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)
  )
    return null;
  const domain = sender.split("@")[1];
  // The first Google-added Authentication-Results header is authoritative. Reject unauthenticated/forwarded spoofable mail.
  const auth =
    hs.find(
      (h) =>
        h.name.toLowerCase() === "authentication-results" &&
        /^\s*mx\.google\.com;/i.test(h.value),
    )?.value || "";
  const authenticated =
    /\bdmarc=pass\b/i.test(auth) &&
    new RegExp(
      "\\bheader\\.from=" +
        domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "(?:[;\\s]|$)",
      "i",
    ).test(auth);
  if (!authenticated) return null;
  const matches = [
    ...(header("in-reply-to") || header("references")).matchAll(tokenPattern),
  ];
  const token = matches.at(-1)?.[1];
  if (!token) return null;
  const parts: ReplyPart[] = [];
  const walk = (p?: ReplyPart) => {
    if (!p) return;
    parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(message.payload);
  const plain = parts
    .filter((p) => p.mimeType === "text/plain" && !p.filename)
    .map((p) => Buffer.from(p.body?.data || "", "base64url").toString("utf8"))
    .join("\n");
  const html = parts
    .filter((p) => p.mimeType === "text/html" && !p.filename)
    .map((p) => Buffer.from(p.body?.data || "", "base64url").toString("utf8"))
    .join("\n");
  let body =
    plain ||
    html
      .split(/<(?:div|blockquote)[^>]*(?:gmail_quote|type=["']cite)/i)[0]
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  body = body
    .split(/\n(?:On .{0,400}wrote:|>.*|_{5,}|-{5,}\s*Original Message)/i)[0]
    .trim();
  const files = parts.filter(
    (p) => p.filename && p.body && (p.body.attachmentId || p.body.data),
  );
  return { token, sender, body: body.slice(0, 30000), files };
}
async function gmail(token: string, path: string) {
  const r = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    },
  );
  if (!r.ok) throw Error("Google reply access needs attention");
  return r.json();
}
export async function receiveDiscussionReplies() {
  const db = serviceDB();
  const { data: connections, error } = await db
    .from("google_email_connections")
    .select("*")
    .eq("reply_enabled", true);
  if (error) throw Error("Could not read email reply settings");
  let processed = 0;
  const deadline = Date.now() + 120000;
  for (const connection of connections || []) {
    if (Date.now() > deadline) break;
    const lease = await db.rpc("claim_discussion_reply_sync", {
      w: connection.workspace_id,
    });
    if (lease.error || !lease.data) continue;
    try {
      const { data: member } = await db
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", connection.workspace_id)
        .eq("user_id", connection.connected_by)
        .maybeSingle();
      if (member?.role !== "owner" || connection.sender !== notificationSender)
        continue;
      const auth = await googleToken({
        grant_type: "refresh_token",
        refresh_token: unseal(connection.encrypted_refresh_token),
      });
      const query = new URLSearchParams({
        maxResults: "20",
        q: `to:${notificationSender} newer_than:30d -in:sent -in:spam -in:trash`,
      });
      if (connection.reply_page_token)
        query.set("pageToken", connection.reply_page_token);
      const listing = await gmail(auth.access_token, "messages?" + query);
      let completedPage = true;
      for (const item of listing.messages || []) {
        if (Date.now() > deadline) {
          completedPage = false;
          break;
        }
        const providerId = `gmail:${connection.workspace_id}:${item.id}`;
        const { data: seen } = await db
          .from("discussion_email_receipts")
          .select("provider_id,attachments_complete")
          .eq("provider_id", providerId)
          .maybeSingle();
        if (seen?.attachments_complete) continue;
        const metadataParams = new URLSearchParams({ format: "metadata" });
        for (const h of [
          "From",
          "In-Reply-To",
          "References",
          "Authentication-Results",
          "Auto-Submitted",
          "Precedence",
          "List-Id",
        ])
          metadataParams.append("metadataHeaders", h);
        const metadata = await gmail(
          auth.access_token,
          `messages/${encodeURIComponent(item.id)}?${metadataParams}`,
        );
        const candidate = discussionReply(metadata);
        if (!candidate) continue;
        const { data: reply } = await db
          .from("discussion_email_replies")
          .select("*,discussion_threads(workspace_id,project_id)")
          .eq("token", candidate.token)
          .maybeSingle();
        if (
          !reply ||
          reply.discussion_threads?.workspace_id !== connection.workspace_id
        )
          continue;
        const recipient = await db.auth.admin.getUserById(reply.user_id);
        if (
          !recipient.data.user?.email_confirmed_at ||
          recipient.data.user.email?.toLowerCase() !== candidate.sender
        )
          continue;
        const allowed = await db.rpc("discussion_recipient_allowed", {
          t: reply.thread_id,
          u: reply.user_id,
        });
        if (
          allowed.error ||
          !allowed.data ||
          new Date(reply.expires_at).getTime() < Date.now()
        )
          continue;
        const full = await gmail(
            auth.access_token,
            `messages/${encodeURIComponent(item.id)}?format=full`,
          ),
          parsed = discussionReply(full);
        if (!parsed || (!parsed.body && !parsed.files.length)) continue;
        const imported = await db.rpc("receive_discussion_email", {
          p_token: parsed.token,
          p_sender: parsed.sender,
          p_provider_id: providerId,
          p_body: (
            (parsed.body || "Files sent by email.") +
            (parsed.files.length > 10 ||
            parsed.files.some((f) => (f.body?.size || 0) > 4 * 1024 * 1024)
              ? "\n\nSome email attachments exceed the limit (10 files, 4 MB each). Please upload them in the project."
              : "")
          ).slice(0, 30000),
        });
        if (imported.error) continue;
        let filesComplete = true;
        for (const [index, file] of parsed.files.slice(0, 10).entries()) {
          if ((file.body?.size || 0) > 4 * 1024 * 1024) continue;
          if (Date.now() > deadline) {
            filesComplete = false;
            break;
          }
          const fileKey = file.partId || String(index);
          const existing = await db
            .from("collaboration_blobs")
            .select("id")
            .eq("email_source", providerId + ":" + fileKey)
            .maybeSingle();
          if (existing.error) {
            filesComplete = false;
            continue;
          }
          if (existing.data) continue;
          let path: string | undefined;
          const provider = storageProvider();
          const adapter = storageAdapter(provider, db);
          try {
            const content = file.body?.attachmentId
              ? await gmail(
                  auth.access_token,
                  `messages/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(file.body.attachmentId)}`,
                )
              : file.body;
            const bytes = Buffer.from(content?.data || "", "base64url");
            if (!bytes.length || bytes.length > 4 * 1024 * 1024) continue;
            const { data: project } = await db
              .from("projects")
              .select("id,name,client_name")
              .eq("id", reply.discussion_threads.project_id)
              .single();
            if (!project) continue;
            const folder =
              provider === "dropbox"
                ? dropboxProjectFolder(connection.workspace_id, project)
                : `${connection.workspace_id}/${project.id}`;
            path = await adapter.upload(folder, file.filename!, bytes);
            const saved = await db.rpc("receive_discussion_attachment", {
              p_token: parsed.token,
              p_provider_id: providerId,
              p_file_key: fileKey,
              p_name: file.filename!.slice(0, 250),
              p_mime: attachmentMime(bytes, file.filename!),
              p_size: bytes.length,
              p_provider: provider,
              p_path: path,
            });
            if (saved.error) throw Error("Attachment import failed");
            if (!saved.data) {
              await adapter.remove(path);
              path = undefined;
            }
          } catch {
            filesComplete = false;
            if (path) await adapter.remove(path).catch(() => {});
          }
        }
        if (filesComplete)
          await db
            .from("discussion_email_receipts")
            .update({ attachments_complete: true })
            .eq("provider_id", providerId);
        else {
          completedPage = false;
          break;
        }
        processed++;
      }
      await db
        .from("google_email_connections")
        .update({
          reply_page_token: completedPage
            ? listing.nextPageToken || null
            : connection.reply_page_token,
          reply_checked_at: new Date().toISOString(),
          reply_last_error: completedPage
            ? null
            : "An email reply or attachment is still importing. It will retry on the next sync.",
        })
        .eq("workspace_id", connection.workspace_id);
    } catch {
      await db
        .from("google_email_connections")
        .update({
          reply_page_token: null,
          reply_last_error:
            "Reply sync needs attention. Reconnect Google with reply access.",
        })
        .eq("workspace_id", connection.workspace_id);
    } finally {
      await db
        .from("google_email_connections")
        .update({ reply_locked_until: null })
        .eq("workspace_id", connection.workspace_id);
    }
  }
  return { processed };
}
export async function collaborationMaintenance() {
  await cleanupStagedUploads();
  await cleanupDetachedStaging();
  const db = serviceDB(),
    reminders = await db.rpc("process_discussion_reminders");
  if (reminders.error) throw Error("Could not process discussion reminders");
  const orphaned = await db.rpc("collaboration_orphan_blobs");
  for (const blob of orphaned.data || []) {
    try {
      if (blob.path) await storageAdapter(blob.provider, db).remove(blob.path);
      await db.from("collaboration_blobs").delete().eq("id", blob.id);
    } catch {
      /* Retain metadata for the next cleanup attempt. */
    }
  }
  return { reminders: reminders.data, ...(await receiveDiscussionReplies()) };
}
