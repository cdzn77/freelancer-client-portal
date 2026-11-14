import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers";
import { standardTerms } from "../lib/client-documents";
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
const name = `Billing automation ${Date.now()}`;
let w = "",
  doc = "",
  dueDoc = "";
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
  const p = await ok(
    admin
      .from("projects")
      .insert({
        workspace_id: w,
        name: "Monthly client support",
        client_name: "Monthly client",
      })
      .select()
      .single(),
  );
  const content = {
    business: "Fixture studio",
    client: "Monthly client",
    email: "client@example.invalid",
    service: "Support",
    start: "",
    end: "",
    scope: "Monthly support",
    deliverables: "Reviewed support work",
    terms: standardTerms,
    tax_note: "No tax in fixture",
    tax_rate: 0,
    items: [{ description: "Monthly service", quantity: 1, unit_cents: 10000 }],
  };
  const rows = await ok(
    service
      .from("client_documents")
      .insert([
        {
          workspace_id: w,
          project_id: p.id,
          client_id: session.user.id,
          kind: "Invoice",
          title: "Support invoice template",
          status: "Draft",
          content,
          total_cents: 10000,
          created_by: session.user.id,
        },
        {
          workspace_id: w,
          project_id: p.id,
          client_id: session.user.id,
          kind: "Invoice",
          title: "Due support invoice",
          status: "Approved",
          content,
          total_cents: 10000,
          due_date: "2026-01-01",
          created_by: session.user.id,
        },
      ])
      .select(),
  );
  doc = rows[0].id;
  dueDoc = rows[1].id;
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
});
test("Recurring draft controls and explicit invoice reminders work without automatic collection", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    `/?workspace=${w}&page=Financials&finance=Billing%20automation`,
  );
  await page
    .getByText("Create recurring invoice schedule", { exact: true })
    .click();
  await page.getByLabel("Invoice template").selectOption(doc);
  await page.getByLabel(/I checked the original invoice/).check();
  await page
    .getByRole("button", { name: "Create invoice schedule", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Pause Support invoice template",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run due billing checks", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 draft(s) created" }),
  ).toBeVisible();
  await page.getByText("Occurrence history", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open invoice draft", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Run due billing checks", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "0 draft(s) created" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Pause Support invoice template",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Resume Support invoice template",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Configure invoice reminders", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Overdue invoice", exact: true })
    .selectOption(dueDoc);
  await page
    .getByLabel("Enable in-app payment reminders for this invoice", {
      exact: true,
    })
    .check();
  await expect(page.getByLabel(/Also send email reminders/)).not.toBeChecked();
  await page
    .getByRole("button", { name: "Save invoice reminders", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn off reminders", exact: true }),
  ).toBeVisible();
  const rules = await ok(
    admin
      .from("billing_reminder_rules")
      .select("enabled,email_enabled")
      .eq("workspace_id", w),
  );
  expect(rules).toEqual([{ enabled: true, email_enabled: false }]);
  await page
    .getByRole("button", { name: "Turn off reminders", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("billing_reminder_rules")
            .select("enabled")
            .eq("workspace_id", w)
            .single()
        ).data?.enabled,
    )
    .toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include('section[aria-label="Billing automation"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("Queued payment reminders recheck payments immediately before mocked Gmail delivery", async () => {
  const { randomBytes } = await import("node:crypto");
  const { seal } = await import("../lib/google-email");
  const { deliverNotifications } = await import("../lib/studio-email");
  const values: Record<string, string> = {
    GOOGLE_OAUTH_CLIENT_ID: "mock-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "mock-secret",
    GOOGLE_OAUTH_REDIRECT_URI:
      "http://127.0.0.1:3100/api/email/google/callback",
    EMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ENABLE_NOTIFICATION_EMAIL_WORKER: "true",
    PMS_PUBLIC_URL: "https://pms.example.test",
  };
  const old = Object.fromEntries(
      Object.keys(values).map((k) => [k, process.env[k]]),
    ),
    original = globalThis.fetch;
  let sends = 0,
    latePayment = false,
    failMail = false;
  const user = (await admin.auth.getUser()).data.user!;
  async function queue(days: number) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(12, 0, 0, 0);
    await ok(
      service.rpc("run_billing_reminders", {
        at_time: date.toISOString(),
        only_workspace: w,
      }),
    );
  }
  try {
    Object.assign(process.env, values);
    await ok(
      service.from("google_email_connections").insert({
        workspace_id: w,
        sender: "studio@example.com",
        connected_by: user.id,
        encrypted_refresh_token: seal("mock-refresh"),
      }),
    );
    await ok(
      admin
        .from("email_preferences")
        .upsert({ workspace_id: w, user_id: user.id, enabled: true }),
    );
    await ok(
      admin.rpc("save_billing_reminders", {
        doc: dueDoc,
        timezone: "UTC",
        first_days: 3,
        repeat_days: 7,
        max_reminders: 4,
        enabled: true,
        email_enabled: true,
      }),
    );
    await queue(0);
    const first = await ok(
      service
        .from("client_payments")
        .insert({
          workspace_id: w,
          document_id: dueDoc,
          provider: "Zelle",
          provider_id: "automation-first-" + w,
          amount_cents: 10000,
        })
        .select()
        .single(),
    );
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      if (address === "https://oauth2.googleapis.com/token") {
        if (latePayment) {
          latePayment = false;
          await ok(
            service.from("client_payments").insert({
              workspace_id: w,
              document_id: dueDoc,
              provider: "Zelle",
              provider_id: "automation-late-" + w,
              amount_cents: 10000,
            }),
          );
        }
        return Response.json({ access_token: "mock-access" });
      }
      if (
        address ===
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
      ) {
        sends++;
        const raw = Buffer.from(
          JSON.parse(String(init?.body)).raw,
          "base64url",
        ).toString();
        const body = Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString();
        expect(body).toContain("clientDocument=" + dueDoc);
        expect(body).toContain("Documents");
        return failMail
          ? new Response("Not confirmed", { status: 503 })
          : Response.json({ id: "mock-billing-message" });
      }
      if (!["localhost", "127.0.0.1"].includes(new URL(address).hostname))
        throw Error("Unexpected external request in test");
      return original(input, init);
    };
    await deliverNotifications(w);
    expect(sends).toBe(0);
    await ok(
      service
        .from("client_payments")
        .update({ refunded_cents: 10000 })
        .eq("id", first.id),
    );
    await queue(7);
    latePayment = true;
    await deliverNotifications(w);
    expect(sends).toBe(0);
    const late = await ok(
      service
        .from("client_payments")
        .select("id")
        .eq("provider_id", "automation-late-" + w)
        .single(),
    );
    await ok(
      service
        .from("client_payments")
        .update({ refunded_cents: 5000 })
        .eq("id", late.id),
    );
    await queue(14);
    await deliverNotifications(w);
    expect(sends).toBe(1);
    await deliverNotifications(w);
    expect(sends).toBe(1);
    failMail = true;
    await queue(21);
    await deliverNotifications(w);
    expect(sends).toBe(2);
    await deliverNotifications(w);
    expect(sends).toBe(2);
    const jobs = await ok(
      admin.from("studio_email_jobs").select("status").eq("workspace_id", w),
    );
    expect(jobs.filter((j: any) => j.status === "Skipped")).toHaveLength(2);
    expect(jobs.filter((j: any) => j.status === "Sent")).toHaveLength(1);
    expect(jobs.filter((j: any) => j.status === "Failed")).toHaveLength(1);
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(values)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
