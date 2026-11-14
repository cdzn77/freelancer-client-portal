import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "./adapters";

// Server only. App-folder access limits this integration to its own Dropbox folder.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function folderLabel(value: string, fallback = "Untitled") {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9 ._-]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 70) || fallback
  );
}
export function dropboxProjectFolder(
  workspace: string,
  project: { id: string; name: string; client_name?: string | null },
) {
  if (!UUID.test(workspace) || !UUID.test(project.id))
    throw Error("Invalid project folder.");
  return `${workspace}/${project.id}/Clients/${folderLabel(project.client_name || "Studio")}/Projects/${folderLabel(project.name)}--${project.id}/Files`;
}
export function dropboxPath(path: string) {
  const [workspace, project, ...parts] = path.split("/");
  if (
    !UUID.test(workspace || "") ||
    !UUID.test(project || "") ||
    parts.length !== 6 ||
    parts[0] !== "Clients" ||
    parts[2] !== "Projects" ||
    parts[4] !== "Files" ||
    !parts[3]?.endsWith(`--${project}`) ||
    parts.some((p) => !p || p === "." || p === ".." || /[\\\x00-\x1f]/.test(p))
  )
    throw Error("Invalid storage path.");
  // Keep the database's workspace/project prefix while arranging readable folders.
  return `/freelancer-client-portal/Workspaces/${workspace}/${parts.join("/")}`;
}
export class DropboxStorage implements StorageAdapter {
  constructor(private transport: typeof fetch = fetch) {}
  private async token() {
    const {
      DROPBOX_APP_KEY: key,
      DROPBOX_APP_SECRET: secret,
      DROPBOX_REFRESH_TOKEN: refresh,
    } = process.env;
    if (!key || !refresh)
      throw Error(
        "Dropbox is not connected. Ask your administrator to complete storage setup.",
      );
    const response = await this.transport(
      "https://api.dropboxapi.com/oauth2/token",
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: key,
          ...(secret ? { client_secret: secret } : {}),
        }),
      },
    );
    if (!response.ok)
      throw Error(
        "Dropbox connection needs attention. Please reconnect storage.",
      );
    const data = await response.json();
    if (typeof data.access_token !== "string")
      throw Error("Dropbox did not authorize storage access.");
    return data.access_token as string;
  }
  private async rpc(endpoint: string, body: object, token: string) {
    return this.transport(`https://api.dropboxapi.com/2/files/${endpoint}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  private async folders(path: string, token: string) {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const response = await this.rpc(
        "create_folder_v2",
        { path: "/" + parts.slice(0, i).join("/"), autorename: false },
        token,
      );
      if (response.ok) continue;
      const result = await response.json().catch(() => ({}));
      // Only an existing folder is benign. A file/name conflict must fail.
      if (
        response.status === 409 &&
        result.error_summary?.startsWith("path/conflict/folder/")
      )
        continue;
      throw Error(
        "Dropbox could not prepare the project folder. Please try again.",
      );
    }
  }
  async upload(folder: string, name: string, body: Uint8Array) {
    const path = `${folder}/${randomUUID()}-${folderLabel(name, "file")}`;
    const remote = dropboxPath(path),
      token = await this.token();
    await this.folders(remote, token);
    const response = await this.transport(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: remote,
            mode: "add",
            autorename: false,
            mute: true,
            strict_conflict: true,
          }),
        },
        body: new Uint8Array(body),
      },
    );
    if (!response.ok)
      throw Error("Dropbox could not save this file. Please try again.");
    return path;
  }
  async signedUrl(path: string) {
    const remote = dropboxPath(path);
    const response = await this.rpc(
      "get_temporary_link",
      { path: remote },
      await this.token(),
    );
    if (!response.ok) throw Error("Dropbox could not open this file.");
    const data = await response.json();
    if (typeof data.link !== "string" || !data.link.startsWith("https://"))
      throw Error("Dropbox returned an invalid file link.");
    return data.link as string;
  }
  async remove(path: string) {
    const remote = dropboxPath(path);
    const response = await this.rpc(
      "delete_v2",
      { path: remote },
      await this.token(),
    );
    if (response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (
      response.status === 409 &&
      data.error_summary?.startsWith("path_lookup/not_found/")
    )
      return;
    throw Error("Dropbox could not remove this file. Please try again.");
  }
}
