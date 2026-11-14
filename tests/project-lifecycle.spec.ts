import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login, nav } from "./helpers";
const w = "10000000-0000-4000-8000-000000000001";
const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test("Archive and Trash restore projects without removing their tasks", async ({
  page,
}) => {
  const name = `Lifecycle ${Date.now()}`;
  const [p] = await ok(
    db.from("projects").insert({ workspace_id: w, name }).select(),
  );
  try {
    const [task] = await ok(
      db
        .from("tasks")
        .insert({ workspace_id: w, project_id: p.id, title: "Preserved task" })
        .select(),
    );
    await login(page);
    await nav(page, "Projects");
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .click();
    await page
      .getByRole("button", { name: "Archive project", exact: true })
      .click();
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(
      0,
    );
    await chooseOption(page.getByLabel("Project archive filter"), "Archived");
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .click();
    await page
      .getByRole("button", { name: "Restore project", exact: true })
      .click();
    await chooseOption(page.getByLabel("Project archive filter"), "Active");
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .click();
    await page
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await ok(db.from("projects").select("deleted_at").eq("id", p.id)))[0]
        .deleted_at,
    ).toBeNull();
    await page
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await chooseOption(page.getByLabel("Project archive filter"), "Trash");
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .click();
    expect(
      await ok(db.from("tasks").select("id").eq("id", task.id)),
    ).toHaveLength(1);
    await page
      .getByRole("button", { name: "Restore from Trash", exact: true })
      .click();
    await chooseOption(page.getByLabel("Project archive filter"), "Active");
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  } finally {
    await ok(db.from("tasks").delete().eq("project_id", p.id));
    await ok(db.from("projects").delete().eq("id", p.id));
  }
});
test("Project owner can archive but cannot move to Trash", async () => {
  const email = `lifecycle-${Date.now()}@studio.test`;
  const { data, error } = await db.auth.admin.createUser({
    app_metadata: { pms_admin_provisioned: true },
    email,
    password: "Studio-demo-2026!",
    email_confirm: true,
  });
  expect(error).toBeNull();
  const uid = data.user!.id;
  const [p] = await ok(
    db
      .from("projects")
      .insert({ workspace_id: w, name: "Lifecycle permission fixture" })
      .select(),
  );
  try {
    await ok(
      db.from("workspace_members").insert({
        workspace_id: w,
        user_id: uid,
        role: "member",
        display_name: "Lifecycle fixture",
      }),
    );
    await ok(
      db.from("project_members").insert({
        workspace_id: w,
        project_id: p.id,
        user_id: uid,
        role: "owner",
      }),
    );
    const c = createClient(
      process.env.SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    expect(
      (
        await c.auth.signInWithPassword({
          email,
          password: "Studio-demo-2026!",
        })
      ).error,
    ).toBeNull();
    expect(
      await ok(
        c
          .from("projects")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", p.id)
          .select(),
      ),
    ).toHaveLength(1);
    expect(
      (
        await c
          .from("projects")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", p.id)
      ).error,
    ).not.toBeNull();
    await ok(
      db
        .from("project_members")
        .update({ role: "member" })
        .eq("project_id", p.id)
        .eq("user_id", uid),
    );
    expect(
      await ok(
        c
          .from("projects")
          .update({ archived_at: null })
          .eq("id", p.id)
          .select(),
      ),
    ).toHaveLength(0);
  } finally {
    await ok(db.from("projects").delete().eq("id", p.id));
    await ok(
      db
        .from("workspace_members")
        .delete()
        .eq("workspace_id", w)
        .eq("user_id", uid),
    );
    await db.auth.admin.deleteUser(uid);
  }
});
