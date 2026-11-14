import { serviceDB } from "./service-db";
import { storageAdapter } from "./storage-provider";
export async function cleanupTrashFiles(workspace?: string) {
  const db = serviceDB();
  let query = db
    .from("trash_file_cleanup")
    .select("*")
    .order("created_at")
    .limit(50);
  if (workspace) query = query.eq("workspace_id", workspace);
  const { data, error } = await query;
  if (error) throw Error("Could not check file cleanup");
  for (const file of data || []) {
    try {
      if (!file.path.startsWith(`${file.workspace_id}/`)) continue;
      const storage = storageAdapter(file.provider, db);
      await storage.remove(file.path);
      await db.from("trash_file_cleanup").delete().eq("id", file.id);
    } catch {
      /* Keep the durable job for the next scheduled attempt. */
    }
  }
  let pending = db
    .from("trash_file_cleanup")
    .select("id", { count: "exact", head: true });
  if (workspace) pending = pending.eq("workspace_id", workspace);
  const result = await pending;
  if (result.error) throw Error("Could not verify file cleanup");
  return result.count || 0;
}
