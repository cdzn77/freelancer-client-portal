import assert from "node:assert/strict";
import {
  DropboxStorage,
  dropboxPath,
  dropboxProjectFolder,
} from "../lib/dropbox-storage";
import { storageAdapter, storageProvider } from "../lib/storage-provider";
const w = "11111111-1111-4111-8111-111111111111",
  p = "22222222-2222-4222-8222-222222222222";
const folder = dropboxProjectFolder(w, {
  id: p,
  name: "Brand / launch",
  client_name: "Acme",
});
const path = `${folder}/receipt.pdf`;
assert.equal(
  dropboxPath(path),
  `/freelancer-client-portal/Workspaces/${w}/Clients/Acme/Projects/Brand - launch--${p}/Files/receipt.pdf`,
);
for (const invalid of [
  "/etc/passwd",
  `${folder}/../secret`,
  path.replace(`--${p}`, "--other"),
  path.replace("receipt.pdf", "bad\\file"),
])
  assert.throws(() => dropboxPath(invalid));
process.env.DROPBOX_APP_KEY = "test-key";
process.env.DROPBOX_APP_SECRET = "test-secret";
process.env.DROPBOX_REFRESH_TOKEN = "test-refresh";
let fail = "",
  uploads: any[] = [],
  calls: string[] = [];
const transport: typeof fetch = async (url, options) => {
  const endpoint = String(url);
  calls.push(endpoint);
  if (endpoint.endsWith("/token")) {
    if (fail === "token")
      return Response.json({ error: "test-secret" }, { status: 401 });
    return Response.json({ access_token: "test-access" });
  }
  assert.equal((options!.headers as any).Authorization, "Bearer test-access");
  if (endpoint.endsWith("create_folder_v2"))
    return Response.json(
      {
        error_summary:
          fail === "folder" ? "path/conflict/file/" : "path/conflict/folder/",
      },
      { status: 409 },
    );
  if (endpoint.endsWith("/upload")) {
    uploads.push(JSON.parse((options!.headers as any)["Dropbox-API-Arg"]));
    return Response.json({}, { status: fail === "upload" ? 429 : 200 });
  }
  if (endpoint.endsWith("get_temporary_link"))
    return Response.json({ link: "https://example.test/temporary" });
  if (endpoint.endsWith("delete_v2"))
    return Response.json(
      { error_summary: "path_lookup/not_found/" },
      { status: 409 },
    );
  throw Error("Unexpected endpoint");
};
async function main() {
  const storage = new DropboxStorage(transport);
  const first = await storage.upload(
    folder,
    "proof.pdf",
    new Uint8Array([1, 2]),
  );
  const second = await storage.upload(
    folder,
    "proof.pdf",
    new Uint8Array([1, 2]),
  );
  assert.notEqual(
    first,
    second,
    "Same-named versions must not overwrite each other",
  );
  assert.equal(uploads[0].mode, "add");
  assert.equal(uploads[0].autorename, false);
  assert.equal(
    await storage.signedUrl(first),
    "https://example.test/temporary",
  );
  await storage.remove(first); // Missing file is safe for cleanup retries.
  fail = "token";
  await assert.rejects(
    () => storage.upload(folder, "proof.pdf", new Uint8Array([1])),
    /connection needs attention/,
  );
  fail = "folder";
  await assert.rejects(
    () => storage.upload(folder, "proof.pdf", new Uint8Array([1])),
    /prepare the project folder/,
  );
  fail = "upload";
  await assert.rejects(
    () => storage.upload(folder, "proof.pdf", new Uint8Array([1])),
    /could not save/,
  );
  const before = calls.length;
  await assert.rejects(
    () => storage.remove("../../secret"),
    /Invalid storage path/,
  );
  assert.equal(
    calls.length,
    before,
    "Reject invalid paths before contacting Dropbox",
  );
  assert.throws(() => storageAdapter("unknown", {} as any), /Unsupported/);
  process.env.STORAGE_PROVIDER = "dropbox";
  assert.equal(storageProvider(), "dropbox");
  process.env.STORAGE_PROVIDER = "typo";
  assert.throws(storageProvider, /not configured/);
  console.log(
    "PASS: readable folders, path isolation, unique versions, private links, missing-file cleanup, redacted auth errors, conflicts, upload failures, and provider validation.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
