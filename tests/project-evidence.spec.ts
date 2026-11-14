import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localDate } from "../lib/work-planning";
import { login } from "./helpers";
import { chooseOption } from "./select-helper";
import AxeBuilder from "@axe-core/playwright";
const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  ),
  service = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ),
  client = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
const name = `Evidence ${Date.now()}`,
  email = `evidence-${Date.now()}@example.invalid`;
let w = "",
  p = "",
  guest = "",
  task = "",
  file = "",
  path = "";
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
  w = await ok(admin.rpc("create_workspace", { workspace_name: name }));
  guest = (
    await ok(
      service.auth.admin.createUser({
        email,
        password: "Disposable-test-2026!",
        email_confirm: true,
        app_metadata: { pms_admin_provisioned: true },
      }),
    )
  ).user.id;
  await ok(
    service.from("workspace_members").insert({
      workspace_id: w,
      user_id: guest,
      role: "client",
      display_name: "Report client",
    }),
  );
  p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Evidence project",
          client_name: "Report client",
          client_tools: ["tasks", "files", "discussions"],
          client_time_report_enabled: true,
          client_retainer_report_enabled: true,
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
  task = (
    await ok(
      admin
        .from("tasks")
        .insert({
          workspace_id: w,
          project_id: p,
          title: "Shared design task",
          is_published: true,
        })
        .select()
        .single(),
    )
  ).id;
  const hidden = (
    await ok(
      admin
        .from("tasks")
        .insert({
          workspace_id: w,
          project_id: p,
          title: "Internal margin review",
          is_published: false,
        })
        .select()
        .single(),
    )
  ).id;
  await ok(
    admin.from("time_entries").insert([
      {
        workspace_id: w,
        project_id: p,
        task_id: task,
        description: "Private staff note",
        minutes: 60,
        status: "Submitted",
        entry_date: localDate(),
        billing_treatment: "covered",
        cost_rate: 91,
        bill_rate: 182,
      },
      {
        workspace_id: w,
        project_id: p,
        task_id: hidden,
        description: "Internal",
        cost_rate: 90,
        bill_rate: 180,
        minutes: 120,
        status: "Submitted",
        entry_date: localDate(),
        billing_treatment: "covered",
      },
    ]),
  );
  await ok(
    admin
      .from("time_entries")
      .update({ status: "Approved" })
      .eq("project_id", p),
  );
  const today = localDate();
  await ok(
    admin.from("retainers").insert({
      workspace_id: w,
      project_id: p,
      period: today.slice(0, 7) + "-01",
      hours: 10,
      rollover: 2,
    }),
  );
  path = `${w}/${p}/receipt.txt`;
  await ok(
    service.storage
      .from("project-files")
      .upload(path, Buffer.from("Disposable receipt evidence"), {
        contentType: "text/plain",
      }),
  );
  file = (
    await ok(
      admin
        .from("project_files")
        .insert({ workspace_id: w, project_id: p, name: "Receipt.txt", path })
        .select()
        .single(),
    )
  ).id;
  await ok(
    client.auth.signInWithPassword({
      email,
      password: "Disposable-test-2026!",
    }),
  );
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
  if (path) await ok(service.storage.from("project-files").remove([path]));
  if (guest) await ok(service.auth.admin.deleteUser(guest));
});
test("Expense UI links evidence; invoiced receipt cannot be physically deleted", async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto(`/?workspace=${w}&page=Client+profitability`);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Project", exact: true }),
    { label: "Evidence project" },
  );
  await chooseOption(
    dialog.getByRole("combobox", {
      name: "Linked task (optional)",
      exact: true,
    }),
    { label: "Shared design task" },
  );
  await chooseOption(
    dialog.getByRole("combobox", {
      name: "Receipt file (optional)",
      exact: true,
    }),
    { label: "Receipt.txt (Private)" },
  );
  await dialog
    .getByLabel("Expense description", { exact: true })
    .fill("Stock licence");
  await dialog.getByLabel("Amount (USD)").fill("20");
  await dialog.getByLabel("Client reimbursable, outside existing fees").check();
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Stock licence", { exact: true })).toBeVisible();
  const e = await ok(
    admin.from("project_expenses").select("*").eq("project_id", p).single(),
  );
  expect(e.task_id).toBe(task);
  expect(e.receipt_file_id).toBe(file);
  await page.getByRole("button", { name: "Edit expense", exact: true }).click();
  await dialog
    .getByLabel("Expense description", { exact: true })
    .fill("Stock licence receipt");
  await dialog.getByRole("button", { name: "Save record" }).click();
  await expect(dialog).toBeHidden();
  await ok(
    admin.rpc("create_work_invoice", {
      p_project: p,
      p_time_ids: [],
      p_expense_ids: [e.id],
      p_due: localDate(),
      p_request: crypto.randomUUID(),
      p_acknowledge: true,
    }),
  );
  const token = (await admin.auth.getSession()).data.session!.access_token;
  const res = await request.delete(
    `/api/storage?path=${encodeURIComponent(path)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toContain("evidence");
  expect(
    await ok(service.storage.from("project-files").download(path)),
  ).toBeTruthy();
});
test("Actual client and admin preview show only approved shared time", async ({
  page,
}) => {
  const today = localDate();
  const actual = await ok(
    client.rpc("client_time_report", {
      p_project: p,
      starts_on: today,
      ends_on: today,
    }),
  );
  expect(actual.entries).toHaveLength(1);
  expect(actual.entries[0].minutes).toBe(60);
  expect(JSON.stringify(actual)).not.toMatch(
    /Private staff|Internal margin|cost_rate|bill_rate/,
  );
  await login(page);
  await page.goto(
    `/client-preview?workspace=${w}&project=${p}&clientView=Project&clientProject=${p}&clientSection=Time+report`,
  );
  await expect(
    page.getByRole("heading", { name: "Shared time report", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Shared design task", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Internal margin review", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/1.00 shared covered hours/)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Client navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Client navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Active work", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".client-shell .cp-topbar")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
test("Project decisions and findings support history, sharing, validation and CSV", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    `/?workspace=${w}&page=Projects&project=${p}&section=Decisions`,
  );
  await page.getByRole("button", { name: "New decision", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Title", { exact: true }).fill("Use tested navigation");
  await d.getByLabel("Decision maker").fill("Project lead");
  await d
    .getByLabel("Rationale")
    .fill("Participants found key routes more quickly.");
  await d.getByLabel("Status", { exact: true }).selectOption("Decided");
  await d.getByRole("button", { name: "Save decision" }).click();
  await expect(d).toBeHidden();
  expect(
    (
      await ok(
        client.from("project_registers").select("id").eq("project_id", p),
      )
    ).length,
  ).toBe(0);
  await page.getByRole("button", { name: "Edit decision" }).click();
  await d.getByLabel("Share this record with invited clients").check();
  await d.getByRole("button", { name: "Save decision" }).click();
  await expect(d).toBeHidden();
  expect(
    (
      await ok(
        client.from("project_registers").select("id").eq("project_id", p),
      )
    ).length,
  ).toBe(1);
  await page.getByRole("button", { name: "View revision history" }).click();
  await expect(d.getByRole("heading", { name: /Revision 2/ })).toBeVisible();
  await d.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Audit findings", exact: true })
    .click();
  await page.getByRole("button", { name: "New finding", exact: true }).click();
  await d.getByLabel("Title", { exact: true }).fill("Checkout contrast");
  await d.getByLabel("Affected flow").fill("Checkout");
  await d
    .getByLabel("Evidence", { exact: true })
    .fill("Measured text contrast needs correction.");
  await d.getByLabel("Recommendation").fill("Increase foreground contrast.");
  await d.getByLabel("Heuristic or WCAG criterion").fill("WCAG 2.2 1.4.3");
  await d.getByLabel("Finding owner").fill("Design lead");
  await d.getByLabel("Status", { exact: true }).selectOption("Validated");
  await d.getByRole("button", { name: "Save finding" }).click();
  await expect(d.getByRole("alert")).toContainText("validation result");
  await d
    .getByLabel("Validation result")
    .fill("Retested primary and secondary text on 2026-10-10.");
  await d.getByRole("button", { name: "Save finding" }).click();
  await expect(d).toBeHidden();
  await expect(
    page.getByText("Checkout contrast", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export finding CSV" }).click();
  expect((await download).suggestedFilename()).toBe("finding-register.csv");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const decision = await ok(
    admin
      .from("project_registers")
      .select("*")
      .eq("project_id", p)
      .eq("kind", "Decision")
      .single(),
  );
  const doc = await ok(
    service
      .from("client_documents")
      .insert({
        workspace_id: w,
        project_id: p,
        client_id: guest,
        kind: "Invoice",
        title: "Shared source invoice",
        status: "Approved",
        content: {},
        total_cents: 1000,
        created_by: (await admin.auth.getUser()).data.user!.id,
      })
      .select()
      .single(),
  );
  await ok(
    admin.rpc("save_project_register", {
      p_project: p,
      record_id: decision.id,
      expected_revision: decision.revision,
      record_kind: "Decision",
      record_title: decision.title,
      record_details: decision.details,
      record_status: decision.status,
      record_day: decision.record_date,
      source_type: "Document",
      source: doc.id,
      published: true,
      replacement: null,
    }),
  );
  await page.goto(
    `/client-preview?workspace=${w}&project=${p}&clientView=Project&clientProject=${p}&clientSection=Decisions`,
  );
  await page
    .getByRole("button", { name: "Open document source", exact: true })
    .click();
  await expect(
    page.getByText(
      "Document sources are outside this project preview. Return to admin to open them.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/client-preview");
  await expect(
    page.getByRole("button", { name: "View revision history" }),
  ).toHaveCount(0);
});
