import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
const service = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const stamp = Date.now(),
  name = `Playbook ${stamp}`,
  email = `playbook-${stamp}@example.invalid`;
let w = "",
  p = "",
  clientId = "",
  leadName = "";
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test.beforeAll(async () => {
  await ok(
    admin.auth.signInWithPassword({
      email: "admin@studio.test",
      password: "Studio-demo-2026!",
    }),
  );
  w = await ok(admin.rpc("create_workspace", { workspace_name: name }));
  leadName = (
    await ok(
      admin
        .from("workspace_members")
        .select("display_name")
        .eq("workspace_id", w)
        .eq("role", "owner")
        .single(),
    )
  ).display_name;
  clientId = (
    await ok(
      service.auth.admin.createUser({
        email,
        password: "Studio-demo-2026!",
        email_confirm: true,
        app_metadata: { pms_admin_provisioned: true },
      }),
    )
  ).user.id;
  await ok(
    service.from("workspace_members").insert({
      workspace_id: w,
      user_id: clientId,
      role: "client",
      display_name: "Audit client",
    }),
  );
  p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "UX audit project",
          client_name: "Audit client",
          access_type: "invite_only",
          client_tools: [],
          holidays: ["2026-10-12"],
        })
        .select()
        .single(),
    )
  ).id;
  await ok(
    admin.rpc("manage_project_member", {
      w,
      p,
      target: clientId,
      project_role: "guest",
      remove_member: false,
    }),
  );
});
test.afterAll(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
  if (clientId) await service.auth.admin.deleteUser(clientId);
});
test("UX starter applies a private/shared plan and clients cannot bypass approval checkpoints", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto(`/?workspace=${w}&page=Blueprints`);
  await page
    .getByRole("button", { name: "Use UX audit starter", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "New blueprint",
    exact: true,
  });
  await expect(
    editor.getByLabel("Blueprint name", { exact: true }),
  ).toHaveValue("UX audit");
  await editor
    .getByRole("button", { name: "Save blueprint", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("button", { name: "View blueprint", exact: true })
    .click();
  const plan = page.getByRole("dialog", { name: "UX audit", exact: true });
  await plan
    .getByRole("combobox", { name: "Project for this blueprint", exact: true })
    .click();
  await page
    .getByRole("option", { name: "UX audit project", exact: true })
    .click();
  await plan
    .getByRole("combobox", { name: "Client contact", exact: true })
    .click();
  await page.getByRole("option", { name: "Audit client", exact: true }).click();
  await plan
    .getByRole("combobox", { name: "Peer reviewer", exact: true })
    .click();
  await page.getByRole("option", { name: leadName, exact: true }).click();
  await plan.getByLabel("Plan start date", { exact: true }).fill("2026-10-09");
  await plan
    .getByRole("button", { name: "Apply blueprint", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await admin.from("tasks").select("id").eq("project_id", p)).data
          ?.length,
    )
    .toBe(20);
  const tasks = await ok(admin.from("tasks").select().eq("project_id", p));
  expect(tasks.reduce((n: number, t: any) => n + t.estimated_minutes, 0)).toBe(
    2790,
  );
  expect(tasks.filter((t: any) => t.approval_required)).toHaveLength(3);
  expect(tasks.filter((t: any) => t.assignee_id === clientId)).toHaveLength(5);
  expect(tasks.filter((t: any) => !t.is_published)).toHaveLength(5);
  expect(
    tasks.find((t: any) => t.title === "Approve: audit scope and goals")
      .due_date,
  ).toBe("2026-10-14");
  await plan.getByRole("button", { name: "Close dialog", exact: true }).click();
  const ctx = await browser.newContext(),
    client = await ctx.newPage();
  try {
    await login(client, email);
    await client.goto(
      `/?workspace=${w}&page=Client%20portal&clientView=Project&clientProject=${p}&clientSection=Tasks`,
    );
    await expect(
      client.getByRole("heading", { name: "Your project tasks" }),
    ).toBeVisible();
    await expect(
      client.getByText("Internal: price follow-on work", { exact: true }),
    ).toHaveCount(0);
    await client
      .getByRole("button", {
        name: "Approve: audit scope and goals",
        exact: true,
      })
      .click();
    const detail = client.getByRole("dialog", {
      name: "Approve: audit scope and goals",
      exact: true,
    });
    await expect(
      detail.getByText("Waiting for a recorded approval.", { exact: false }),
    ).toBeVisible();
    await detail.getByLabel("Your task status").selectOption("Done");
    await expect(
      client.getByText(
        "Record approval of the linked agreement or review version before completing this checkpoint",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await ok(
          admin
            .from("tasks")
            .select("status")
            .eq("id", tasks.find((t: any) => t.approval_required).id)
            .single(),
        )
      ).status,
    ).toBe("To do");
    await detail
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await client
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
    await expect(
      client
        .getByRole("region", { name: "Project discussions", exact: true })
        .getByRole("button", { name: "Decisions", exact: true }),
    ).toBeVisible();
    await expect(
      client
        .getByRole("region", { name: "Project discussions", exact: true })
        .getByRole("button", { name: "Interview guide", exact: true }),
    ).toHaveCount(0);
    await client.setViewportSize({ width: 390, height: 844 });
    expect(
      await client.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page: client })
          .include(".cp-project-content")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    await ctx.close();
  }
});
