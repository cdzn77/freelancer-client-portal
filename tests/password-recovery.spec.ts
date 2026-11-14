import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!;
const local = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
for (const type of ["recovery", "magiclink"] as const) {
  test(`${type} link allows setting a password without the old one`, async ({
    page,
  }) => {
    test.skip(
      !local,
      "Disposable auth fixtures run only against local Supabase",
    );
    const email = `reset-${type}-${Date.now()}@studio.test`;
    const original = "Original-reset-2026!";
    const password = "Updated-reset-2026!";
    const created = await admin.auth.admin.createUser({
      app_metadata: { pms_admin_provisioned: true },
      email,
      password: original,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;
    try {
      const link = await admin.auth.admin.generateLink({
        type,
        email,
        options: { redirectTo: "http://127.0.0.1:3100/" },
      });
      expect(link.error).toBeNull();
      // Exercise the real local verification endpoint and redirect, never a production account.
      await page.goto(link.data.properties!.action_link);
      await expect(
        page.getByRole("heading", { name: "Set your password." }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Set your password." }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Current password", { exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("New password", { exact: true }).fill(password);
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill("Wrong-match-2026!");
      await page.getByRole("button", { name: "Save new password" }).click();
      await expect(page.locator(".error[role=alert]")).toHaveText(
        "The passwords do not match.",
      );
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill(password);
      await page.getByRole("button", { name: "Save new password" }).click();
      await expect(
        page.getByRole("heading", { name: "Your password is saved." }),
      ).toBeVisible();
      const client = createClient(
        url,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      expect(
        (await client.auth.signInWithPassword({ email, password: original }))
          .error,
      ).not.toBeNull();
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      await client.auth.signOut();
      await page.getByRole("button", { name: "Continue to workspace" }).click();
      await expect(
        page.getByRole("heading", { name: "Set your password." }),
      ).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
}
test("Forgot password sends the live-origin redirect and explains expired links", async ({
  page,
}) => {
  let redirect = "";
  await page.route("**/auth/v1/recover**", async (route) => {
    redirect =
      new URL(route.request().url()).searchParams.get("redirect_to") || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/#error=access_denied&error_code=otp_expired");
  await expect(page.locator(".error[role=alert]")).toContainText("expired");
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("reset@example.test");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  expect(redirect).toBe("http://127.0.0.1:3100/");
});
