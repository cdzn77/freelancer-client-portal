import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const w = "10000000-0000-4000-8000-000000000001";
async function auth(email = "admin@studio.test") {
  const c = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const r = await c.auth.signInWithPassword({
    email,
    password: "Studio-demo-2026!",
  });
  expect(r.error).toBeNull();
  return { c, token: r.data.session!.access_token };
}
test("MCP server reads real projects with user RLS", async () => {
  const { token } = await auth();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "services/mcp.ts"],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ),
      PMS_ACCESS_TOKEN: token,
      PMS_WORKSPACE_ID: w,
    },
  });
  const mcp = new Client({ name: "pms-test", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const tools = await mcp.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "read_projects",
        "read_tasks",
        "read_time_entries",
        "read_budgets",
      ]),
    );
    const result = await mcp.callTool({
      name: "read_projects",
      arguments: { limit: 10 },
    });
    expect(JSON.stringify(result)).toContain("Brand, with a fresh perspective");
  } finally {
    await mcp.close();
  }
});
test("Health summary and manual payments work without paid providers", async ({
  request,
}) => {
  const { c, token } = await auth();
  const project = (await c.from("projects").select("id").eq("workspace_id", w))
    .data![0];
  const r = await request.post("/api/health", {
    headers: { Authorization: `Bearer ${token}` },
    data: { workspaceId: w, projectId: project.id },
  });
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).summary.length).toBeGreaterThan(30);
  const invoice = (await c.from("invoices").select("id").eq("workspace_id", w))
    .data![0];
  const p = await request.post("/api/payments", {
    headers: { Authorization: `Bearer ${token}` },
    data: { id: invoice.id, workspace: w },
  });
  expect((await p.json()).url).toBeNull();
});
test("Nested tasks and dependencies reject cycles", async () => {
  const { c } = await auth();
  const project = (await c.from("projects").select("id").eq("workspace_id", w))
    .data![0];
  const { data: tasks, error } = await c
    .from("tasks")
    .insert([
      { workspace_id: w, project_id: project.id, title: "Cycle check A" },
      { workspace_id: w, project_id: project.id, title: "Cycle check B" },
    ])
    .select();
  expect(error).toBeNull();
  try {
    expect(
      (
        await c
          .from("tasks")
          .update({ parent_task_id: tasks![0].id })
          .eq("id", tasks![1].id)
      ).error,
    ).toBeNull();
    expect(
      (
        await c
          .from("tasks")
          .update({ parent_task_id: tasks![1].id })
          .eq("id", tasks![0].id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await c
          .from("dependencies")
          .insert({
            workspace_id: w,
            task_id: tasks![0].id,
            depends_on_id: tasks![1].id,
          })
      ).error,
    ).toBeNull();
    expect(
      (
        await c
          .from("dependencies")
          .insert({
            workspace_id: w,
            task_id: tasks![1].id,
            depends_on_id: tasks![0].id,
          })
      ).error,
    ).not.toBeNull();
  } finally {
    await c
      .from("tasks")
      .update({ parent_task_id: null })
      .in(
        "id",
        tasks!.map((t) => t.id),
      );
    await c
      .from("tasks")
      .delete()
      .in(
        "id",
        tasks!.map((t) => t.id),
      );
  }
});
