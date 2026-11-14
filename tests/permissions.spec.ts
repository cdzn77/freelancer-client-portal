import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers";
const url = process.env.SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const password = "Studio-demo-2026!";
async function auth(email: string) {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return c;
}
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test("Project roles isolate private work, guest publication, removal and last administrator", async ({
  request,
}) => {
  const ids: string[] = [];
  let w: string | undefined;
  let path: string | undefined;
  try {
    const stamp = Date.now();
    for (const name of ["admin", "member", "guest"]) {
      const r = await service.auth.admin.createUser({
        app_metadata: { pms_admin_provisioned: true },
        email: `permissions-${name}-${stamp}@studio.test`,
        password,
        email_confirm: true,
      });
      expect(r.error).toBeNull();
      ids.push(r.data.user!.id);
    }
    const [admin, member, guest] = await Promise.all(
      ["admin", "member", "guest"].map((name) =>
        auth(`permissions-${name}-${stamp}@studio.test`),
      ),
    );
    w = await ok(
      admin.rpc("create_workspace", { workspace_name: "Permissions test" }),
    );
    for (const [i, role] of [
      [1, "member"],
      [2, "client"],
    ] as const)
      await ok(
        admin.rpc("add_workspace_member", {
          w,
          member_email: `permissions-${i === 1 ? "member" : "guest"}-${stamp}@studio.test`,
          member_role: role,
        }),
      );
    const p = (
      await ok(
        admin
          .from("projects")
          .insert({
            workspace_id: w,
            name: "Private project",
            brief: "Internal strategy",
          })
          .select(),
      )
    )[0];
    const p2 = (
      await ok(
        admin
          .from("projects")
          .insert({ workspace_id: w, name: "Other private project" })
          .select(),
      )
    )[0];
    expect(await ok(member.from("projects").select())).toEqual([]);
    expect(await ok(guest.from("projects").select())).toEqual([]);
    expect(
      (
        await member.rpc("manage_workspace_member", {
          w,
          target: ids[1],
          new_role: "owner",
        })
      ).error,
    ).not.toBeNull();
    await ok(
      admin.rpc("manage_project_member", {
        w,
        p: p.id,
        target: ids[1],
        project_role: "owner",
      }),
    );
    expect(
      (await ok(member.from("projects").select())).map((x: any) => x.id),
    ).toEqual([p.id]);
    await ok(
      member.rpc("manage_project_member", {
        w,
        p: p.id,
        target: ids[2],
        project_role: "guest",
      }),
    );
    expect(
      (
        await member
          .from("projects")
          .update({ name: "attack" })
          .eq("id", p2.id)
          .select()
      ).data,
    ).toEqual([]);
    const task = (
      await ok(
        member
          .from("tasks")
          .insert({
            workspace_id: w,
            project_id: p.id,
            title: "Internal task",
            assignee_id: ids[1],
          })
          .select(),
      )
    )[0];
    const comment = (
      await ok(
        member
          .from("comments")
          .insert({ workspace_id: w, project_id: p.id, body: "Internal notes" })
          .select(),
      )
    )[0];
    expect(await ok(guest.from("tasks").select())).toEqual([]);
    expect(await ok(guest.from("comments").select())).toEqual([]);
    expect(await ok(guest.from("project_details").select())).toEqual([]);
    expect((await ok(guest.from("projects").select()))[0].brief).toBe("");
    await ok(
      member
        .from("project_shared_briefs")
        .upsert({ workspace_id: w, project_id: p.id, body: "Approved brief" }),
    );
    expect(await ok(guest.from("project_shared_briefs").select())).toEqual([]);
    await ok(
      member
        .from("projects")
        .update({
          client_tools: ["tasks", "discussions", "files", "brief", "approvals"],
        })
        .eq("id", p.id),
    );
    expect(await ok(guest.from("tasks").select())).toEqual([]);
    expect(
      (await ok(guest.from("project_shared_briefs").select()))[0].body,
    ).toBe("Approved brief");
    await ok(
      member.from("tasks").update({ is_published: true }).eq("id", task.id),
    );
    await ok(
      member
        .from("comments")
        .update({ is_published: true })
        .eq("id", comment.id),
    );
    expect((await ok(guest.from("tasks").select())).length).toBe(1);
    await ok(
      guest.from("comments").insert({
        workspace_id: w,
        project_id: p.id,
        body: "Client reply",
        is_published: true,
      }),
    );
    const approval = (
      await ok(
        member
          .from("approvals")
          .insert({
            workspace_id: w,
            project_id: p.id,
            label: "Review",
            is_published: true,
          })
          .select(),
      )
    )[0];
    await ok(
      guest.rpc("decide_approval", {
        approval_id: approval.id,
        decision: "Approved",
      }),
    );
    const token = (await member.auth.getSession()).data.session!.access_token;
    const upload = await request.post("/api/storage", {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        workspace: w!,
        project: p.id,
        file: {
          name: "private.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Private file"),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    path = (await upload.json()).path;
    const guestToken = (await guest.auth.getSession()).data.session!
      .access_token;
    expect(
      (
        await request.get(`/api/storage?path=${encodeURIComponent(path!)}`, {
          headers: { Authorization: `Bearer ${guestToken}` },
        })
      ).status(),
    ).toBe(404);
    await ok(
      member
        .from("project_files")
        .update({ is_published: true })
        .eq("path", path!),
    );
    const shared = await request.get(
      `/api/storage?path=${encodeURIComponent(path!)}`,
      { headers: { Authorization: `Bearer ${guestToken}` } },
    );
    expect(shared.ok(), await shared.text()).toBeTruthy();
    await ok(
      member.from("projects").update({ client_tools: [] }).eq("id", p.id),
    );
    expect(await ok(guest.from("tasks").select())).toEqual([]);
    expect(await ok(guest.from("project_shared_briefs").select())).toEqual([]);
    expect(
      (
        await guest.rpc("decide_approval", {
          approval_id: approval.id,
          decision: "Approved",
        })
      ).error,
    ).not.toBeNull();
    await ok(
      admin
        .from("projects")
        .update({ access_type: "workspace" })
        .eq("id", p2.id),
    );
    expect((await ok(member.from("projects").select())).length).toBe(2);
    expect((await ok(guest.from("projects").select())).length).toBe(1);
    await ok(
      admin.rpc("manage_project_member", {
        w,
        p: p.id,
        target: ids[1],
        project_role: "member",
      }),
    );
    expect(
      (
        await member
          .from("tasks")
          .update({ is_published: false })
          .eq("id", task.id)
      ).error,
    ).not.toBeNull();
    await ok(
      member
        .from("tasks")
        .update({ title: "Member revision" })
        .eq("id", task.id),
    );
    expect(
      (await ok(admin.from("tasks").select().eq("id", task.id)))[0]
        .is_published,
    ).toBe(false);
    expect(
      (await member.rpc("claim_budget_alerts", { w })).error,
    ).not.toBeNull();
    await ok(
      admin
        .from("budgets")
        .insert({ workspace_id: w, project_id: p.id, amount: 1000 }),
    );
    expect(await ok(member.from("budgets").select())).toEqual([]);
    await ok(
      admin.rpc("manage_workspace_member", {
        w,
        target: ids[1],
        remove_member: true,
      }),
    );
    expect(await ok(member.from("projects").select())).toEqual([]);
    expect(
      (await ok(admin.from("tasks").select().eq("id", task.id)))[0].assignee_id,
    ).toBeNull();
    for (const args of [{ new_role: "member" }, { remove_member: true }])
      expect(
        (
          await admin.rpc("manage_workspace_member", {
            w,
            target: ids[0],
            ...args,
          })
        ).error?.message,
      ).toContain("at least one");
  } finally {
    if (path) await service.storage.from("project-files").remove([path]);
    if (w) await service.from("workspaces").delete().eq("id", w);
    for (const id of ids) await service.auth.admin.deleteUser(id);
  }
});
test("Administrator can edit roles and remove members through the interface", async ({
  page,
}) => {
  const email = `permissions-ui-${Date.now()}@studio.test`;
  const created = await service.auth.admin.createUser({
    app_metadata: { pms_admin_provisioned: true },
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Permission Test Person" },
  });
  expect(created.error).toBeNull();
  const id = created.data.user!.id;
  const w = "10000000-0000-4000-8000-000000000001";
  try {
    await ok(
      service.from("workspace_members").insert({
        workspace_id: w,
        user_id: id,
        role: "member",
        display_name: "Permission Test Person",
      }),
    );
    await login(page);
    await page
      .getByRole("button", { name: "Workspace settings", exact: true })
      .click();
    await chooseOption(
      page.getByLabel("Account role for Permission Test Person"),
      "client",
    );
    await expect
      .poll(
        async () =>
          (
            await service
              .from("workspace_members")
              .select("role")
              .eq("workspace_id", w)
              .eq("user_id", id)
              .single()
          ).data?.role,
      )
      .toBe("client");
    await expect(
      page.getByLabel("Account role for Permission Test Person"),
    ).toHaveText("Client / Guest");
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations.map((v) => v.id)).toEqual([]);
    await page
      .getByRole("button", {
        name: "Remove Permission Test Person",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(
      page.getByLabel("Account role for Permission Test Person"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button")
      .filter({ hasText: "Brand, with a fresh perspective" })
      .last()
      .click();
    await page.getByRole("button", { name: "Access", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Project access", exact: true }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  } finally {
    await service
      .from("workspace_members")
      .delete()
      .eq("workspace_id", w)
      .eq("user_id", id);
    await service.auth.admin.deleteUser(id);
  }
});

test("Project access settings persist through the interface", async ({
  page,
}) => {
  const c = await auth("admin@studio.test");
  const w = "10000000-0000-4000-8000-000000000001";
  const name = `Permissions UI project ${Date.now()}`;
  const p = (
    await ok(
      c
        .from("projects")
        .insert({ workspace_id: w, name, brief: "Private planning" })
        .select(),
    )
  )[0];
  try {
    await login(page);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Access", exact: true }).click();
    await chooseOption(
      page.getByRole("combobox", { name: "Project access", exact: true }),
      "workspace",
    );
    await page.getByRole("checkbox", { name: "Brief", exact: true }).check();
    await page
      .getByRole("textbox", { name: "Guest-facing brief" })
      .fill("Approved client introduction");
    await page
      .getByRole("button", { name: "Save access settings", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Access settings saved",
    );
    expect(
      (await ok(c.from("projects").select().eq("id", p.id)))[0].access_type,
    ).toBe("workspace");
    expect(
      (
        await ok(
          c.from("project_shared_briefs").select().eq("project_id", p.id),
        )
      )[0].body,
    ).toBe("Approved client introduction");
    await page.reload();
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Access", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Project access", exact: true }),
    ).toHaveText("All regular users in this workspace");
    await expect(
      page.getByRole("textbox", { name: "Guest-facing brief" }),
    ).toHaveValue("Approved client introduction");
  } finally {
    await service.from("projects").delete().eq("id", p.id);
  }
});
