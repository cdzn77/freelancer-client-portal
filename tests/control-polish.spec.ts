import { test, expect } from "@playwright/test";
import { login, nav } from "./helpers";
test("Task filter menus preserve selection and keyboard dismissal", async ({
  page,
}) => {
  await login(page);
  await nav(page, "My tasks");
  const status = page.getByRole("button", {
    name: "Filter tasks by status",
    exact: true,
  });
  await status.click();
  await page.getByRole("menuitemradio", { name: "Done", exact: true }).click();
  await expect(status).toHaveText("Done");
  await status.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Done", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(status).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const saved = page.getByRole("button", {
    name: "Your saved views",
    exact: true,
  });
  await saved.click();
  await page
    .getByRole("menuitemradio", { name: "Default view", exact: true })
    .click();
  await expect(status).toHaveText("All tasks");
  await page.setViewportSize({ width: 390, height: 844 });
  await status.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
});
