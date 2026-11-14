import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
const name = "Billing " + Date.now();
let w = "",
  p = "",
  account = "";
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
  const project = await ok(
    admin
      .from("projects")
      .insert({
        workspace_id: w,
        name: "Billing project",
        client_name: "Profile client",
      })
      .select()
      .single(),
  );
  p = project.id;
  account = project.client_account_id;
  await ok(
    admin.from("invoices").insert([
      {
        workspace_id: w,
        project_id: p,
        number: "INV-original",
        client_name: "Profile client",
        status: "Sent",
        lines: [{ description: "Service", quantity: 1, rate: 100 }],
      },
      {
        workspace_id: w,
        project_id: p,
        number: "INV-duplicate",
        client_name: "Profile client",
        status: "Sent",
        lines: [{ description: "Service", quantity: 1, rate: 100 }],
      },
    ]),
  );
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
});
test("Billing profile defaults remain reusable and reconciled sources keep one obligation", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    `/?workspace=${w}&page=Financials&finance=Billing%20profiles`,
  );
  await page.getByLabel("Client billing account").selectOption(account);
  await page
    .getByLabel("Billing name", { exact: true })
    .fill("Profile client LLC");
  await page
    .getByLabel("Billing email", { exact: true })
    .fill("ap@example.invalid");
  await page
    .getByLabel("Billing address", { exact: true })
    .fill("100 Test Way");
  await page.getByLabel("Default hourly rate (USD)").fill("150");
  await page.getByRole("button", { name: "Add billing contact" }).click();
  await page.getByLabel("Contact name", { exact: true }).fill("Accounts");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("contact@example.invalid");
  await page
    .getByRole("button", { name: "Save billing profile", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("billing_profiles")
            .select("revision")
            .eq("client_account_id", account)
            .single()
        ).data?.revision,
    )
    .toBe(1);
  await page.reload();
  await page.getByLabel("Client billing account").selectOption(account);
  await expect(page.getByLabel("Billing address", { exact: true })).toHaveValue(
    "100 Test Way",
  );
  await page
    .getByRole("button", { name: "Billing records", exact: true })
    .click();
  await page.getByRole("button", { name: "INV-original", exact: true }).click();
  await page
    .getByText("Link another record of the same obligation", { exact: true })
    .click();
  const groups = await ok(admin.rpc("billing_workspace", { w }));
  const other = groups.groups.find(
    (g: any) => g.sources[0].title === "INV-duplicate",
  );
  await page.getByLabel("Record to reconcile").selectOption(other.id);
  await page
    .getByLabel("Reason and source evidence")
    .fill("Verified duplicate of the same full engagement");
  await page.getByLabel(/I verified these records describe/).check();
  await page
    .getByRole("button", { name: "Link financial records", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await admin.rpc("billing_workspace", { w })).data?.groups.length,
    )
    .toBe(1);
  await expect(page.getByText("2 source(s)", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include('section[aria-label="Reconciled financial records"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/?workspace=${w}&page=Documents%20%26%20payments`);
  await page
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "Estimate", exact: true }),
    })
    .click();
  await page
    .getByLabel("Billing profile", { exact: true })
    .selectOption(account);
  await page
    .getByRole("button", { name: "Apply billing defaults", exact: true })
    .click();
  await expect(
    page.getByLabel("Client company / name", { exact: true }),
  ).toHaveValue("Profile client LLC");
  await expect(page.getByLabel("Client email", { exact: true })).toHaveValue(
    "ap@example.invalid",
  );
  await expect(page.getByLabel("Unit price", { exact: true })).toHaveValue(
    "150",
  );
  await page.getByLabel("Attach to project (optional)").selectOption(p);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("client_documents")
            .select("content")
            .eq("workspace_id", w)
            .single()
        ).data?.content?.billing_profile?.revision,
    )
    .toBe(1);
  const draft = await ok(
    admin
      .from("client_documents")
      .select("content,total_cents")
      .eq("workspace_id", w)
      .single(),
  );
  expect(draft.content.billing_address).toBe("100 Test Way");
  expect(draft.total_cents).toBe(15000);
});
