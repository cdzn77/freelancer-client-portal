import { z } from "zod";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { storageAdapter, storageProvider } from "@/lib/storage-provider";
import { dropboxProjectFolder } from "@/lib/dropbox-storage";
import { attachmentMime, discussionFileMaxBytes } from "@/lib/collaboration";
export const runtime = "nodejs";
const bucket = "collaboration-staging";
const headers = { "Cache-Control": "private, no-store" };
async function input(request: Request) {
  const text = await request.text();
  if (text.length > 4096) throw Error("Upload request is too large.");
  return JSON.parse(text);
}
export async function POST(request: Request) {
  try {
    const client = await requestClient(request);
    const value = z
      .object({
        thread: z.string().uuid(),
        post: z.string().uuid().nullable(),
        name: z.string().min(1).max(250),
        size: z.number().int().min(1).max(discussionFileMaxBytes),
      })
      .parse(await input(request));
    const reservation = await client.rpc("collab_file_reserve", {
      t: value.thread,
      p: value.post,
      n: value.name,
      m: "application/octet-stream",
      s: value.size,
      provider_name: storageProvider(),
    });
    if (reservation.error) throw reservation.error;
    const db = serviceDB(),
      blob = reservation.data.blob;
    const path = `${reservation.data.workspace}/${blob}`;
    const updated = await db
      .from("collaboration_blobs")
      .update({ upload_staged: true })
      .eq("id", blob);
    if (updated.error) throw updated.error;
    // No upsert: this capability cannot overwrite a completed or concurrently uploaded object.
    const signed = await db.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false });
    if (signed.error) throw signed.error;
    return Response.json({ blob, path, token: signed.data.token }, { headers });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not start upload." },
      { status: 400, headers },
    );
  }
}
export async function PUT(request: Request) {
  const db = serviceDB();
  let claimed: string | undefined,
    uploaded: string | undefined,
    provider = "";
  try {
    const client = await requestClient(request);
    const { data: identity } = await client.auth.getUser();
    const { blob } = z
      .object({ blob: z.string().uuid() })
      .parse(await input(request));
    // Read through client RLS before using service access. Recheck on every completion attempt.
    const attachment = await client
      .from("discussion_attachments")
      .select("id,thread_id,post_id,created_by")
      .eq("blob_id", blob)
      .is("deleted_at", null)
      .single();
    if (attachment.error || attachment.data.created_by !== identity.user?.id)
      throw Error("Upload unavailable.");
    const a = attachment.data;
    const thread = await client
      .from("discussion_threads")
      .select("project_id")
      .eq("id", a.thread_id)
      .is("deleted_at", null)
      .single();
    if (thread.error) throw Error("Conversation unavailable.");
    const project = await client
      .from("projects")
      .select("id,name,client_name,workspace_id,archived_at,deleted_at")
      .eq("id", thread.data.project_id)
      .single();
    if (project.error || project.data.archived_at || project.data.deleted_at)
      throw Error("Active project access required.");
    if (a.post_id) {
      const edit = await client.rpc("collab_editable", { p: a.post_id });
      if (edit.error || !edit.data)
        throw Error("The comment editing window has closed.");
    }
    const existing = await db
      .from("collaboration_blobs")
      .select("*")
      .eq("id", blob)
      .eq("created_by", identity.user!.id)
      .single();
    if (existing.error || !existing.data.upload_staged)
      throw Error("Upload unavailable.");
    if (existing.data.ready) return Response.json({ id: a.id }, { headers });
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const claim = await db
      .from("collaboration_blobs")
      .update({ upload_claimed_at: new Date().toISOString() })
      .eq("id", blob)
      .eq("ready", false)
      .is("upload_claimed_at", null)
      .gt("created_at", cutoff)
      .select("*")
      .maybeSingle();
    if (claim.error || !claim.data)
      throw Error(
        "Upload is processing or expired. Refresh before trying again.",
      );
    claimed = blob;
    provider = claim.data.provider;
    const path = `${project.data.workspace_id}/${blob}`;
    const download = await db.storage.from(bucket).download(path);
    if (download.error) throw download.error;
    if (
      download.data.size !== claim.data.size ||
      download.data.size > discussionFileMaxBytes
    )
      throw Error("Uploaded size does not match the selected file.");
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    const folder =
      provider === "dropbox"
        ? dropboxProjectFolder(project.data.workspace_id, project.data)
        : `${project.data.workspace_id}/${project.data.id}`;
    uploaded = await storageAdapter(provider, db).upload(
      folder,
      claim.data.name,
      bytes,
    );
    // Recheck access after the transfer, before making the attachment visible.
    const allowed = await client.rpc("collab_readable", { t: a.thread_id });
    const stillActive = await client
      .from("projects")
      .select("id")
      .eq("id", project.data.id)
      .is("archived_at", null)
      .is("deleted_at", null)
      .maybeSingle();
    const editable = a.post_id
      ? await client.rpc("collab_editable", { p: a.post_id })
      : { data: true, error: null };
    if (
      allowed.error ||
      !allowed.data ||
      stillActive.error ||
      !stillActive.data ||
      editable.error ||
      !editable.data
    )
      throw Error("Conversation access changed. Upload was not published.");
    const finish = await db
      .from("collaboration_blobs")
      .update({
        path: uploaded,
        mime: attachmentMime(bytes, claim.data.name),
        ready: true,
      })
      .eq("id", blob)
      .eq("ready", false)
      .select("id")
      .single();
    if (finish.error) throw finish.error;
    uploaded = undefined;
    claimed = undefined;
    await db.storage.from(bucket).remove([path]);
    return Response.json({ id: a.id }, { headers });
  } catch (e) {
    if (uploaded)
      await storageAdapter(provider, db)
        .remove(uploaded)
        .catch(() => {});
    if (claimed)
      await db
        .from("collaboration_blobs")
        .update({ upload_claimed_at: null })
        .eq("id", claimed)
        .eq("ready", false);
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not finish upload. Try the file again.",
      },
      { status: 400, headers },
    );
  }
}
