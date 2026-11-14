import assert from "node:assert/strict";
import { refreshCrawl } from "../lib/monitor-crawl";
process.env.SUPABASE_URL = "https://database.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.WEBSITE_MONITOR_WORKSPACE = "test-workspace";
const original = globalThis.fetch;
let mode = "deny", writes = 0;
const requested: string[] = [];
globalThis.fetch = async (input: any, init: any) => {
  const url = String(input); requested.push(url);
  if (url.includes("/rpc/")) return Response.json(true);
  if (url.startsWith("https://database.example")) {
    if (init?.method === "POST") { writes++; return Response.json({}); }
    return Response.json({body:{error:"Crawl paused: site access was restricted.", previous:[{url:"https://example.com/",status:200}],pages:[]}});
  }
  assert.equal(init.headers["User-Agent"], "PortalMonitor/1.0 (+https://example.com)");
  assert.equal(init.redirect, "manual");
  if (mode === "deny") return new Response("denied", {status:403});
  if (url.endsWith("robots.txt")) return new Response(mode === "robots" ? "User-agent: *\nDisallow: /" : "User-agent: *\nSitemap: https://example.com/sitemap.xml");
  if (url.endsWith("sitemap.xml")) return new Response("<urlset><url><loc>https://example.com/</loc></url></urlset>");
  return new Response("<title>Example Studio</title>");
};
async function main() {
  const paused = await refreshCrawl();
  assert.ok("skipped" in paused);
  assert.equal(requested.filter(x=>x.startsWith("https://example.com")).length,0);
  const denied = await refreshCrawl(true);
  assert.ok("skipped" in denied); assert.equal(writes,0);
  mode = "robots";
  const prohibited = await refreshCrawl(true);
  assert.ok("skipped" in prohibited); assert.equal(writes,0);
  mode = "allow";
  const resumed = await refreshCrawl(true);
  assert.ok("complete" in resumed && resumed.complete); assert.equal(writes,2);
  console.log("PASS: explicit hosted retest preserves denials and robots rules; allowed access resumes and archives the crawl.");
}
main().finally(()=>{globalThis.fetch=original;}).catch(e=>{console.error(e);process.exitCode=1;});
