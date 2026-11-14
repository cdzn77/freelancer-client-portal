import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
process.loadEnvFile(".env");
const url = process.env.SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url || ""))
  throw Error("This fixture test requires local Supabase.");
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }),
  anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const base = process.env.EXPENSE_TEST_URL || "http://127.0.0.1:3101";
let user, w, client;
try {
  const password = crypto.randomUUID() + "Aa1!",
    email = `expenses-${Date.now()}@studio.test`;
  const u = await service.auth.admin.createUser({
    app_metadata: { pms_admin_provisioned: true },
    email,
    password,
    email_confirm: true,
  });
  if (u.error) throw u.error;
  user = u.data.user.id;
  client = createClient(url, anon, { auth: { persistSession: false } });
  const auth = await client.auth.signInWithPassword({ email, password });
  if (auth.error) throw auth.error;
  const made = await client.rpc("create_workspace", {
    workspace_name: "Expense report test",
  });
  if (made.error) throw made.error;
  w = made.data;
  const insert = await client
    .from("studio_cost_payments")
    .insert([
      {
        workspace_id: w,
        name: "AI subscription",
        category: "AI services",
        amount: 19.99,
        frequency: "Monthly",
        paid_on: "2026-01-02",
        vendor: "Test vendor",
        receipt_reference: "RECEIPT-101",
      },
      {
        workspace_id: w,
        name: "Design software",
        category: "Software & subscriptions",
        amount: 120,
        frequency: "Annually",
        paid_on: "2026-02-01",
        vendor: "",
        receipt_reference: "",
      },
    ])
    .select();
  if (insert.error) throw insert.error;
  const ids = insert.data.map((r) => r.id),
    payload = { workspace: w, ids, from: "2026-01-01", to: "2026-12-31" };
  const send = (body, token = auth.data.session.access_token) =>
    fetch(base + "/api/studio-expenses/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await send(payload, "")).status, 401);
  const pdf = await send(payload);
  assert.equal(
    pdf.status,
    200,
    await (pdf.status === 200 ? Promise.resolve("") : pdf.text()),
  );
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const data = Buffer.from(await pdf.arrayBuffer());
  assert.equal(data.subarray(0, 4).toString(), "%PDF");
  writeFileSync("/tmp/studio-expense-report-test.pdf", data);
  assert.equal(
    (await send({ ...payload, ids: [...ids, crypto.randomUUID()] })).status,
    409,
  );
  assert.equal((await send({ ...payload, from: "2026-02-01" })).status, 409);
  await service
    .from("workspace_members")
    .update({ role: "member" })
    .eq("workspace_id", w)
    .eq("user_id", user);
  assert.equal((await send(payload)).status, 403);
  console.log(
    "PASS: real PDF export, signed-out and nonadmin rejection, missing/out-of-range selection rejection.",
  );
} finally {
  if (w) {
    await service
      .from("workspace_members")
      .update({ role: "owner" })
      .eq("workspace_id", w)
      .eq("user_id", user);
    const result = await client.rpc("delete_workspace", {
      w,
      confirmed_name: "Expense report test",
    });
    if (result.error) throw result.error;
  }
  if (user) await service.auth.admin.deleteUser(user);
}
