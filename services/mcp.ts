import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
const {
  SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  PMS_ACCESS_TOKEN,
  PMS_WORKSPACE_ID,
} = process.env;
if (
  !SUPABASE_URL ||
  !NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !PMS_ACCESS_TOKEN ||
  !PMS_WORKSPACE_ID
)
  throw Error(
    "Set Supabase URL, anon key, user access token and workspace ID. Service-role keys are not supported.",
  );
const client = createClient(SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${PMS_ACCESS_TOKEN}` } },
});
const workspace = PMS_WORKSPACE_ID;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reply = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
async function execute(fn: () => Promise<unknown>) {
  try {
    return reply(await fn());
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: (e as Error).message }],
    };
  }
}
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await client.rpc(name, args);
  if (r.error) throw r.error;
  return r.data;
}
async function project(id: string) {
  const r = await client
    .from("projects")
    .select("id,name,description,due_date,status")
    .eq("workspace_id", workspace)
    .eq("id", id)
    .single();
  if (r.error) throw Error("Project unavailable in this workspace");
  return r.data;
}
async function task(id: string) {
  const r = await client
    .from("tasks")
    .select("id,project_id")
    .eq("workspace_id", workspace)
    .eq("id", id)
    .single();
  if (r.error) throw Error("Task unavailable in this workspace");
  return r.data;
}
async function main() {
  const { data, error } = await client.auth.getUser(PMS_ACCESS_TOKEN);
  if (error || !data.user) throw Error("A valid user access token is required");
  const security = await rpc("pms_security_status", {});
  if (security.password_required || security.mfa_required)
    throw Error("Complete password and MFA verification first");
  const server = new McpServer({ name: "freelancer-client-portal", version: "0.2.0" });
  for (const table of ["projects", "tasks", "time_entries", "budgets"])
    server.tool(
      `read_${table}`,
      `Read ${table} subject to workspace and row permissions.`,
      { limit: z.number().int().min(1).max(200).default(50) },
      async ({ limit }) =>
        execute(async () => {
          const r = await client
            .from(table)
            .select("*")
            .eq("workspace_id", workspace)
            .order("id")
            .limit(limit);
          if (r.error) throw r.error;
          return {
            records: r.data,
            limit,
            coverage: "Bounded page; not a complete workspace total",
          };
        }),
    );
  server.tool(
    "search_tasks",
    "Search visible tasks by title, project, status and due date. Client publication rules apply.",
    {
      query: z.string().max(100).default(""),
      project_id: z.string().uuid().optional(),
      status: z.string().max(80).optional(),
      due_before: date.optional(),
      limit: z.number().int().min(1).max(100).default(40),
    },
    async (input) =>
      execute(async () => {
        let q = client
          .from("tasks")
          .select(
            "id,project_id,title,status,start_date,due_date,estimated_minutes,remaining_minutes",
          )
          .eq("workspace_id", workspace)
          .order("id")
          .limit(input.limit);
        if (input.query)
          q = q.ilike("title", `%${input.query.replace(/[\\%_]/g, "\\$&")}%`);
        if (input.project_id) q = q.eq("project_id", input.project_id);
        if (input.status) q = q.eq("status", input.status);
        if (input.due_before) q = q.lte("due_date", input.due_before);
        const r = await q;
        if (r.error) throw r.error;
        return { tasks: r.data, limit: input.limit };
      }),
  );
  server.tool(
    "summarize_project",
    "Read project status and a bounded task summary; does not use an external AI service.",
    { project_id: z.string().uuid() },
    async ({ project_id }) =>
      execute(async () => {
        const p = await project(project_id);
        const r = await client
          .from("tasks")
          .select("id,title,status,due_date,estimated_minutes")
          .eq("workspace_id", workspace)
          .eq("project_id", project_id)
          .order("id")
          .limit(201);
        if (r.error) throw r.error;
        const tasks = (r.data || []).slice(0, 200);
        return {
          project: p,
          tasks,
          coverage:
            r.data!.length > 200
              ? "First 200 tasks; summary incomplete"
              : "All visible tasks",
          completed: tasks.filter((t) => t.status === "Done").length,
        };
      }),
  );
  server.tool(
    "read_capacity",
    "Read visible schedules and daily task allocations. Availability is unknown without configured hours; rows may be limited.",
    { from: date, through: date },
    async ({ from, through }) =>
      execute(async () => {
        if (
          through < from ||
          Date.parse(through) - Date.parse(from) > 366 * 86400000
        )
          throw Error("Choose a period of one year or less");
        const results = await Promise.all(
          [
            "team_capacity",
            "team_time_off",
            "team_schedule_days",
            "team_schedule_status",
            "resource_bookings",
            "task_allocations",
          ].map(async (table) => {
            let q = client
              .from(table)
              .select("*")
              .eq("workspace_id", workspace)
              .limit(501);
            if (table === "team_schedule_days" || table === "task_allocations")
              q = q.gte("work_date", from).lte("work_date", through);
            const r = await q;
            if (r.error) throw r.error;
            return [
              table,
              {
                records: r.data?.slice(0, 500),
                truncated: (r.data?.length || 0) > 500,
              },
            ];
          }),
        );
        return Object.fromEntries(results);
      }),
  );
  server.tool(
    "preview_schedule",
    "Preview a dependency schedule. Project owner rights required. Does not change records.",
    { task_id: z.string().uuid(), start: date, due: date },
    async ({ task_id, start, due }) =>
      execute(async () => {
        await task(task_id);
        return rpc("preview_task_schedule", {
          p_task: task_id,
          p_start: start,
          p_due: due,
        });
      }),
  );
  if (process.env.PMS_MCP_WRITE === "true") {
    server.tool(
      "create_private_task",
      "Create an unpublished task only after the user requests it. Reuse request_id on retry.",
      {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(12000).default(""),
        due: date.optional(),
        request_id: z.string().uuid(),
        confirm: z.literal(true),
      },
      async (i) =>
        execute(async () => {
          await project(i.project_id);
          return rpc("create_assistant_task", {
            p_project: i.project_id,
            p_title: i.title,
            p_description: i.description,
            p_due: i.due || null,
            p_request: i.request_id,
          });
        }),
    );
    server.tool(
      "apply_schedule",
      "Apply the exact preview the user has confirmed. Requires its fingerprint; stale previews fail. Reuse request_id on retry.",
      {
        task_id: z.string().uuid(),
        start: date,
        due: date,
        fingerprint: z.string().length(32),
        request_id: z.string().uuid(),
        confirm: z.literal(true),
      },
      async (i) =>
        execute(async () => {
          await task(i.task_id);
          return rpc("apply_task_schedule", {
            p_task: i.task_id,
            p_start: i.start,
            p_due: i.due,
            p_fingerprint: i.fingerprint,
            p_request: i.request_id,
          });
        }),
    );
  }
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
