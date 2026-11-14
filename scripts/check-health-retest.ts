import assert from "node:assert/strict";
import { refreshMonitor } from "../lib/website-monitor";
process.env.SUPABASE_URL = "https://database.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.WEBSITE_MONITOR_WORKSPACE = "test-workspace";
let body: any = {
  access_paused: true,
  pages: [{ status: 403 }],
  complete: false,
};
let requests = 0,
  mode = "deny";
const original = globalThis.fetch;
globalThis.fetch = async (input: any, init: any) => {
  const url = String(input);
  if (url.includes("/rpc/")) return Response.json(true);
  if (url.startsWith("https://database.example")) {
    if (init?.method === "POST" || init?.method === "PATCH") {
      body = JSON.parse(init.body).body;
      return Response.json({});
    }
    return Response.json({ body });
  }
  assert.ok(url.startsWith("https://example.com/"));
  assert.equal(init.redirect, "manual");
  requests++;
  if (mode === "fail") throw Error("network unavailable");
  return new Response("<title>Test</title><h1>Test</h1>", {
    status: mode === "deny" ? 403 : 200,
  });
};
async function main() {
  await refreshMonitor("health");
  assert.equal(requests, 0, "scheduled checks must not retry denied pages");
  await refreshMonitor("health", 7, "home", "mobile", true);
  assert.equal(requests, 4);
  assert.equal(body.access_paused, true);
  await refreshMonitor("health");
  assert.equal(requests, 4);
  mode = "fail";
  await refreshMonitor("health", 7, "home", "mobile", true);
  assert.equal(
    body.access_paused,
    true,
    "network failure does not resume collection",
  );
  await refreshMonitor("health");
  assert.equal(requests, 8);
  mode = "allow";
  await refreshMonitor("health", 7, "home", "mobile", true);
  assert.equal(body.access_paused, false);
  assert.equal(body.complete, true);
  assert.equal(body.error, null);
  await refreshMonitor("health");
  assert.equal(requests, 16);
  console.log(
    "PASS: health pauses persist across denied and failed retests; explicit successful retest restores scheduled checks.",
  );
}
main()
  .finally(() => {
    globalThis.fetch = original;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
