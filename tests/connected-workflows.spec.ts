import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login } from "./helpers";
import { chooseOption } from "./select-helper";
import AxeBuilder from "@axe-core/playwright";
const url = process.env.SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } }),
  service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
test.use({ actionTimeout: 10000 });
let w = "",
  p = "",
  root = "",
  child = "",
  guest = "",
  entry = "";
const name = `Connected UI ${Date.now()}`;
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test.beforeAll(async () => {
  await ok(
    admin.auth.signInWithPassword({
      email: "admin@studio.test",
      password: "Studio-demo-2026!",
    }),
  );
  const u = await admin.auth.getUser();
  w = await ok(admin.rpc("create_workspace", { workspace_name: name }));
  const person = await service.auth.admin.createUser({
    email: `workflow-client-${Date.now()}@example.invalid`,
    password: "Disposable-test-2026!",
    email_confirm: true,
    app_metadata: { pms_admin_provisioned: true },
  });
  expect(person.error).toBeNull();
  guest = person.data.user!.id;
  await ok(
    service.from("workspace_members").insert({
      workspace_id: w,
      user_id: guest,
      role: "client",
      display_name: "Preview client",
    }),
  );
  p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Workflow fixture project",
          client_name: "Workflow client",
          access_type: "workspace",
          client_tools: ["tasks", "approvals", "discussions", "files", "brief"],
          start_date: "2026-10-20",
          due_date: "2026-11-20",
        })
        .select()
        .single(),
    )
  ).id;
  await ok(
    admin.rpc("manage_project_member", {
      w,
      p,
      target: guest,
      project_role: "guest",
      remove_member: false,
    }),
  );
  const tasks = await ok(
    admin
      .from("tasks")
      .insert([
        {
          workspace_id: w,
          project_id: p,
          title: "Published delivery task",
          start_date: "2026-10-20",
          due_date: "2026-10-20",
          estimated_minutes: 60,
          assignee_id: u.data.user!.id,
          is_published: true,
        },
        {
          workspace_id: w,
          project_id: p,
          title: "Private follow-up task",
          is_published: false,
          start_date: "2026-10-21",
          due_date: "2026-10-21",
          estimated_minutes: 60,
          assignee_id: u.data.user!.id,
        },
      ])
      .select(),
  );
  root = tasks[0].id;
  child = tasks[1].id;
  await ok(
    admin
      .from("dependencies")
      .insert({ workspace_id: w, task_id: child, depends_on_id: root }),
  );
  await ok(
    admin.from("team_capacity").upsert({
      workspace_id: w,
      user_id: u.data.user!.id,
      daily_minutes: 480,
      weekdays: [1, 2, 3, 4, 5],
    }),
  );
  entry = (
    await ok(
      admin
        .from("time_entries")
        .insert({
          workspace_id: w,
          project_id: p,
          task_id: root,
          description: "Approved design work",
          minutes: 60,
          bill_rate: 100,
          cost_rate: 50,
          billing_treatment: "invoice",
        })
        .select()
        .single(),
    )
  ).id;
  await ok(
    admin.from("time_entries").update({ status: "Approved" }).eq("id", entry),
  );
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
  if (guest) await service.auth.admin.deleteUser(guest);
});
test("Preview/apply dates, allocate effort, link GitHub and open safe client preview", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(
    `/?workspace=${w}&page=Projects&project=${p}&section=Scheduling`,
  );
  await expect(
    page.getByText("Task schedule and effort", { exact: true }),
  ).toBeVisible();
  await chooseOption(page.getByLabel("Task", { exact: true }), root);
  await page.getByLabel("New start", { exact: true }).fill("2026-10-22");
  await page.getByLabel("New due date", { exact: true }).fill("2026-10-22");
  await page.getByRole("button", { name: "Preview dependent dates" }).click();
  await expect(
    page.getByRole("button", { name: "Apply this schedule" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply this schedule" }).click();
  await expect
    .poll(
      async () =>
        (await admin.from("tasks").select("due_date").eq("id", child).single())
          .data?.due_date,
    )
    .toBe("2026-10-23");
  await page
    .getByRole("button", { name: "Distribute across available workdays" })
    .click();
  await page.getByRole("button", { name: "Save daily allocation" }).click();
  await expect
    .poll(
      async () =>
        (await admin.from("task_allocations").select("*").eq("task_id", root))
          .data?.length,
    )
    .toBe(1);
  await page
    .getByLabel("GitHub issue or pull request URL")
    .fill("https://github.com/activecollab/activecollab-sdk/issues/1");
  await page.getByRole("button", { name: "Link to task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh status", exact: true }),
  ).toBeVisible();
  const newTab = context.waitForEvent("page");
  await page.getByRole("link", { name: "View as client" }).click();
  const preview = await newTab;
  await expect(
    preview.getByText("Client view preview · Read-only", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", {
      name: "Workflow fixture project",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByText("Private follow-up task", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("link", { name: "Return to admin" }),
  ).toBeVisible();
  await expect(
    preview.getByText("Administrator access required", { exact: true }),
  ).toHaveCount(0);
  await preview.setViewportSize({ width: 390, height: 844 });
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page: preview })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await preview.screenshot({
    path: "test-results/client-preview-mobile.png",
    fullPage: true,
  });
  await preview.getByRole("link", { name: "Return to admin" }).click();
  await expect(
    preview.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await preview.close();
});
test("Approved time creates a source-linked invoice and client reporting loads", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/?workspace=${w}&page=Financials&finance=Invoices`);
  await page
    .getByRole("button", { name: "Draft invoice from recorded work" })
    .click();
  const dialog = page.getByRole("dialog");
  await chooseOption(dialog.getByLabel("Project", { exact: true }), p);
  await dialog.getByLabel("Invoice due", { exact: true }).fill("2026-11-15");
  await dialog.getByLabel(/Approved design work/).check();
  await dialog.getByLabel(/I checked retainer coverage/).check();
  await dialog.getByRole("button", { name: "Create invoice draft" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("invoice_sources")
            .select("*")
            .eq("time_entry_id", entry)
        ).data?.length,
    )
    .toBe(1);
  await page.goto(`/?workspace=${w}&page=Client%20profitability`);
  await expect(
    page.getByText("Connected project overview", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#main-content").getByRole("button", { name: "Workflow fixture project", exact: true }),
  ).toBeVisible();
});
