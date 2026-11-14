import { DropboxStorage, dropboxProjectFolder } from "../lib/dropbox-storage";
import { randomUUID } from "node:crypto";
async function main() {
  const s = new DropboxStorage();
  const w = randomUUID(),
    p = randomUUID();
  const bytes = Buffer.from(
    "Freelancer Client Portal Dropbox connection test. Disposable sample file.",
  );
  const path = await s.upload(
    dropboxProjectFolder(w, {
      id: p,
      name: "Connection test",
      client_name: "PMS setup test",
    }),
    "connection-test.txt",
    bytes,
  );
  try {
    const link = await s.signedUrl(path);
    const r = await fetch(link);
    if (!r.ok) throw Error("Read failed");
    if (!Buffer.from(await r.arrayBuffer()).equals(bytes))
      throw Error("Contents differ");
    console.log(
      "PASS: Dropbox upload, private download, and matching file contents.",
    );
  } finally {
    await s.remove(path);
    console.log("Disposable file removed. Empty setup folders retained.");
  }
}
main().catch(() => {
  console.error("Dropbox live check failed. No credentials were printed.");
  process.exitCode = 1;
});
