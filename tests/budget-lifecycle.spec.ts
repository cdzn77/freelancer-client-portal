import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
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
test("Budget creation, editing, archive and Trash preserve project and time", async ({
  page,
}) => {
  const name = `Budget lifecycle ${Date.now()}`;
  const [p] = await ok(
    db.from("projects").insert({ workspace_id: w, name }).select(),
  );
  try {
    const [owner] = await ok(
      db
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", w)
        .eq("role", "owner")
        .limit(1),
    );
    const [entry] = await ok(
      db
        .from("time_entries")
        .insert({
          workspace_id: w,
          project_id: p.id,
          description: "Budget preservation fixture",
          created_by: owner.user_id,
          minutes: 60,
          bill_rate: 100,
          cost_rate: 50,
        })
        .select(),
    );
    await login(page);
    await nav(page, "Financials");
    await page.getByRole("button", { name: "Budgets", exact: true }).click();
    await page.getByRole("button", { name: "New budget", exact: true }).click();
    await chooseOption(
      page.getByRole("dialog").getByLabel("Project", { exact: true }),
      p.id,
    );
    await page.getByLabel("Budget amount ($)", { exact: true }).fill("1234.56");
    await page
      .getByRole("button", { name: "Create budget", exact: true })
      .click();
    const card = page
      .locator("section.panel")
      .filter({ has: page.getByRole("heading", { name, exact: false }) });
    await expect(card).toBeVisible();
    expect(
      Number(
        (await ok(db.from("budgets").select().eq("project_id", p.id)))[0]
          .amount,
      ),
    ).toBe(1234.56);
    await card
      .getByRole("button", { name: "Edit budget", exact: true })
      .click();
    await page.getByLabel("Budget amount ($)", { exact: true }).fill("1500.75");
    await page
      .getByRole("button", { name: "Save budget", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card
      .getByRole("button", { name: "Archive budget", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await chooseOption(page.getByLabel("Budget archive filter"), "Archived");
    await expect(card).toBeVisible();
    await card
      .getByRole("button", { name: "Restore budget", exact: true })
      .click();
    await chooseOption(page.getByLabel("Budget archive filter"), "Active");
    await card
      .getByRole("button", { name: "Delete budget", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await ok(db.from("budgets").select().eq("project_id", p.id)))[0]
        .deleted_at,
    ).toBeNull();
    await card
      .getByRole("button", { name: "Delete budget", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await chooseOption(page.getByLabel("Budget archive filter"), "Trash");
    await expect(card).toBeVisible();
    await page.reload();
    await nav(page, "Financials");
    await page.getByRole("button", { name: "Budgets", exact: true }).click();
    await chooseOption(page.getByLabel("Budget archive filter"), "Trash");
    await expect(card).toBeVisible();
    expect(
      await ok(db.from("time_entries").select("id").eq("id", entry.id)),
    ).toHaveLength(1);
    expect(
      await ok(db.from("projects").select("id").eq("id", p.id)),
    ).toHaveLength(1);
    await card
      .getByRole("button", { name: "Restore from Trash", exact: true })
      .click();
    await chooseOption(page.getByLabel("Budget archive filter"), "Active");
    await expect(card).toBeVisible();
    expect(
      Number(
        (await ok(db.from("budgets").select().eq("project_id", p.id)))[0]
          .amount,
      ),
    ).toBe(1500.75);
    await page.getByRole("button", { name: "New budget", exact: true }).click();
    await expect(
      page.getByRole("dialog").locator(`option[value="${p.id}"]`),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await ok(db.from("budgets").delete().eq("project_id", p.id));
    await ok(db.from("time_entries").delete().eq("project_id", p.id));
    await ok(db.from("budget_alerts").delete().eq("project_id", p.id));
    await ok(db.from("projects").delete().eq("id", p.id));
  }
});
test("Regular users cannot create or change budgets", async () => {
  const email = `budget-access-${Date.now()}@studio.test`;
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
      .insert({ workspace_id: w, name: "Budget permissions fixture" })
      .select(),
  );
  try {
    await ok(
      db.from("workspace_members").insert({
        workspace_id: w,
        user_id: uid,
        role: "member",
        display_name: "Budget fixture",
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
      (
        await c
          .from("budgets")
          .insert({ workspace_id: w, project_id: p.id, amount: 500 })
      ).error,
    ).not.toBeNull();
    const [b] = await ok(
      db
        .from("budgets")
        .insert({ workspace_id: w, project_id: p.id, amount: 500 })
        .select(),
    );
    for (const values of [
      { amount: 100 },
      { archived_at: new Date().toISOString() },
      { deleted_at: new Date().toISOString() },
    ])
      expect(
        await ok(c.from("budgets").update(values).eq("id", b.id).select()),
      ).toEqual([]);
    expect(
      (
        await db
          .from("budgets")
          .insert({ workspace_id: w, project_id: p.id, amount: 10 })
      ).error,
    ).not.toBeNull();
    expect(
      (await db.from("budgets").update({ amount: 0 }).eq("id", b.id)).error,
    ).not.toBeNull();
  } finally {
    await ok(db.from("budgets").delete().eq("project_id", p.id));
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
