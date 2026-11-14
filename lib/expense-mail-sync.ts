
import { brand } from "./brand";
import { createHash } from "node:crypto";
import { serviceDB } from "./service-db";
import { googleToken, unseal } from "./google-email";
import { receiptCandidate } from "./expense-mail-parser";
export const expenseMailboxes = (process.env.EXPENSE_MAILBOXES || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
export async function syncExpenseMailbox(
  workspace?: string,
  accountId?: string,
) {
  const db = serviceDB();
  const now = new Date().toISOString();
  let q = db
    .from("expense_mail_accounts")
    .select("*")
    .eq("enabled", true)
    .lt("lease_until", now)
    .order("last_attempt", { ascending: true, nullsFirst: true })
    .limit(1);
  if (workspace) q = q.eq("workspace_id", workspace);
  if (accountId) q = q.eq("id", accountId);
  const { data: accounts, error } = await q;
  if (error) throw Error("Mail accounts unavailable");
  const a = accounts?.[0];
  if (!a) return { processed: 0, notice: "No available connected mailbox." };
  const lease = new Date(Date.now() + 180000).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("expense_mail_accounts")
    .update({ lease_until: lease, last_attempt: now })
    .eq("id", a.id)
    .lt("lease_until", now)
    .select("id");
  if (claimError) throw Error("Could not start sync");
  if (!claimed?.length) return { processed: 0 };
  try {
    const { data: owner } = await db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", a.workspace_id)
      .eq("user_id", a.connected_by)
      .maybeSingle();
    if (owner?.role !== "owner")
      throw Error("Reconnect with a workspace administrator.");
    const token = await googleToken({
      grant_type: "refresh_token",
      refresh_token: unseal(a.encrypted_refresh_token),
    });
    const gmail = async (path: string) => {
      const r = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
        {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!r.ok)
        throw Error("Google access needs attention. Reconnect this mailbox.");
      return r.json();
    };
    const start = a.page_token ? a.window_start : a.sync_after,
      end = a.page_token ? a.window_end : Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      maxResults: "10",
      q: `after:${start} before:${end} {subject:receipt subject:invoice subject:subscription subject:payment subject:renewal subject:canceled subject:cancelled subject:refund}`,
    });
    if (a.page_token) params.set("pageToken", a.page_token);
    const page = await gmail("messages?" + params);
    let processed = 0;
    for (const stub of page.messages || []) {
      const message = await gmail(
        "messages/" + encodeURIComponent(stub.id) + "?format=full",
      );
      const { data: connected } = await db
        .from("expense_mail_accounts")
        .select("id")
        .eq("id", a.id)
        .eq("enabled", true)
        .maybeSingle();
      if (!connected) throw Error("Mailbox disconnected or paused");
      const candidate = receiptCandidate(message);
      const key = createHash("sha256")
        .update(
          candidate.rfc_id ||
            JSON.stringify([
              candidate.sender,
              candidate.subject,
              candidate.received_on,
              candidate.excerpt,
            ]),
        )
        .digest("hex");
      const { error: e } = await db
        .from("expense_mail_items")
        .upsert(
          {
            workspace_id: a.workspace_id,
            account_email: a.email,
            message_key: key,
            gmail_id: message.id,
            sender: candidate.sender,
            subject: candidate.subject,
            received_on: candidate.received_on,
            excerpt: candidate.excerpt,
            suggestion: candidate.suggestion,
          },
          { onConflict: "workspace_id,message_key", ignoreDuplicates: true },
        );
      if (e) throw Error("Receipt could not be saved. Sync will retry.");
      processed++;
    }
    const state = page.nextPageToken
      ? { page_token: page.nextPageToken, window_start: start, window_end: end }
      : {
          page_token: null,
          window_start: null,
          window_end: null,
          sync_after: Math.max(1767225600, end - 172800),
          last_sync: now,
        };
    const { error: e } = await db
      .from("expense_mail_accounts")
      .update({ ...state, last_error: null, lease_until: now })
      .eq("id", a.id)
      .eq("lease_until", lease);
    if (e) throw Error("Could not save sync progress.");
    return { processed, more: !!page.nextPageToken, email: a.email };
  } catch {
    await db
      .from("expense_mail_accounts")
      .update({
        last_error:
          "Sync needs attention. Reconnect if Google authorization expired, then retry.",
        lease_until: now,
      })
      .eq("id", a.id)
      .eq("lease_until", lease);
    throw Error(
      "Mailbox sync did not finish. Progress is retained; reconnect or retry.",
    );
  }
}
