import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, nav } from "./helpers";
test.use({ actionTimeout: 10000 });

async function audit(page: Page, label: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  expect
    .soft(
      await page.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
      })),
      label + " page width",
    )
    .toEqual({
      width: page.viewportSize()!.width,
      content: page.viewportSize()!.width,
    });
  const overflow = await page
    .locator(
      (await page.getByRole("dialog").count())
        ? "[role=dialog]"
        : "#main-content",
    )
    .evaluate((root) =>
      [...root.querySelectorAll("button,input,textarea,select,[role=combobox]")]
        .filter((e) => {
          if (e.closest("details:not([open])") && e.tagName !== "SUMMARY")
            return false;
          const r = e.getBoundingClientRect();
          if (
            !r.width ||
            !r.height ||
            getComputedStyle(e).visibility === "hidden"
          )
            return false;
          let p = e.parentElement;
          while (p && p !== root) {
            if (["auto", "scroll"].includes(getComputedStyle(p).overflowX))
              return false;
            p = p.parentElement;
          }
          return r.left < -1 || r.right > innerWidth + 1;
        })
        .map((e) => ({
          tag: e.tagName,
          text: (e.textContent || e.getAttribute("aria-label") || "").slice(
            0,
            90,
          ),
          class: e.className,
        })),
    );
  expect.soft(overflow, label + " offscreen controls").toEqual([]);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect
    .soft(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          summary: n.failureSummary,
        })),
      })),
      label + " accessibility",
    )
    .toEqual([]);
}

for (const width of [1440, 1024, 390, 320])
  test(
    "Admin navigation and project screens at " + width,
    async ({ page }, info) => {
      test.setTimeout(240000);
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1100 : 844,
      });
      await login(page);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let reloads = 0;
      page.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame())
          reloads++;
      });
      for (const name of [
        "Overview",
        "Projects",
        "Inbox",
        "Requests",
        "Documents & payments",
        "My tasks",
        "Calendar",
        "Time tracking",
        "Financials",
        "Client profitability",
        "Blueprints",
        "Studio insights",
        "Team capacity",
        "Custom fields",
        "Website Monitor",
      ]) {
        await nav(page, name);
        await audit(page, name);
        await page.screenshot({
          path: info.outputPath(
            width + "-" + name.replaceAll(/[^a-zA-Z]/g, "-") + ".png",
          ),
          fullPage: true,
        });
      }
      await nav(page, "Projects");
      await page
        .locator("#main-content")
        .getByRole("button")
        .filter({ has: page.getByRole("heading", { level: 2 }) })
        .first()
        .click();
      const tabs = await page.locator(".detail-tabs button").allTextContents();
      for (const name of tabs) {
        await page
          .locator(".detail-tabs")
          .getByRole("button", { name: name.trim(), exact: true })
          .click();
        await audit(page, "Project " + name);
      }
      if (
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .isVisible()
      )
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Workspace settings", exact: true })
        .click();
      await audit(page, "Workspace settings");
      expect(errors).toEqual([]);
      expect(reloads).toBe(0);
    },
  );

for (const width of [1440, 390, 320])
  test("Admin forms and finance tabs at " + width, async ({ page }, info) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
    await login(page);
    async function dialog(name: string) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await audit(page, name);
      await page.screenshot({
        path: info.outputPath(name.replaceAll(/[^a-zA-Z]/g, "-") + ".png"),
        fullPage: true,
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    for (const [section, button] of [
      ["Projects", "New project"],
      ["My tasks", "New task"],
      ["Time tracking", "Log time"],
      ["Blueprints", "New blueprint"],
      ["Team capacity", "Add time off"],
      ["Client profitability", "Add expense"],
      ["Client profitability", "Record payment"],
    ]) {
      await nav(page, section);
      await dialog(button);
    }
    await nav(page, "Financials");
    for (const tab of [
      "Billing records",
      "Billing profiles",
      "Billing automation",
      "Invoices",
      "Estimates",
      "Retainers",
      "Budgets",
      "Studio expenses",
    ]) {
      await page
        .locator(".detail-tabs")
        .getByRole("button", { name: tab, exact: true })
        .click();
      await audit(page, "Finance " + tab);
      if (tab === "Studio expenses") {
        await page
          .locator("summary")
          .filter({ hasText: "More filters" })
          .click();
        await audit(page, "Expanded expense filters");
      }
      if (["Invoices", "Estimates", "Retainers", "Budgets"].includes(tab))
        await dialog(
          "New " +
            (
              {
                Invoices: "invoice",
                Estimates: "estimate",
                Retainers: "retainer",
                Budgets: "budget",
              } as Record<string, string>
            )[tab],
        );
    }
    await nav(page, "My tasks");
    await page.locator(".work-table .task-name").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await audit(page, "Task detail");
    await page.getByRole("button", { name: "Edit task", exact: true }).click();
    await audit(page, "Edit task");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    for (const action of [/^Add subtask to /, /^Dependencies for /]) {
      await page.getByRole("button", { name: action }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await audit(page, "Task row action " + action.source);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await audit(page, "Task board");
  });
