import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
await page.goto("http://127.0.0.1:3100");
await page.getByLabel("Email address").fill("admin@studio.test");
await page.getByLabel("Password", { exact: true }).fill("Studio-demo-2026!");
await page.getByRole("button", { name: "Open workspace", exact: true }).click();
await page.getByRole("heading", { name: /A good day/ }).waitFor();
await page
  .getByRole("button", { name: "Open navigation", exact: true })
  .click();
await page
  .getByRole("navigation")
  .getByRole("button", { name: "Time tracking", exact: true })
  .click();
await page.waitForTimeout(300);
console.log(
  await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("main *")]
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        right: e.getBoundingClientRect().right,
        width: e.getBoundingClientRect().width,
      }))
      .filter((e) => e.right > innerWidth + 1),
  })),
);
await browser.close();
