import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { login, nav } from "./helpers";
test("Task creation persists across reload and board updates status", async ({
  page,
}) => {
  await login(page);
  await nav(page, "My tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const name = `Review test ${Date.now()}`;
  await page.getByLabel("Task name").fill(name);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await nav(page, "My tasks");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await chooseOption(page.getByLabel(`Status of ${name}`), "Done");
  await expect(
    page
      .locator(".kanban-column")
      .filter({
        has: page.locator(".column-heading").getByText("Done", { exact: true }),
      })
      .getByText(name, { exact: true }),
  ).toBeVisible();
});
test("PDF is generated and an unauthenticated API call is rejected", async ({
  page,
  request,
}) => {
  await login(page);
  await nav(page, "Financials");
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PDF", exact: true }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect((await request.get("/api/pdf?kind=invoices")).status()).toBe(401);
});
test("Workspace switching clears previous workspace records", async ({
  page,
}) => {
  await login(page);
  await chooseOption(page.getByLabel("Workspace", { exact: true }), {
    label: "Northstar Studio",
  });
  await expect(
    page.getByRole("heading", { name: "Northstar website", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Brand, with a fresh perspective", { exact: true }),
  ).toHaveCount(0);
});
