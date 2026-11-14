import { createClient } from "@supabase/supabase-js";
import { email } from "../lib/adapters";
// A workspace-scoped user token keeps worker reads subject to RLS.
const {
  SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  PMS_ACCESS_TOKEN,
  PMS_WORKSPACE_ID,
} = process.env;
if (
  !SUPABASE_URL ||
  !NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !PMS_ACCESS_TOKEN ||
  !PMS_WORKSPACE_ID
)
  throw Error("Configure a workspace-scoped worker identity.");
const client = createClient(SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${PMS_ACCESS_TOKEN}` } },
});
async function run() {
  const { data, error } = await client.auth.getUser(PMS_ACCESS_TOKEN);
  if (error || !data.user) throw Error("Worker session expired.");
  const { data: jobs, error: jobError } = await client.rpc(
    "claim_budget_alerts",
    { w: PMS_WORKSPACE_ID },
  );
  if (jobError) throw jobError;
  for (const j of jobs || [])
    await email.send(
      data.user.email!,
      `Budget check: ${j.name}`,
      `${j.name} has used ${Math.round((j.burn / j.amount) * 100)}% of its budget.`,
    );
}
async function loop() {
  try {
    await run();
  } catch (e) {
    console.error((e as Error).message);
  }
  setTimeout(loop, 60000);
}
loop();
