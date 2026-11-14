import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { storageAdapter, storageProvider } from "@/lib/storage-provider";
import { dropboxProjectFolder } from "@/lib/dropbox-storage";
import { attachmentMime } from "@/lib/collaboration";
import { z } from "zod";
export const runtime = "nodejs";
const maxBytes = 4 * 1024 * 1024;
export async function POST(request: Request) {
  let uploaded: string | undefined,
    reserved: string | undefined,
    provider = "";
  try {
    const client = await requestClient(request);
    if (Number(request.headers.get("content-length") || 0) > maxBytes + 16384)
      throw Error("Choose a file up to 4 MB.");
    const form = await request.formData(),
      thread = z.string().uuid().parse(form.get("thread"));
    const post = form.get("post")
      ? z.string().uuid().parse(form.get("post"))
      : null;
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > maxBytes)
      throw Error("Choose a file up to 4 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    provider = storageProvider();
    const reservation = await client.rpc("collab_file_reserve", {
      t: thread,
      p: post,
      n: file.name.slice(0, 250),
      m: attachmentMime(bytes, file.name),
      s: file.size,
      provider_name: provider,
    });
    if (reservation.error) throw reservation.error;
    reserved = reservation.data.blob;
    const db = serviceDB(),
      { workspace, project } = reservation.data;
    let folder = `${workspace}/${project}`;
    if (provider === "dropbox") {
      const { data, error } = await client
        .from("projects")
        .select("id,name,client_name")
        .eq("id", project)
        .single();
      if (error || !data) throw Error("Project unavailable");
      folder = dropboxProjectFolder(workspace, data);
    }
    const adapter = storageAdapter(provider, db);
    uploaded = await adapter.upload(folder, file.name, bytes);
    const finished = await db.rpc("collab_file_finish", {
      b: reserved,
      object_path: uploaded,
    });
    if (finished.error) throw finished.error;
    return Response.json(
      { id: reservation.data.attachment },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (uploaded)
      await storageAdapter(provider, serviceDB())
        .remove(uploaded)
        .catch(() => {});
    if (reserved) {
      const db = serviceDB();
      await db.from("discussion_attachments").delete().eq("blob_id", reserved);
      await db
        .from("collaboration_blobs")
        .delete()
        .eq("id", reserved)
        .eq("ready", false);
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 },
    );
  }
}
export async function GET(request: Request) {
  try {
    const client = await requestClient(request),
      url = new URL(request.url),
      id = z.string().uuid().parse(url.searchParams.get("id"));
    const { data: f, error } = await client
      .from("discussion_attachments")
      .select("blob_id")
      .eq("id", id)
      .single();
    if (error || !f)
      return Response.json({ error: "File unavailable" }, { status: 404 });
    const { data: b, error: blobError } = await client
      .from("collaboration_blobs")
      .select("*")
      .eq("id", f.blob_id)
      .eq("ready", true)
      .single();
    if (blobError || !b)
      return Response.json({ error: "File unavailable" }, { status: 404 });
    const signed = await storageAdapter(b.provider, client).signedUrl(b.path);
    if (url.searchParams.get("format") === "url")
      return Response.json(
        { url: signed },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const upstream = await fetch(signed, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!upstream.ok) throw Error("File storage did not respond. Try again.");
    return new Response(upstream.body, {
      headers: {
        "Content-Type": b.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(b.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json(
      { error: "Could not open this file" },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    const client = await requestClient(request),
      id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const r = await client.rpc("collab_file_remove", { a: id });
    if (r.error) throw r.error;
    return Response.json({ removed: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not remove file" },
      { status: 400 },
    );
  }
}
