import { requestClient } from "@/lib/server";
import { storageAdapter, storageProvider } from "@/lib/storage-provider";
import { dropboxProjectFolder } from "@/lib/dropbox-storage";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const client = await requestClient(request),
      form = await request.formData(),
      workspace = z.string().uuid().parse(form.get("workspace")),
      project = z.string().uuid().parse(form.get("project"));
    const { data: allowed, error: denied } = await client.rpc("project_staff", {
      w: workspace,
      p: project,
    });
    if (denied || !allowed)
      return Response.json(
        { error: "You need project access to upload files." },
        { status: 403 },
      );
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
      return Response.json(
        { error: "Choose a file up to 10 MB." },
        { status: 400 },
      );
    const provider = storageProvider();
    if (provider === "dropbox" && file.size > 4 * 1024 * 1024)
      return Response.json(
        { error: "Choose a file up to 4 MB for Dropbox uploads." },
        { status: 400 },
      );
    const storage = storageAdapter(provider, client);
    let folder = `${workspace}/${project}`;
    if (provider === "dropbox") {
      const { data: details, error: projectError } = await client
        .from("projects")
        .select("id,name,client_name")
        .eq("workspace_id", workspace)
        .eq("id", project)
        .single();
      if (projectError || !details) throw Error("Project unavailable.");
      // Reuse the original folder after project/client renames.
      const { data: existing, error: lookupError } = await client
        .from("project_files")
        .select("path")
        .eq("workspace_id", workspace)
        .eq("project_id", project)
        .eq("provider", "dropbox")
        .order("created_at")
        .limit(1);
      if (lookupError) throw Error("Could not check the project folder.");
      folder =
        existing?.[0]?.path.slice(0, existing[0].path.lastIndexOf("/")) ||
        dropboxProjectFolder(workspace, details);
    }
    const path = await storage.upload(
      folder,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    const { error } = await client.from("project_files").insert({
      workspace_id: workspace,
      project_id: project,
      path,
      name: file.name,
      provider,
    });
    if (error) {
      // Compensate for a rejected database record so it does not leave a duplicate on retry.
      await storage.remove(path);
      throw Error("The file record could not be saved. Please try again.");
    }
    return Response.json({ path });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function GET(request: Request) {
  try {
    const client = await requestClient(request),
      path = new URL(request.url).searchParams.get("path") || "";
    if (new URL(request.url).searchParams.get("configuration") === "true") {
      const provider = storageProvider();
      return Response.json(
        { provider, maxUploadMB: provider === "dropbox" ? 4 : 10 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data: file } = await client
      .from("project_files")
      .select("provider")
      .eq("path", path)
      .maybeSingle();
    if (!file)
      return Response.json({ error: "File not found." }, { status: 404 });
    const storage = storageAdapter(file.provider, client);
    return Response.json(
      { url: await storage.signedUrl(path) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Unable to open this file." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const client = await requestClient(request),
      path = new URL(request.url).searchParams.get("path") || "";
    const { data: file } = await client
      .from("project_files")
      .select("*")
      .eq("path", path)
      .maybeSingle();
    if (!file)
      return Response.json({ error: "File not found." }, { status: 404 });
    const {
      data: { user },
    } = await client.auth.getUser();
    const { data: manager } = await client.rpc("project_manager", {
      w: file.workspace_id,
      p: file.project_id,
    });
    const { data: staff } = await client.rpc("project_staff", {
      w: file.workspace_id,
      p: file.project_id,
    });
    if (!manager && !(staff && file.created_by === user?.id))
      return Response.json(
        { error: "Only the uploader or a project owner can delete this file." },
        { status: 403 },
      );
    const storage = storageAdapter(file.provider, client);
    const { error: evidenceError } = await client.rpc(
      "prepare_project_file_delete",
      { file_path: path },
    );
    if (evidenceError)
      return Response.json({ error: evidenceError.message }, { status: 409 });
    await storage.remove(path);
    const { data, error } = await client
      .from("project_files")
      .delete()
      .eq("id", file.id)
      .select("id");
    if (error || !data?.length)
      throw Error(
        "File contents removed, but the record could not be removed. Retry to finish.",
      );
    return Response.json({ deleted: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
