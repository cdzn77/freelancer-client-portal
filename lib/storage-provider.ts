import type { SupabaseClient } from "@supabase/supabase-js";
import { S3Storage, SupabaseStorage } from "./adapters";
import { DropboxStorage } from "./dropbox-storage";
export function storageProvider() {
  const provider = process.env.STORAGE_PROVIDER || "supabase";
  if (!["supabase", "minio", "r2", "dropbox"].includes(provider))
    throw Error("Storage provider is not configured correctly.");
  return provider;
}
export function storageAdapter(provider: string, client: SupabaseClient) {
  if (provider === "supabase") return new SupabaseStorage(client);
  if (provider === "dropbox") return new DropboxStorage();
  if (provider === "minio" || provider === "r2") return new S3Storage();
  throw Error("Unsupported file storage provider.");
}
