import { serviceDB } from "./service-db";
/** Signed upload capabilities expire after two hours; sweep after three to catch late uploads too. */
export async function cleanupStagedUploads() {
  const db = serviceDB();
  const result = await db
    .from("collaboration_blobs")
    .select("id,workspace_id,ready")
    .eq("upload_staged", true)
    .lt("created_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
    .limit(100);
  if (result.error) throw result.error;
  for (const b of result.data || []) {
    const removed = await db.storage
      .from("collaboration-staging")
      .remove([`${b.workspace_id}/${b.id}`]);
    if (removed.error) continue;
    if (b.ready)
      await db
        .from("collaboration_blobs")
        .update({ upload_staged: false })
        .eq("id", b.id);
    else {
      const attachments = await db
        .from("discussion_attachments")
        .delete()
        .eq("blob_id", b.id);
      if (!attachments.error)
        await db
          .from("collaboration_blobs")
          .delete()
          .eq("id", b.id)
          .eq("ready", false);
    }
  }
}

/** Catch abandoned objects whose parent workspace was deleted before its ticket expired. */
export async function cleanupDetachedStaging() {
  const db = serviceDB(),
    storage = db.storage.from("collaboration-staging");
  const folders = await storage.list("", { limit: 1000 });
  if (folders.error) throw folders.error;
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const folder of folders.data || []) {
    if (folder.id) continue;
    const objects = await storage.list(folder.name, {
      limit: 1000,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (objects.error) continue;
    const expired = (objects.data || [])
      .filter((x) => x.id && Date.parse(x.created_at || "") < cutoff)
      .map((x) => `${folder.name}/${x.name}`);
    if (expired.length) await storage.remove(expired);
  }
}
