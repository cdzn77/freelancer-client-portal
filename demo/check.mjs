import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../demo-dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".pdf": "application/pdf" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(root + path.sep)) throw Error("Invalid path");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const local = `http://127.0.0.1:${server.address().port}`;
const base = process.env.DEMO_URL || local;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = [], external = [], badResponses = [];
page.on("pageerror", e => { errors.push(e.message); console.error("Browser error:", e.stack); });
page.on("request", r => { if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
page.on("response", r => { if (r.status() >= 400) badResponses.push([r.status(), r.url()]); });
const workspace = "10000000-0000-4000-8000-000000000001";
try {
  const pages = ["Overview", "Projects", "Inbox", "Requests", "My tasks", "Calendar", "Time tracking", "Documents & payments", "Financials", "Blueprints", "Studio insights", "Team capacity", "Custom fields", "Client profitability"];
  for (const name of pages) {
    await page.goto(`${base}/?workspace=${workspace}&page=${encodeURIComponent(name)}`);
    await page.getByRole("button", { name: "Client view", exact: true }).waitFor();
    await page.waitForTimeout(180);
    assert.equal(await page.getByText("Let’s reopen the demo.").count(), 0, name + " crashed");
    assert.equal(await page.locator(".loading").count(), 0, name + " still loading");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + " overflow");
    console.log("Opened", name);
  }
  await page.goto(base);
  await page.getByRole("button", { name: "Add a task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="title"]').fill("Explore the public demo");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Task added", { exact: true }).waitFor();
  await page.goto(base); // Reload intentionally restores sample data.
  assert.equal(await page.getByText("Explore the public demo", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Client view", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".client-shell").count(), 1);
  await page.screenshot({ path: "/private/tmp/freelancer-demo-client.png", fullPage: true });
  await page.getByRole("button", { name: "View your projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project", exact: true }).first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.getByText("Let’s reopen the demo.").count(), 0);
  console.log("Client project opened", (await page.locator('main').innerText()).slice(0,600));
  await page.getByRole("button", { name: "Freelancer", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile overflow");
  await page.screenshot({ path: "/private/tmp/freelancer-demo-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Client view", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile client overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Freelancer", exact: true }).click();
  await page.screenshot({ path: "/private/tmp/freelancer-demo-desktop.png", fullPage: true });
  assert.deepEqual(errors, [], "Browser errors");
  assert.deepEqual(external, [], "Unexpected external requests");
  assert.deepEqual(badResponses, [], "Missing assets or failed requests");
  console.log("Demo verified: navigation, task creation, reload reset, client view, desktop/mobile layout, and no external requests.");
} finally { await browser.close(); server.close(); }
