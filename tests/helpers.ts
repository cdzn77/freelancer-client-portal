import { Page, expect } from "@playwright/test";
export async function login(page: Page, email = "admin@studio.test") {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Studio-demo-2026!");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: /^(Main|Client) navigation$/ }),
  ).toBeVisible();
  await expect(page.getByText("Gathering your workspace...")).toHaveCount(0);
}
export async function nav(page: Page, name: string) {
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const target = navigation.getByRole("button", {
    name,
    exact: true,
    includeHidden: true,
  });
  const group = target.locator("xpath=ancestor::details[1]");
  if (
    (await group.count()) &&
    !(await group.evaluate((node) => node.hasAttribute("open")))
  )
    await group.locator("summary").click();
  await target.click();
}
