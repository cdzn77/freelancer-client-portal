import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { login } from "./helpers";
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
async function audit(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
  ).toEqual([]);
}
test("Admin-provisioned account completes a profile and changes password", async ({
  page,
}) => {
  const email = `profile-${Date.now()}@studio.test`,
    initialPassword = "Profile-test-2026!",
    password = "Profile-chosen-2026!",
    newPassword = "Changed-profile-2026!";
  let userId: string | undefined;
  let workspaceId: string | undefined;
  try {
    const created = await admin.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
      app_metadata: {
        pms_admin_provisioned: true,
        pms_password_change_required: true,
      },
      user_metadata: { full_name: "Casey Designer", pms_password_choice: true },
    });
    expect(created.error).toBeNull();
    userId = created.data.user!.id;
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Create an account", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(initialPassword);
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Keep my initial password" }),
    ).toHaveCount(0);
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Save new password", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Continue to workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "A fresh start for your studio" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open my profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your profile.", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Casey Designer",
    );
    await audit(page);
    await page.getByLabel("Full name", { exact: true }).fill("Casey Rivers");
    await page.getByLabel("Job title").fill("Product designer");
    await page.getByLabel("Company or studio").fill("Independent Studio");
    await page
      .getByLabel("A little about you")
      .fill("Thoughtful work for good people.");
    await chooseOption(page.getByLabel("Time zone"), "America/New_York");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.getByText("Your profile is saved.")).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Open my profile", exact: true })
      .click();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Casey Rivers",
    );
    await expect(page.getByLabel("Job title")).toHaveValue("Product designer");
    await page
      .getByRole("button", { name: "New workspace", exact: true })
      .click();
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill(`Profile test ${userId}`);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const members = await admin
      .from("workspace_members")
      .select("*")
      .eq("user_id", userId!);
    workspaceId = members.data?.[0]?.workspace_id;
    expect(members.data?.[0]?.display_name).toBe("Casey Rivers");
    await page
      .getByRole("button", { name: "Open my profile", exact: true })
      .click();
    await page.getByLabel("Full name", { exact: true }).fill("Casey Morgan");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.getByText("Your profile is saved.")).toBeVisible();
    expect(
      (
        await admin
          .from("workspace_members")
          .select("display_name,role")
          .eq("user_id", userId!)
      ).data?.[0],
    ).toEqual({ display_name: "Casey Morgan", role: "owner" });
    await page
      .getByLabel("Current password", { exact: true })
      .fill("Incorrect-password");
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(newPassword);
    await page
      .getByRole("button", { name: "Update password", exact: true })
      .click();
    await expect(
      page.getByText("Your current password is incorrect."),
    ).toBeVisible();
    await page.getByLabel("Current password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Update password", exact: true })
      .click();
    await expect(page.getByText("Your password is updated.")).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await audit(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open my profile", exact: true }),
    ).toBeVisible();
  } finally {
    if (!userId) {
      const users = await admin.auth.admin.listUsers();
      userId = users.data.users.find((u) => u.email === email)?.id;
    }
    if (userId) {
      const members = await admin
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);
      for (const m of members.data || []) {
        await admin
          .from("workspace_members")
          .delete()
          .eq("workspace_id", m.workspace_id);
        await admin.from("workspaces").delete().eq("id", m.workspace_id);
      }
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
test("Existing client has a profile and editable metadata never changes access roles", async ({
  page,
}) => {
  await login(page, "client@northstar.test");
  await page
    .getByRole("button", { name: "Edit profile and password", exact: true })
    .click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Alex Morgan",
  );
  await audit(page);
  const c = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await c.auth.signInWithPassword({
    email: "client@northstar.test",
    password: "Studio-demo-2026!",
  });
  try {
    await c.auth.updateUser({ data: { role: "owner" } });
    expect(
      (
        await c.from("projects").insert({
          workspace_id: "10000000-0000-4000-8000-000000000002",
          name: "Unauthorized profile role",
        })
      ).error,
    ).not.toBeNull();
  } finally {
    await c.auth.updateUser({ data: { role: null } });
  }
});
