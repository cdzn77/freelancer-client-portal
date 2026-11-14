import { requestClient } from "@/lib/server";
import { ai } from "@/lib/adapters";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const client = await requestClient(request);
    const { workspaceId, projectId } = z
      .object({ workspaceId: z.string().uuid(), projectId: z.string().uuid() })
      .parse(await request.json());
    const { data: role } = await client.rpc("workspace_role", {
      w: workspaceId,
    });
    if (role !== "owner")
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    const { data: project, error } = await client
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", projectId)
      .single();
    if (error || !project)
      return Response.json({ error: "Project not found." }, { status: 404 });
    const [tasks, budget, time] = await Promise.all([
      client
        .from("tasks")
        .select("status,due_date")
        .eq("workspace_id", workspaceId)
        .eq("project_id", projectId),
      client
        .from("budgets")
        .select("amount")
        .is("archived_at", null)
        .is("deleted_at", null)
        .eq("workspace_id", workspaceId)
        .eq("project_id", projectId)
        .maybeSingle(),
      client
        .from("time_entries")
        .select("minutes,bill_rate,billable")
        .eq("workspace_id", workspaceId)
        .eq("project_id", projectId),
    ]);
    const burn = (time.data || []).reduce(
        (s, t) => s + (t.billable ? (t.minutes / 60) * t.bill_rate : 0),
        0,
      ),
      amount = Number(budget.data?.amount || 0),
      done = (tasks.data || []).filter((t) => t.status === "Done").length;
    const context = {
      name: project.name,
      deadline: project.due_date,
      completed: done,
      tasks: tasks.data?.length || 0,
      budget: amount,
      burn,
    };
    try {
      return Response.json({
        summary: await ai.summarize(context),
        source: "ai",
      });
    } catch {
      return Response.json({
        summary: `Calculated summary: ${done} of ${context.tasks} tasks are complete. Recorded billable work is $${Math.round(burn).toLocaleString()}${amount ? ` of a $${amount.toLocaleString()} budget (${Math.round((burn / amount) * 100)}%)` : ". No budget has been set"}. ${amount && burn / amount >= 0.8 ? "Budget risk: review the remaining scope before starting more work." : "No budget threshold alert is currently triggered."}`,
        source: "calculation",
      });
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Request failed." },
      { status: 400 },
    );
  }
}
