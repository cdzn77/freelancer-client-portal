import { requestClient } from "@/lib/server";
import { parseGitHubLink, readGitHubLink } from "@/lib/github-links";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 3000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const input = z.object({ id: z.string().uuid() }).parse(JSON.parse(raw));
    const { data: link, error } = await client
      .from("task_code_links")
      .select("*")
      .eq("id", input.id)
      .single();
    if (error || !link)
      return Response.json({ error: "Link unavailable" }, { status: 404 });
    const allowed = await client.rpc("project_manager", {
      w: link.workspace_id,
      p: link.project_id,
    });
    if (allowed.data !== true)
      return Response.json(
        { error: "Project owner access required" },
        { status: 403 },
      );
    if (link.checked_at && Date.now() - Date.parse(link.checked_at) < 60000)
      return Response.json({
        metadata: link.metadata,
        checked_at: link.checked_at,
      });
    const role = await client.rpc("workspace_role", { w: link.workspace_id });
    const repo = parseGitHubLink(link.url).repo.toLowerCase();
    const approved = (process.env.PMS_GITHUB_REPOSITORIES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase());
    const token =
      role.data === "owner" &&
      process.env.PMS_GITHUB_WORKSPACE_ID === link.workspace_id &&
      approved.includes(repo)
        ? process.env.PMS_GITHUB_READ_TOKEN
        : undefined;
    const metadata = await readGitHubLink(link.url, token);
    const checked_at = new Date().toISOString();
    const saved = await client
      .from("task_code_links")
      .update({ metadata, checked_at })
      .eq("id", link.id);
    if (saved.error) throw saved.error;
    return Response.json({ metadata, checked_at });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not refresh code link" },
      { status: 400 },
    );
  }
}
