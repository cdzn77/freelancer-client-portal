import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { refreshChronicles } from "../lib/chronicles-provider";
process.env.SUPABASE_URL = "https://database.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.WEBSITE_MONITOR_WORKSPACE = "test-workspace";
process.env.EMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
const iv = Buffer.alloc(12, 2),
  cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), iv);
cipher.setAAD(Buffer.from("website-monitor-v1:test-workspace"));
const encrypted = Buffer.concat([
  iv,
  cipher.update(
    JSON.stringify({
      google_search: {
        client_id: "test",
        client_secret: "test",
        refresh_token: "test",
      },
    }),
  ),
  cipher.final(),
  cipher.getAuthTag(),
]).toString("base64url");
const url = "https://example.com/chronicles/example/";
let body: any = {
  articles: [{ url, title: "Example", publishedAt: "2026-10-05" }],
  fetched_at: "2026-10-05T00:00:00Z",
};
let feeds = 0,
  inspections = 0,
  allow = false;
const original = globalThis.fetch;
globalThis.fetch = async (input: any, init: any) => {
  const endpoint = String(input);
  if (endpoint.includes("/rpc/")) return Response.json(true);
  if (endpoint.includes("website_monitor_connections"))
    return Response.json({ encrypted_payload: encrypted });
  if (endpoint.startsWith("https://database.example")) {
    if (init?.method === "POST") {
      body = JSON.parse(init.body).body;
      return Response.json({});
    }
    return Response.json({ body });
  }
  if (endpoint.endsWith("feed.xml")) {
    feeds++;
    return allow
      ? new Response(
          `<rss><item><title>Example</title><link>${url}</link><pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate></item></rss>`,
        )
      : new Response("denied", { status: 403 });
  }
  if (endpoint.includes("oauth2"))
    return Response.json({ access_token: "test" });
  assert.ok(endpoint.endsWith("urlInspection/index:inspect"));
  inspections++;
  return Response.json({
    inspectionResult: {
      indexStatusResult: {
        verdict: "PASS",
        coverageState: "Submitted and indexed",
      },
    },
  });
};
async function main() {
  await refreshChronicles();
  assert.equal(body.discoveryPaused, true);
  assert.match(body.discoveryError, /403/);
  assert.equal(body.articles.length, 1);
  assert.equal(body.articles[0].index.verdict, "PASS");
  assert.equal(body.inventory_at, "2026-10-05T00:00:00Z");
  await refreshChronicles();
  assert.equal(feeds, 1);
  assert.equal(
    inspections,
    2,
    "Saved articles continue through the authorized Google API without retrying denied feed",
  );
  allow = true;
  await refreshChronicles(true);
  assert.equal(feeds, 2);
  assert.equal(body.discoveryPaused, false);
  assert.equal(body.discoveryError, undefined);
  console.log(
    "PASS: feed denial pauses discovery, preserves inventory, permits independent Google inspection and requires explicit feed retest.",
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
