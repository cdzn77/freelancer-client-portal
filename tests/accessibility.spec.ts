import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, nav } from "./helpers";
async function audit(page: import("@playwright/test").Page) {
  // Audit settled colors rather than a frame halfway through a tab transition.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary })),
    })),
  ).toEqual([]);
}
test("Foundation: sign-in, workspace creation, dialog focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await audit(page);
  await login(page);
  await audit(page);
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("Work core: list, board and edit dialog", async ({ page }) => {
  await login(page);
  await nav(page, "My tasks");
  await audit(page);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await audit(page);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await audit(page);
  await page.keyboard.press("Escape");
});
test("Phase 1 screens at desktop and mobile widths", async ({ page }) => {
  await login(page);
  for (const name of [
    "Projects",
    "Calendar",
    "Time tracking",
    "Financials",
    "Workspace settings",
  ]) {
    if (name === "Workspace settings")
      await page.getByRole("button", { name, exact: true }).click();
    else await nav(page, name);
    await audit(page);
  }
  await nav(page, "Projects");
  await page
    .locator("#main-content")
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { level: 2 }) })
    .first()
    .click();
  for (const name of ["Tasks", "Timeline", "Calendar", "Brief"]) {
    await page
      .locator(".detail-tabs")
      .getByRole("button", { name, exact: true })
      .click();
    await audit(page);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  for (const name of [
    "Overview",
    "My tasks",
    "Projects",
    "Calendar",
    "Time tracking",
    "Financials",
  ]) {
    await nav(page, name);
    await audit(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});
test("Client portal accessibility and restricted navigation", async ({
  page,
}) => {
  await login(page, "client@northstar.test");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Alex." }),
  ).toBeVisible();
  await audit(page);
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "Financials" }),
  ).toHaveCount(0);
});
