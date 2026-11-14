import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
const service = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const name = `Scope budget ${Date.now()}`;
let w = "",
  p = "",
  doc = "";
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test.beforeAll(async () => {
  const session = await ok(
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
        name: "Approved engagement",
        client_name: "Scope client",
      })
      .select()
      .single(),
  );
  p = project.id;
  const d = await ok(
    service
      .from("client_documents")
      .insert({
        workspace_id: w,
        project_id: p,
        kind: "Estimate",
        title: "Approved scope budget",
        status: "Approved",
        created_by: session.user.id,
        total_cents: 110000,
        content: {
          scope: "Design with approved external costs",
          tax_rate: 10,
          items: [
            {
              description: "Service and allowance",
              quantity: 1,
              unit_cents: 100000,
            },
          ],
        },
      })
      .select()
      .single(),
  );
  doc = d.id;
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
});
test("Approved scope previews and allocates a service budget with retained history", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/?workspace=${w}&page=Financials&finance=Budgets`);
  await page.getByLabel("Approved scope source").selectOption(doc);
  await page
    .getByRole("button", { name: "Preview scope budget", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Approved scope budget · version 1",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Reimbursable allowance within approved subtotal (USD)")
    .fill("100");
  await page
    .getByLabel("Budget allocation reason")
    .fill("Approved service scope excludes tax and external allowance");
  await expect(page.getByText(/Resulting budget: \$900.00/)).toBeVisible();
  await page
    .getByRole("button", {
      name: "Apply approved scope to budget",
      exact: true,
    })
    .click();
  await expect
    .poll(async () =>
      Number(
        (
          await admin
            .from("budgets")
            .select("amount")
            .eq("project_id", p)
            .single()
        ).data?.amount,
      ),
    )
    .toBe(900);
  await page
    .getByText("Approved scope budget history (1)", { exact: true })
    .click();
  await expect(
    page
      .getByRole("article")
      .getByText("Approved service scope excludes tax and external allowance", {
        exact: true,
      }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
