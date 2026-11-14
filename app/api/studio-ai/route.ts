import { z } from "zod";
import { requestClient } from "@/lib/server";
import {
  generateStudioSuggestion,
  studioAIConfiguration,
} from "@/lib/studio-ai";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json(
      { error: "Sign in to use the assistant." },
      { status: 401 },
    );
  }
  try {
    const raw = await request.text();
    if (raw.length > 18000)
      return Response.json(
        { error: "Keep the brief under 12,000 characters." },
        { status: 413 },
      );
    const input = z
      .object({
        workspaceId: z.string().uuid(),
        action: z.enum(["draft_plan", "summarize_reviews", "next_actions"]),
        brief: z.string().trim().min(1).max(12000).optional(),
        projectId: z.string().uuid().optional(),
      })
      .parse(JSON.parse(raw));
    const { data: role } = await client.rpc("workspace_role", {
      w: input.workspaceId,
    });
    if (role !== "owner")
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    let context: unknown;
    if (input.action === "draft_plan") {
      if (!input.brief)
        return Response.json({ error: "Add a brief first." }, { status: 400 });
      context = { brief: input.brief };
    } else {
      if (!input.projectId)
        return Response.json({ error: "Choose a project." }, { status: 400 });
      const { data: project, error } = await client
        .from("projects")
        .select("id,name,description,due_date")
        .eq("workspace_id", input.workspaceId)
        .eq("id", input.projectId)
        .single();
      if (error || !project)
        return Response.json({ error: "Project not found." }, { status: 404 });
      if (input.action === "next_actions") {
        const { data: tasks, error } = await client
          .from("tasks")
          .select("title,status,due_date,phase,estimated_minutes")
          .eq("workspace_id", input.workspaceId)
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
          .limit(80);
        if (error) throw error;
        context = {
          project,
          today: new Date().toISOString().slice(0, 10),
          tasks,
          coverage:
            "Most recent 80 tasks; estimates are planned effort, not availability.",
        };
      } else {
        const [d, v, f] = await Promise.all([
          client
            .from("deliverables")
            .select("id,title,current_version_id")
            .eq("workspace_id", input.workspaceId)
            .eq("project_id", project.id)
            .limit(40),
          client
            .from("deliverable_versions")
            .select("id,deliverable_id,version_number,status,note")
            .eq("workspace_id", input.workspaceId)
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(60),
          client
            .from("review_feedback")
            .select("version_id,body,created_at,annotation,resolved_at")
            .eq("workspace_id", input.workspaceId)
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(80),
        ]);
        if (d.error || v.error || f.error)
          throw Error("Review context could not be loaded.");
        context = {
          project,
          deliverables: d.data,
          versions: v.data,
          feedback: f.data,
          coverage:
            "Up to 40 deliverables, 60 recent versions, and 80 recent feedback entries.",
        };
      }
    }
    if (!studioAIConfiguration().enabled)
      return Response.json(
        {
          error:
            "Connect OpenAI or Anthropic in the server settings to use the assistant. All workflows work without AI.",
        },
        { status: 503 },
      );
    if (JSON.stringify(context).length > 50000)
      return Response.json(
        {
          error:
            "This project has too much feedback for one summary. Use a smaller review scope.",
        },
        { status: 413 },
      );
    const usage = await client.rpc("consume_studio_ai", {
      w: input.workspaceId,
    });
    if (usage.error)
      return Response.json({ error: usage.error.message }, { status: 429 });
    return Response.json(
      {
        ...(await generateStudioSuggestion(input.action, context)),
        source: "ai",
        provider: studioAIConfiguration().provider,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the request fields."
            : e instanceof Error
              ? e.message
              : "The assistant is unavailable.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json(
      { error: "Sign in to use the assistant." },
      { status: 401 },
    );
  }
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!z.string().uuid().safeParse(workspaceId).success)
    return Response.json({ error: "Choose a workspace." }, { status: 400 });
  const { data: role } = await client.rpc("workspace_role", { w: workspaceId });
  if (role !== "owner")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return Response.json(studioAIConfiguration(), {
    headers: { "Cache-Control": "no-store" },
  });
}
