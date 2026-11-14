import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login, nav } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
const w = "10000000-0000-4000-8000-000000000001";
const service = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
async function auth(email = "admin@studio.test") {
  const c = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  expect(
    (await c.auth.signInWithPassword({ email, password: "Studio-demo-2026!" }))
      .error,
  ).toBeNull();
  return c;
}
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
async function fixtureMember(role = "member") {
  const email = `controls-${Date.now()}@studio.test`;
  const { data, error } = await service.auth.admin.createUser({
    app_metadata: { pms_admin_provisioned: true },
    email,
    password: "Studio-demo-2026!",
    email_confirm: true,
  });
  expect(error).toBeNull();
  await ok(
    service
      .from("workspace_members")
      .insert({
        workspace_id: w,
        user_id: data.user!.id,
        role,
        display_name: "Controls fixture",
      }),
  );
  return auth(email);
}
async function removeMember(c: Awaited<ReturnType<typeof auth>>) {
  const id = (await c.auth.getUser()).data.user!.id;
  await service
    .from("workspace_members")
    .delete()
    .eq("workspace_id", w)
    .eq("user_id", id);
  await service.auth.admin.deleteUser(id);
}
test("Time corrections, deletion, subtasks, mentions and Monitor enforce project permissions", async () => {
  const admin = await auth(),
    member = await fixtureMember(),
    guest = await fixtureMember("client");
  const uid = (await member.auth.getUser()).data.user!.id;
  const p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Record control test",
          access_type: "workspace",
        })
        .select(),
    )
  )[0];
  const guestId = (await guest.auth.getUser()).data.user!.id;
  await ok(
    admin.rpc("manage_project_member", {
      w,
      p: p.id,
      target: guestId,
      project_role: "guest",
    }),
  );
  await ok(
    admin
      .from("projects")
      .update({ client_tools: ["discussions"] })
      .eq("id", p.id),
  );
  try {
    const t = (
      await ok(
        member
          .from("time_entries")
          .insert({
            workspace_id: w,
            project_id: p.id,
            description: "test time",
            minutes: 60,
          })
          .select(),
      )
    )[0];
    await ok(
      member
        .from("time_entries")
        .update({ minutes: 90, description: "Corrected" })
        .eq("id", t.id),
    );
    expect(
      (
        await member
          .from("time_entries")
          .update({ status: "Approved" })
          .eq("id", t.id)
      ).error,
    ).not.toBeNull();
    await ok(
      admin.from("time_entries").update({ status: "Approved" }).eq("id", t.id),
    );
    expect(
      await ok(
        member
          .from("time_entries")
          .update({ minutes: 120 })
          .eq("id", t.id)
          .select(),
      ),
    ).toEqual([]);
    await ok(admin.from("time_entries").update({ minutes: 75 }).eq("id", t.id));
    expect(
      (await ok(admin.from("time_entries").select().eq("id", t.id)))[0].status,
    ).toBe("Submitted");
    await ok(
      admin.from("retainers").insert({
        workspace_id: w,
        project_id: p.id,
        period: new Date().toISOString().slice(0, 7) + "-01",
        hours: 10,
      }),
    );
    expect(
      (await ok(admin.from("retainers").select().eq("project_id", p.id)))[0]
        .used,
    ).toBe(1.25);
    expect(
      await ok(member.from("time_entries").delete().eq("id", t.id).select()),
    ).toEqual([]);
    await ok(admin.from("time_entries").delete().eq("id", t.id));
    expect(
      (await ok(admin.from("retainers").select().eq("project_id", p.id)))[0]
        .used,
    ).toBe(0);
    const parent = (
      await ok(
        member
          .from("tasks")
          .insert({ workspace_id: w, project_id: p.id, title: "parent" })
          .select(),
      )
    )[0];
    const child = (
      await ok(
        member
          .from("tasks")
          .insert({
            workspace_id: w,
            project_id: p.id,
            title: "child",
            parent_task_id: parent.id,
          })
          .select(),
      )
    )[0];
    await ok(member.from("tasks").delete().eq("id", parent.id));
    expect(
      (await ok(member.from("tasks").select().eq("id", child.id)))[0]
        .parent_task_id,
    ).toBeNull();
    const c = (
      await ok(
        member
          .from("comments")
          .insert({
            workspace_id: w,
            project_id: p.id,
            body: "hello",
            mentions: [uid],
          })
          .select(),
      )
    )[0];
    await ok(
      member.from("comments").update({ body: "Edited hello" }).eq("id", c.id),
    );
    expect(
      (await ok(member.from("comments").select().eq("id", c.id)))[0].edited_at,
    ).toBeTruthy();
    expect(
      (
        await member
          .from("comments")
          .update({ created_by: (await admin.auth.getUser()).data.user!.id })
          .eq("id", c.id)
      ).error,
    ).not.toBeNull();
    expect(
      await ok(guest.from("comments").delete().eq("id", c.id).select()),
    ).toEqual([]);
    await ok(member.from("comments").delete().eq("id", c.id));
    const reply = (
      await ok(
        guest
          .from("comments")
          .insert({
            workspace_id: w,
            project_id: p.id,
            body: "Client reply",
            is_published: true,
            mentions: [guestId],
          })
          .select(),
      )
    )[0];
    await ok(
      guest
        .from("comments")
        .update({ body: "Client correction" })
        .eq("id", reply.id),
    );
    expect(
      (await ok(guest.from("comments").select().eq("id", reply.id)))[0].body,
    ).toBe("Client correction");
    await ok(guest.from("comments").delete().eq("id", reply.id));
    for (const table of ["invoices", "estimates"]) {
      const f = (
        await ok(
          admin
            .from(table)
            .insert({
              workspace_id: w,
              project_id: p.id,
              number: "CONTROL-TEST",
              client_name: "Test",
              lines: [{description:"Test work",quantity:1,rate:100}],
            })
            .select(),
        )
      )[0];
      expect(
        await ok(member.from(table).delete().eq("id", f.id).select()),
      ).toEqual([]);
      await ok(admin.from(table).delete().eq("id", f.id));
    }
    const record = (
      await ok(
        admin
          .from("monitor_records")
          .insert({
            workspace_id: w,
            kind: "tasks",
            source_id: "test-" + Date.now(),
            title: "Imported task",
            body: { notes: "Internal diagnostics" },
          })
          .select(),
      )
    )[0];
    expect(
      await ok(member.from("monitor_records").select().eq("id", record.id)),
    ).toEqual([]);
    expect(
      await ok(guest.from("monitor_records").select().eq("id", record.id)),
    ).toEqual([]);
    expect(
      (
        await member.rpc("monitor_create_task", {
          record_id: record.id,
          project: p.id,
        })
      ).error,
    ).not.toBeNull();
    const linked = await ok(
      admin.rpc("monitor_create_task", { record_id: record.id, project: p.id }),
    );
    expect(
      await ok(
        admin.rpc("monitor_create_task", {
          record_id: record.id,
          project: p.id,
        }),
      ),
    ).toBe(linked);
    expect(
      (await ok(admin.from("tasks").select().eq("id", linked)))[0].is_published,
    ).toBe(false);
  } finally {
    for (const table of [
      "monitor_records",
      "comments",
      "time_entries",
      "retainers",
      "tasks",
    ])
      await service
        .from(table)
        .delete()
        .eq(
          table === "monitor_records" ? "linked_project_id" : "project_id",
          p.id,
        );
    await service.from("projects").delete().eq("id", p.id);
    await removeMember(member);
    await removeMember(guest);
  }
});
test("File delete removes the stored object and rejects a guest", async ({
  request,
}) => {
  const admin = await auth(),
    member = await fixtureMember(),
    guest = await auth("client@northstar.test");
  const p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Delete file test",
          access_type: "workspace",
        })
        .select(),
    )
  )[0];
  const token = (await member.auth.getSession()).data.session!.access_token;
  let path = "";
  try {
    const upload = await request.post("/api/storage", {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        workspace: w,
        project: p.id,
        file: {
          name: "delete-test.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Delete this test file"),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    path = (await upload.json()).path;
    const denied = await request.delete(
      "/api/storage?path=" + encodeURIComponent(path),
      {
        headers: {
          Authorization: `Bearer ${(await guest.auth.getSession()).data.session!.access_token}`,
        },
      },
    );
    expect(denied.ok()).toBeFalsy();
    const deleted = await request.delete(
      "/api/storage?path=" + encodeURIComponent(path),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
    expect(
      await ok(admin.from("project_files").select().eq("path", path)),
    ).toEqual([]);
    const download = await service.storage.from("project-files").download(path);
    expect(download.error).toBeTruthy();
  } finally {
    if (path) await service.storage.from("project-files").remove([path]);
    await service.from("project_files").delete().eq("project_id", p.id);
    await service.from("projects").delete().eq("id", p.id);
    await removeMember(member);
  }
});
test("Time edit and deny, task delete, and hover/focus help work in the interface", async ({
  page,
}) => {
  const admin = await auth(),
    stamp = Date.now(),
    title = "Controls UI " + stamp;
  const p = (
    await ok(
      admin
        .from("projects")
        .insert({ workspace_id: w, name: title, brief: "A removable brief" })
        .select(),
    )
  )[0];
  const t = (
    await ok(
      admin
        .from("tasks")
        .insert({ workspace_id: w, project_id: p.id, title })
        .select(),
    )
  )[0];
  await ok(
    admin.from("time_entries").insert({
      workspace_id: w,
      project_id: p.id,
      description: title,
      minutes: 60,
    }),
  );
  try {
    await login(page);
    await nav(page, "Time tracking");
    await page
      .getByRole("button", { name: "Edit " + title, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Description", { exact: true })
      .fill(title + " changed");
    await dialog.getByLabel("Hours", { exact: true }).fill("2.5");
    await dialog
      .getByRole("button", { name: "Save time", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: "Deny " + title + " changed", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Deny permanently", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Deny " + title + " changed",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: title, exact: true }).click();
    const del = page.getByRole("button", {
      name: "Delete " + title,
      exact: true,
    });
    await del.focus();
    await expect(page.getByRole("tooltip")).toContainText("Delete " + title);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await del.click();
    await page
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(del).toHaveCount(0);
    await page.getByRole("button", { name: "Brief", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete project brief", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await expect(
      page.getByText("A removable brief", { exact: true }),
    ).toHaveCount(0);
    await nav(page, "Website Monitor");
    await expect(
      page.getByRole("heading", { name: "Website Monitor", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading Desk records" }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await service.from("time_entries").delete().eq("project_id", p.id);
    await service.from("tasks").delete().eq("id", t.id);
    await service.from("projects").delete().eq("id", p.id);
  }
});

test("Full shape library is available and project selection persists", async ({
  page,
  request,
}) => {
  const admin = await auth();
  const p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Shape library test",
          client_name: "Test client",
          due_date: "2026-12-31",
        })
        .select(),
    )
  )[0];
  try {
    await login(page);
    await page.getByRole("button", { name: p.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog
        .getByRole("group", { name: "Project shape library" })
        .getByRole("button"),
    ).toHaveCount(72);
    await dialog.getByRole("button", { name: "Shape 72", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(
      (await ok(admin.from("projects").select("shape_id").eq("id", p.id)))[0]
        .shape_id,
    ).toBe(72);
    await page.reload();
    await page.getByRole("button", { name: p.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Shape 72", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const n of [1, 36, 72])
      expect(
        (
          await request.get(`/shapes/shape-${String(n).padStart(2, "0")}.svg`)
        ).ok(),
      ).toBeTruthy();
  } finally {
    await service.from("projects").delete().eq("id", p.id);
  }
});
