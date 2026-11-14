import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  internal = "10000000-0000-4000-8000-000000000001",
  clientWorkspace = "10000000-0000-4000-8000-000000000002";
async function auth(email: string) {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({
    email,
    password: "Studio-demo-2026!",
  });
  expect(error).toBeNull();
  return c;
}
test("Clients cannot read or write another tenant, finances, or membership", async () => {
  const c = await auth("client@northstar.test");
  for (const table of [
    "projects",
    "tasks",
    "time_entries",
    "budgets",
    "invoices",
    "estimates",
    "workspace_members",
    "comments",
    "approvals",
  ]) {
    const { data, error } = await c
      .from(table)
      .select("*")
      .eq("workspace_id", internal);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  }
  for (const table of ["time_entries", "budgets", "invoices", "estimates"]) {
    expect(
      (await c.from(table).select("*").eq("workspace_id", clientWorkspace))
        .data,
    ).toEqual([]);
  }
  expect(
    (
      await c
        .from("projects")
        .insert({ workspace_id: internal, name: "Cross tenant attack" })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await c
        .from("workspace_members")
        .insert({
          workspace_id: internal,
          user_id: (await c.auth.getUser()).data.user!.id,
          role: "owner",
          display_name: "Invalid",
        })
    ).error,
  ).not.toBeNull();
  const own = (await c.from("projects").select("*")).data!;
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((p) => p.workspace_id === clientWorkspace)).toBeTruthy();
  expect(
    (
      await c
        .from("projects")
        .update({ name: "Unauthorized" })
        .eq("id", own[0].id)
        .select()
    ).data,
  ).toEqual([]);
});
test("Compound foreign keys reject linking projects across workspaces", async () => {
  const c = await auth("admin@studio.test");
  const { data } = await c
    .from("projects")
    .select("*")
    .eq("workspace_id", clientWorkspace);
  const r = await c
    .from("tasks")
    .insert({
      workspace_id: internal,
      project_id: data![0].id,
      title: "Invalid foreign key",
    });
  expect(r.error).not.toBeNull();
});
test("Contractors cannot approve their own time or create projects", async () => {
  const c = await auth("contractor@studio.test");
  expect(
    (
      await c
        .from("projects")
        .insert({ workspace_id: internal, name: "Invalid project" })
    ).error,
  ).not.toBeNull();
  const admin = await auth("admin@studio.test");
  const p = (await admin.from("projects").select("id").eq("workspace_id", internal))
    .data![0];
  expect(
    (
      await c
        .from("time_entries")
        .insert({
          workspace_id: internal,
          project_id: p.id,
          description: "Invalid approval",
          minutes: 60,
          status: "Approved",
        })
    ).error,
  ).not.toBeNull();
});
