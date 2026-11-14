import {
  availableMinutes,
  matchesTask,
  defaultTaskFilters,
} from "../lib/work-planning";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateStudioSuggestion } from "../lib/studio-ai";
import { planSchema } from "../lib/studio-workflows";
const url = process.env.SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const local = new URL(url);
if (!["localhost", "127.0.0.1"].includes(local.hostname))
  throw Error("Workflow tests require a local backend");
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const password = "Studio-demo-2026!";
const testUsers: string[] = [];
test.afterEach(async () => {
  // Clean only workspaces owned by accounts this test created.
  for (const userId of testUsers.splice(0)) {
    const { data: memberships } = await service
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("role", "owner");
    for (const { workspace_id: w } of memberships || []) {
      const { data: files } = await service
        .from("project_files")
        .select("path")
        .eq("workspace_id", w);
      await service
        .from("deliverables")
        .update({ current_version_id: null })
        .eq("workspace_id", w);
      for (const table of [
        "google_email_connections",
        "studio_email_jobs",
        "email_preferences",
        "intake_links",
        "review_stages",
        "scope_changes",
        "invoice_receipts",
        "invoices",
        "estimates",
        "project_expenses",
        "resource_bookings",
        "task_field_definitions",
        "saved_task_views",
        "task_recurrences",
        "team_capacity",
        "team_time_off",
        "review_feedback",
        "deliverable_versions",
        "deliverables",
        "studio_notifications",
        "studio_ai_usage",
        "work_requests",
        "blueprint_applications",
        "studio_blueprints",
        "dependencies",
        "tasks",
        "comments",
        "project_files",
        "project_members",
        "project_details",
        "project_shared_briefs",
        "audit_log",
      ]) {
        const r = await service.from(table).delete().eq("workspace_id", w);
        expect(r.error, table).toBeNull();
      }
      if (files?.length)
        await service.storage
          .from("project-files")
          .remove(files.map((f) => f.path));
      await service.from("projects").delete().eq("workspace_id", w);
      await service.from("audit_log").delete().eq("workspace_id", w);
      await service.from("workspaces").delete().eq("id", w);
    }
    await service.auth.admin.deleteUser(userId);
  }
});
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
async function account(label: string) {
  const email = `studio-workflow-${label}-${Date.now()}@studio.test`;
  const r = await service.auth.admin.createUser({
    app_metadata: { pms_admin_provisioned: true },
    email,
    password,
    email_confirm: true,
  });
  expect(r.error).toBeNull();
  testUsers.push(r.data.user!.id);
  const c = createClient(url, key, { auth: { persistSession: false } });
  await ok(c.auth.signInWithPassword({ email, password }));
  return { c, id: r.data.user!.id, email };
}

test("Requests convert once; review versions, notification access, and guest isolation are enforced", async () => {
  const [admin, guest, outsider] = await Promise.all([
    account("owner"),
    account("guest"),
    account("outsider"),
  ]);
  const w = await ok(
    admin.c.rpc("create_workspace", {
      workspace_name: "Workflow verification",
    }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: guest.email,
      member_role: "client",
    }),
  );
  const r = (
    await ok(
      guest.c
        .from("work_requests")
        .insert({
          workspace_id: w,
          title: "Website refresh",
          kind: "Website",
          brief: "Clarify the service pages.",
          details: { scope: "Five pages" },
        })
        .select(),
    )
  )[0];
  expect(
    (await outsider.c.from("work_requests").select().eq("id", r.id)).data,
  ).toEqual([]);
  expect(
    (
      await guest.c.from("work_requests").insert({
        workspace_id: w,
        title: "Forged",
        kind: "Other",
        brief: "x",
        status: "Converted",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (await guest.c.rpc("convert_work_request", { request_id: r.id })).error,
  ).not.toBeNull();
  const steps = [
    {
      title: "Discover",
      phase: "Discovery",
      offset_days: 0,
      estimated_minutes: 60,
      after_previous: false,
    },
    {
      title: "Design",
      phase: "Design",
      offset_days: 4,
      estimated_minutes: 180,
      after_previous: true,
    },
  ];
  const b = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .insert({ workspace_id: w, name: "Web plan", steps })
        .select(),
    )
  )[0];
  const results = await Promise.all([
    admin.c.rpc("convert_work_request", {
      request_id: r.id,
      blueprint_id: b.id,
      starts_on: "2026-10-01",
    }),
    admin.c.rpc("convert_work_request", {
      request_id: r.id,
      blueprint_id: b.id,
      starts_on: "2026-10-01",
    }),
  ]);
  for (const x of results) expect(x.error).toBeNull();
  expect(results[0].data).toBe(results[1].data);
  const p = results[0].data;
  const tasks = await ok(
    admin.c.from("tasks").select().eq("project_id", p).order("due_date"),
  );
  expect(tasks).toHaveLength(2);
  expect(tasks[1].due_date).toBe("2026-10-05");
  expect(tasks[1].estimated_minutes).toBe(180);
  expect(
    await ok(admin.c.from("dependencies").select().eq("task_id", tasks[1].id)),
  ).toHaveLength(1);
  expect(await ok(guest.c.from("projects").select().eq("id", p))).toHaveLength(
    0,
  );
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p,
      target: guest.id,
      project_role: "guest",
    }),
  );
  await ok(
    admin.c
      .from("projects")
      .update({ client_tools: ["files", "approvals", "discussions"] })
      .eq("id", p),
  );
  const path = `${w}/${p}/review-one.txt`;
  await ok(
    admin.c.storage
      .from("project-files")
      .upload(path, new Blob(["first version"])),
  );
  const f = (
    await ok(
      admin.c
        .from("project_files")
        .insert({
          workspace_id: w,
          project_id: p,
          path,
          name: "Concept one.txt",
          is_published: true,
        })
        .select(),
    )
  )[0];
  const v = await ok(
    admin.c.rpc("add_deliverable_version", {
      p,
      file: f.id,
      label: "Homepage",
      shared: true,
    }),
  );
  const d = (
    await ok(admin.c.from("deliverables").select().eq("project_id", p))
  )[0];
  expect(
    await ok(guest.c.from("deliverable_versions").select().eq("id", v)),
  ).toHaveLength(1);
  expect(
    await ok(outsider.c.from("deliverable_versions").select().eq("id", v)),
  ).toHaveLength(0);
  expect(
    (
      await outsider.c.rpc("decide_deliverable_version", {
        version_id: v,
        decision: "Approved",
      })
    ).error,
  ).not.toBeNull();
  await ok(
    guest.c.from("review_feedback").insert({
      workspace_id: w,
      project_id: p,
      version_id: v,
      body: "Please adjust the headline.",
      annotation: { type: "image", x: 0.25, y: 0.6 },
    }),
  );
  expect(
    (
      await guest.c
        .from("deliverable_versions")
        .update({ status: "Approved" })
        .eq("id", v)
    ).error,
  ).not.toBeNull();
  const annotated = (
    await ok(admin.c.from("review_feedback").select().eq("version_id", v))
  )[0];
  expect(annotated.annotation).toEqual({ type: "image", x: 0.25, y: 0.6 });
  expect(
    (
      await guest.c.rpc("resolve_review_feedback", {
        feedback: annotated.id,
        resolved: true,
      })
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc("resolve_review_feedback", {
      feedback: annotated.id,
      resolved: true,
    }),
  );
  expect(
    (
      await ok(admin.c.from("review_feedback").select().eq("id", annotated.id))
    )[0].resolved_at,
  ).toBeTruthy();
  await ok(
    admin.c.rpc("resolve_review_feedback", {
      feedback: annotated.id,
      resolved: false,
    }),
  );
  for (const annotation of [
    { type: "image", x: 2, y: 0 },
    { type: "pdf", page: 0 },
    { type: "pdf", page: 1.5 },
    { type: "unknown" },
  ]) {
    expect(
      (
        await guest.c.from("review_feedback").insert({
          workspace_id: w,
          project_id: p,
          version_id: v,
          body: "Invalid anchor",
          annotation,
        })
      ).error,
    ).not.toBeNull();
  }
  await ok(
    guest.c.from("review_feedback").insert({
      workspace_id: w,
      project_id: p,
      version_id: v,
      body: "Page feedback",
      annotation: { type: "pdf", page: 2 },
    }),
  );
  expect(
    (
      await guest.c.from("review_feedback").insert({
        workspace_id: w,
        project_id: p,
        version_id: v,
        body: "Forged resolution",
        resolved_at: new Date().toISOString(),
      })
    ).error,
  ).not.toBeNull();
  const reviewRow = (
    await ok(
      admin.c.from("deliverable_versions").select("deliverable_id").eq("id", v),
    )
  )[0];
  await ok(
    admin.c.rpc("set_studio_item_state", {
      item_kind: "deliverable",
      item_id: reviewRow.deliverable_id,
      next_state: "archive",
    }),
  );
  expect(
    (
      await guest.c.rpc("decide_deliverable_version", {
        version_id: v,
        decision: "Approved",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await guest.c.from("review_feedback").insert({
        workspace_id: w,
        project_id: p,
        version_id: v,
        body: "Archived feedback",
      })
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc("set_studio_item_state", {
      item_kind: "deliverable",
      item_id: reviewRow.deliverable_id,
      next_state: "restore",
    }),
  );
  await ok(
    guest.c.rpc("decide_deliverable_version", {
      version_id: v,
      decision: "Approved",
    }),
  );
  const path2 = `${w}/${p}/review-two.txt`;
  await ok(
    admin.c.storage
      .from("project-files")
      .upload(path2, new Blob(["second version"])),
  );
  const f2 = (
    await ok(
      admin.c
        .from("project_files")
        .insert({
          workspace_id: w,
          project_id: p,
          path: path2,
          name: "Concept two.txt",
          is_published: true,
        })
        .select(),
    )
  )[0];
  const v2 = await ok(
    admin.c.rpc("add_deliverable_version", {
      p,
      file: f2.id,
      label: "Homepage",
      deliverable: d.id,
      shared: true,
    }),
  );
  expect(
    (await ok(guest.c.from("deliverable_versions").select().eq("id", v2)))[0]
      .status,
  ).toBe("Pending");
  expect(
    (
      await guest.c.rpc("decide_deliverable_version", {
        version_id: v,
        decision: "Changes requested",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (await admin.c.from("project_files").delete().eq("id", f.id)).error,
  ).not.toBeNull();
  await admin.c.storage.from("project-files").remove([path]);
  expect(
    (await admin.c.storage.from("project-files").download(path)).error,
  ).toBeNull();
  expect(
    (
      await admin.c
        .from("project_files")
        .update({ path: `${w}/${p}/other.txt` })
        .eq("id", f.id)
    ).error,
  ).not.toBeNull();
  const note = (
    await ok(
      admin.c
        .from("comments")
        .insert({
          workspace_id: w,
          project_id: p,
          body: "Make the headline clearer.",
        })
        .select(),
    )
  )[0];
  const converted = await ok(
    admin.c.rpc("task_from_discussion", { comment_id: note.id }),
  );
  expect(
    await ok(admin.c.rpc("task_from_discussion", { comment_id: note.id })),
  ).toBe(converted);
  expect(
    (await guest.c.rpc("task_from_discussion", { comment_id: note.id })).error,
  ).not.toBeNull();
  const inbox = await ok(
    guest.c.from("studio_notifications").select().eq("workspace_id", w),
  );
  expect(inbox.length).toBeGreaterThan(0);
  expect(inbox.every((n: any) => n.user_id === guest.id)).toBe(true);
  expect(
    (
      await guest.c
        .from("studio_notifications")
        .update({ title: "Forged" })
        .eq("id", inbox[0].id)
    ).error,
  ).not.toBeNull();
  await ok(
    guest.c
      .from("studio_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", inbox[0].id),
  );
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p,
      target: guest.id,
      remove_member: true,
    }),
  );
  expect(
    await ok(guest.c.from("deliverable_versions").select().eq("id", v2)),
  ).toHaveLength(0);
  expect(
    (
      await guest.c.rpc("decide_deliverable_version", {
        version_id: v2,
        decision: "Approved",
      })
    ).error,
  ).not.toBeNull();
});

test("Invalid and cross-workspace blueprints roll back project creation", async () => {
  const admin = await account("rollback");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Rollback checks" }),
  );
  const w2 = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Separate workspace" }),
  );
  const r = (
    await ok(
      admin.c
        .from("work_requests")
        .insert({
          workspace_id: w,
          title: "Atomic request",
          kind: "Other",
          brief: "Test",
        })
        .select(),
    )
  )[0];
  const b = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .insert({
          workspace_id: w,
          name: "Invalid plan",
          steps: [{ title: "Bad", offset_days: -1, estimated_minutes: 1 }],
        })
        .select(),
    )
  )[0];
  expect(
    (
      await admin.c.rpc("convert_work_request", {
        request_id: r.id,
        blueprint_id: b.id,
      })
    ).error,
  ).not.toBeNull();
  expect(
    await ok(admin.c.from("projects").select().eq("workspace_id", w)),
  ).toHaveLength(0);
  const foreign = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .insert({
          workspace_id: w2,
          name: "Other plan",
          steps: [{ title: "Task", offset_days: 0, estimated_minutes: 60 }],
        })
        .select(),
    )
  )[0];
  expect(
    (
      await admin.c.rpc("convert_work_request", {
        request_id: r.id,
        blueprint_id: foreign.id,
      })
    ).error,
  ).not.toBeNull();
  expect(
    (await ok(admin.c.from("work_requests").select().eq("id", r.id)))[0].status,
  ).toBe("Submitted");
});

test("AI is authenticated, scoped, disabled without configuration, and validates generated plans", async ({
  request,
}) => {
  expect((await request.get("/api/studio-ai")).status()).toBe(401);
  const unsigned = await request.post("/api/studio-ai", { data: {} });
  expect(unsigned.status()).toBe(401);
  const admin = await account("ai");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "AI checks" }),
  );
  const { data } = await admin.c.auth.getSession();
  const status = await request.get(`/api/studio-ai?workspaceId=${w}`, {
    headers: { Authorization: `Bearer ${data.session!.access_token}` },
  });
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({
    enabled: false,
    provider: "openai",
    model: null,
  });
  const result = await request.post("/api/studio-ai", {
    headers: { Authorization: `Bearer ${data.session!.access_token}` },
    data: { workspaceId: w, action: "draft_plan", brief: "Plan a website" },
  });
  expect(result.status()).toBe(503);
  const wrong = await request.post("/api/studio-ai", {
    headers: { Authorization: `Bearer ${data.session!.access_token}` },
    data: {
      workspaceId: crypto.randomUUID(),
      action: "draft_plan",
      brief: "Plan a website",
    },
  });
  expect(wrong.status()).toBe(403);
  expect(
    planSchema.safeParse({
      steps: [{ title: "", offset_days: -1, estimated_minutes: 2 }],
    }).success,
  ).toBe(false);
  await expect(
    generateStudioSuggestion("draft_plan", { brief: "x" }),
  ).rejects.toThrow();
});

test("Both AI providers return validated editable drafts without tool execution", async () => {
  const saved = { ...process.env },
    originalFetch = global.fetch;
  const calls: any[] = [];
  try {
    process.env.AI_PROVIDER = "http";
    process.env.ENABLE_PAID_AI = "true";
    process.env.AI_API_KEY = "test-key-not-real";
    process.env.AI_MODEL = "test-model";
    const draft = {
      steps: [
        {
          title: "Confirm scope",
          phase: "Discovery",
          description: "Proposed step",
          offset_days: 0,
          estimated_minutes: 60,
          after_previous: false,
        },
      ],
    };
    for (const provider of ["openai", "anthropic"]) {
      process.env.AI_HTTP_PROVIDER = provider;
      global.fetch = async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(
          JSON.stringify(
            provider === "openai"
              ? { choices: [{ message: { content: JSON.stringify(draft) } }] }
              : { content: [{ type: "text", text: JSON.stringify(draft) }] },
          ),
          { status: 200 },
        );
      };
      expect(
        await generateStudioSuggestion("draft_plan", { brief: "Website" }),
      ).toEqual(draft);
    }
    expect(calls[0].body.store).toBe(false);
    expect(calls.every((c) => !c.body.tools)).toBe(true);
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"steps":[{"title":"Invalid"}]}' }],
        }),
      );
    await expect(generateStudioSuggestion("draft_plan", {})).rejects.toThrow(
      "incomplete or invalid",
    );
    global.fetch = async () => new Response("", { status: 429 });
    await expect(generateStudioSuggestion("draft_plan", {})).rejects.toThrow(
      "429",
    );
    global.fetch = async () => Response.json({ content: [] });
    await expect(generateStudioSuggestion("draft_plan", {})).rejects.toThrow(
      "no usable suggestion",
    );
    global.fetch = async () =>
      Response.json({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: JSON.stringify(draft) }],
      });
    await expect(generateStudioSuggestion("draft_plan", {})).rejects.toThrow(
      "cut short",
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of [
      "AI_PROVIDER",
      "ENABLE_PAID_AI",
      "AI_API_KEY",
      "AI_MODEL",
      "AI_HTTP_PROVIDER",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("AI draft can be edited, saved, applied once, and viewed as an unchanged project snapshot", async () => {
  const admin = await account("ai-save");
  const outsider = await account("ai-outsider");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "AI plan audit" }),
  );
  const saved = { ...process.env },
    originalFetch = global.fetch;
  let draft: any;
  try {
    Object.assign(process.env, {
      AI_PROVIDER: "http",
      ENABLE_PAID_AI: "true",
      AI_API_KEY: "fake-test-key",
      AI_MODEL: "test-model",
      AI_HTTP_PROVIDER: "openai",
    });
    global.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                steps: [
                  {
                    title: "Suggested scope",
                    phase: "Discovery",
                    description: "Review proposal",
                    offset_days: 2,
                    estimated_minutes: 60,
                    after_previous: false,
                  },
                ],
              }),
            },
          },
        ],
      });
    draft = await generateStudioSuggestion("draft_plan", {
      brief: "Plan a website",
    });
  } finally {
    global.fetch = originalFetch;
    for (const key of [
      "AI_PROVIDER",
      "ENABLE_PAID_AI",
      "AI_API_KEY",
      "AI_MODEL",
      "AI_HTTP_PROVIDER",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
  expect(
    await ok(admin.c.from("studio_blueprints").select().eq("workspace_id", w)),
  ).toEqual([]);
  draft.steps[0].title = "My edited scope";
  const b = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .insert({
          workspace_id: w,
          name: "AI-assisted blueprint",
          steps: draft.steps,
        })
        .select(),
    )
  )[0];
  const p = (
    await ok(
      admin.c
        .from("projects")
        .insert({ workspace_id: w, name: "Existing project" })
        .select(),
    )
  )[0];
  await ok(
    admin.c
      .from("tasks")
      .insert({ workspace_id: w, project_id: p.id, title: "Existing task" }),
  );
  const params = {
    blueprint_id: b.id,
    project_id: p.id,
    starts_on: "2026-10-01",
  };
  const applied = await Promise.all([
    admin.c.rpc("apply_studio_blueprint", params),
    admin.c.rpc("apply_studio_blueprint", params),
  ]);
  for (const r of applied) expect(r.error).toBeNull();
  expect(applied[0].data).toBe(applied[1].data);
  const tasks = await ok(admin.c.from("tasks").select().eq("project_id", p.id));
  expect(tasks).toHaveLength(2);
  expect(tasks.find((t: any) => t.title === "My edited scope").due_date).toBe(
    "2026-10-03",
  );
  draft.steps[0].title = "Revised template";
  const updated = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .update({ steps: draft.steps })
        .eq("id", b.id)
        .select(),
    )
  )[0];
  expect(updated.revision).toBe(2);
  const snapshot = (
    await ok(
      admin.c.from("blueprint_applications").select().eq("id", applied[0].data),
    )
  )[0];
  expect(snapshot.blueprint_revision).toBe(1);
  expect(snapshot.steps[0].title).toBe("My edited scope");
  expect(
    (
      await admin.c
        .from("blueprint_applications")
        .update({ blueprint_name: "Tampered" })
        .eq("id", snapshot.id)
    ).error,
  ).not.toBeNull();
  expect(
    (await outsider.c.rpc("apply_studio_blueprint", params)).error,
  ).not.toBeNull();
  expect(
    await ok(
      outsider.c.from("blueprint_applications").select().eq("id", snapshot.id),
    ),
  ).toEqual([]);
});

test("Archive, trash and restore protect linked work and enforce item ownership", async () => {
  const admin = await account("lifecycle"),
    outsider = await account("lifecycle-outsider"),
    guest = await account("lifecycle-guest");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Lifecycle checks" }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: guest.email,
      member_role: "client",
    }),
  );
  const r = (
    await ok(
      guest.c
        .from("work_requests")
        .insert({
          workspace_id: w,
          title: "Lifecycle request",
          kind: "Other",
          brief: "Testing",
        })
        .select(),
    )
  )[0];
  const b = (
    await ok(
      admin.c
        .from("studio_blueprints")
        .insert({
          workspace_id: w,
          name: "Lifecycle blueprint",
          steps: [
            { title: "Keep this task", offset_days: 0, estimated_minutes: 10 },
          ],
        })
        .select(),
    )
  )[0];
  const state = (kind: string, id: string, next: string) => ({
    item_kind: kind,
    item_id: id,
    next_state: next,
  });
  expect(
    (
      await outsider.c.rpc(
        "set_studio_item_state",
        state("request", r.id, "trash"),
      )
    ).error,
  ).not.toBeNull();
  expect(
    (
      await guest.c.rpc(
        "set_studio_item_state",
        state("blueprint", b.id, "trash"),
      )
    ).error,
  ).not.toBeNull();
  await ok(
    guest.c.rpc("set_studio_item_state", state("request", r.id, "archive")),
  );
  expect(
    (await admin.c.rpc("convert_work_request", { request_id: r.id })).error,
  ).not.toBeNull();
  await ok(
    guest.c.rpc("set_studio_item_state", state("request", r.id, "restore")),
  );
  await ok(
    admin.c.rpc("set_studio_item_state", state("blueprint", b.id, "archive")),
  );
  expect(
    (
      await admin.c.rpc("convert_work_request", {
        request_id: r.id,
        blueprint_id: b.id,
      })
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc("set_studio_item_state", state("blueprint", b.id, "restore")),
  );
  const p = await ok(
    admin.c.rpc("convert_work_request", {
      request_id: r.id,
      blueprint_id: b.id,
    }),
  );
  expect(
    (
      await guest.c.rpc(
        "set_studio_item_state",
        state("request", r.id, "trash"),
      )
    ).error,
  ).not.toBeNull();
  for (const [kind, id, table] of [
    ["request", r.id, "work_requests"],
    ["blueprint", b.id, "studio_blueprints"],
  ]) {
    await ok(admin.c.rpc("set_studio_item_state", state(kind, id, "trash")));
    const item = (await ok(admin.c.from(table).select().eq("id", id)))[0];
    expect(item.deleted_at).toBeTruthy();
    await ok(admin.c.rpc("set_studio_item_state", state(kind, id, "restore")));
    const restored = (await ok(admin.c.from(table).select().eq("id", id)))[0];
    expect(restored.deleted_at).toBeNull();
    expect(restored.archived_at).toBeNull();
  }
  expect(
    await ok(admin.c.from("tasks").select().eq("project_id", p)),
  ).toHaveLength(1);
  expect(
    await ok(
      admin.c.from("blueprint_applications").select().eq("project_id", p),
    ),
  ).toHaveLength(1);
  expect(
    (await admin.c.from("studio_blueprints").delete().eq("id", b.id)).error,
  ).not.toBeNull();
  const notification = (
    await ok(
      admin.c.from("studio_notifications").select().eq("workspace_id", w),
    )
  )[0];
  expect(
    (
      await guest.c.rpc(
        "set_studio_item_state",
        state("notification", notification.id, "trash"),
      )
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc(
      "set_studio_item_state",
      state("notification", notification.id, "trash"),
    ),
  );
  expect(
    (
      await ok(
        admin.c.from("studio_notifications").select().eq("id", notification.id),
      )
    )[0].deleted_at,
  ).toBeTruthy();
  await ok(
    admin.c.rpc(
      "set_studio_item_state",
      state("notification", notification.id, "restore"),
    ),
  );
  const d = (
    await ok(
      service
        .from("deliverables")
        .insert({ workspace_id: w, project_id: p, title: "Retained review" })
        .select(),
    )
  )[0];
  expect(
    (
      await guest.c.rpc(
        "set_studio_item_state",
        state("deliverable", d.id, "archive"),
      )
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc("set_studio_item_state", state("deliverable", d.id, "archive")),
  );
  expect(
    (await ok(admin.c.from("deliverables").select().eq("id", d.id)))[0]
      .archived_at,
  ).toBeTruthy();
  await ok(
    admin.c.rpc("set_studio_item_state", state("deliverable", d.id, "restore")),
  );
  expect(
    (
      await admin.c.rpc(
        "set_studio_item_state",
        state("workspaces", w, "trash"),
      )
    ).error,
  ).not.toBeNull();
});

test("Recurring tasks use local dates, deduplicate, preserve month anchors, skip missed dates and respect pauses", async () => {
  const admin = await account("recurring"),
    outsider = await account("recurring-outsider");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Recurring checks" }),
  );
  const p = (
    await ok(
      admin.c
        .from("projects")
        .insert({ workspace_id: w, name: "Recurring project" })
        .select(),
    )
  )[0];
  const input = {
    project: p.id,
    title: "Monthly review",
    description: "Independent task",
    priority: "High",
    assignee: admin.id,
    estimated_minutes: 45,
    cadence: "monthly",
    timezone: "America/New_York",
    starts_on: "2030-01-31",
  };
  expect(
    (await outsider.c.rpc("save_task_recurrence", input)).error,
  ).not.toBeNull();
  expect(
    (
      await admin.c.rpc("save_task_recurrence", {
        ...input,
        timezone: "Invalid/Zone",
      })
    ).error,
  ).not.toBeNull();
  const r = await ok(admin.c.rpc("save_task_recurrence", input));
  expect(
    (
      await admin.c.rpc("run_task_recurrences", {
        only_workspace: w,
        at_time: "2030-01-31T12:00:00Z",
      })
    ).error,
  ).not.toBeNull();
  const run = (date: string) =>
    service.rpc("run_task_recurrences", { only_workspace: w, at_time: date });
  expect(await ok(run("2030-01-31T04:30:00Z"))).toBe(0);
  const results = await Promise.all([
    run("2030-01-31T05:30:00Z"),
    run("2030-01-31T05:30:00Z"),
  ]);
  for (const result of results) expect(result.error).toBeNull();
  expect(results.reduce((n, r) => n + r.data, 0)).toBe(1);
  let tasks = await ok(admin.c.from("tasks").select().eq("project_id", p.id));
  expect(tasks).toHaveLength(1);
  expect(tasks[0].due_date).toBe("2030-01-31");
  expect(tasks[0].estimated_minutes).toBe(45);
  expect(
    (await ok(admin.c.from("task_recurrences").select().eq("id", r)))[0]
      .next_on,
  ).toBe("2030-02-28");
  await ok(
    admin.c.rpc("save_task_recurrence", {
      ...input,
      recurrence: r,
      starts_on: null,
    }),
  );
  expect(await ok(run("2030-02-28T12:00:00Z"))).toBe(1);
  expect(
    (await ok(admin.c.from("task_recurrences").select().eq("id", r)))[0]
      .next_on,
  ).toBe("2030-03-31");
  await ok(
    admin.c.rpc("pause_task_recurrence", { recurrence: r, paused: true }),
  );
  expect(await ok(run("2030-03-31T12:00:00Z"))).toBe(0);
  await ok(
    admin.c.rpc("pause_task_recurrence", { recurrence: r, paused: false }),
  );
  expect(await ok(run("2030-04-15T12:00:00Z"))).toBe(0);
  expect(
    (await ok(admin.c.from("task_recurrences").select().eq("id", r)))[0]
      .next_on,
  ).toBe("2030-04-30");
  await ok(
    admin.c
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", p.id),
  );
  expect(await ok(run("2030-04-30T12:00:00Z"))).toBe(0);
  await ok(
    admin.c.from("projects").update({ archived_at: null }).eq("id", p.id),
  );
  await ok(
    admin.c.rpc("save_task_recurrence", {
      ...input,
      recurrence: r,
      title: "Updated review",
      starts_on: "2030-05-31",
    }),
  );
  expect(await ok(run("2030-05-31T12:00:00Z"))).toBe(1);
  tasks = await ok(admin.c.from("tasks").select().eq("project_id", p.id));
  expect(tasks.filter((t: any) => t.title === "Monthly review")).toHaveLength(
    2,
  );
  expect(tasks.filter((t: any) => t.title === "Updated review")).toHaveLength(
    1,
  );
  expect(
    await ok(outsider.c.from("task_recurrences").select().eq("id", r)),
  ).toEqual([]);
  expect(
    (
      await outsider.c.rpc("pause_task_recurrence", {
        recurrence: r,
        paused: true,
      })
    ).error,
  ).not.toBeNull();
  expect(
    (await outsider.c.rpc("delete_task_recurrence", { recurrence: r })).error,
  ).not.toBeNull();
  await ok(admin.c.rpc("delete_task_recurrence", { recurrence: r }));
  expect(
    await ok(admin.c.from("tasks").select().eq("project_id", p.id)),
  ).toHaveLength(3);
  expect(
    await ok(admin.c.from("task_recurrences").select().eq("id", r)),
  ).toEqual([]);
});

test("Saved views stay personal and capacity accounts for workdays and overlapping leave", async () => {
  const admin = await account("planning"),
    member = await account("planning-member");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Planning checks" }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: member.email,
      member_role: "member",
    }),
  );
  const filters = {
    ...defaultTaskFilters,
    priority: "High",
    owner: "Me",
    due: "Overdue",
    layout: "Board",
  };
  const view = (
    await ok(
      admin.c
        .from("saved_task_views")
        .insert({ workspace_id: w, name: "Urgent", scope: "personal", filters })
        .select(),
    )
  )[0];
  expect(view.filters).toEqual(filters);
  expect(
    await ok(member.c.from("saved_task_views").select().eq("id", view.id)),
  ).toEqual([]);
  expect(
    (
      await member.c.from("saved_task_views").insert({
        workspace_id: w,
        user_id: admin.id,
        name: "Forged",
        scope: "personal",
        filters,
      })
    ).error,
  ).not.toBeNull();
  const task = {
    title: "Draft",
    priority: "High",
    assignee_id: admin.id,
    due_date: "2030-01-01",
    status: "To do",
  } as any;
  expect(matchesTask(task, filters, admin.id, "2030-01-02")).toBe(true);
  expect(
    matchesTask({ ...task, status: "Done" }, filters, admin.id, "2030-01-02"),
  ).toBe(false);
  expect(
    matchesTask(
      { ...task, assignee_id: null },
      filters,
      admin.id,
      "2030-01-02",
    ),
  ).toBe(false);
  const capacity = {
    user_id: member.id,
    daily_minutes: 480,
    weekdays: [1, 2, 3, 4, 5],
  };
  await ok(
    admin.c.from("team_capacity").insert({ workspace_id: w, ...capacity }),
  );
  expect(
    (
      await member.c.from("team_capacity").insert({
        workspace_id: w,
        user_id: admin.id,
        daily_minutes: 480,
        weekdays: [1],
      })
    ).error,
  ).not.toBeNull();
  const leave = [
    {
      id: "a",
      user_id: member.id,
      starts_on: "2030-01-07",
      ends_on: "2030-01-08",
    },
    {
      id: "b",
      user_id: member.id,
      starts_on: "2030-01-08",
      ends_on: "2030-01-09",
    },
  ];
  expect(availableMinutes("2030-01-07", capacity, leave)).toBe(960);
  expect(availableMinutes("2030-01-07", capacity, [])).toBe(2400);
  expect(
    (
      await admin.c.from("team_time_off").insert({
        workspace_id: w,
        user_id: member.id,
        starts_on: "2030-01-09",
        ends_on: "2030-01-08",
      })
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.from("team_time_off").insert({
      workspace_id: w,
      user_id: member.id,
      starts_on: "2030-01-07",
      ends_on: "2030-01-08",
    }),
  );
  const ownLeave = await ok(
    member.c.from("team_time_off").select().eq("workspace_id", w),
  );
  expect(ownLeave).toHaveLength(1);
  expect(ownLeave[0]).toMatchObject({
    user_id: member.id,
    starts_on: "2030-01-07",
    ends_on: "2030-01-08",
  });
  await ok(
    admin.c
      .from("team_time_off")
      .insert({
        workspace_id: w,
        user_id: admin.id,
        starts_on: "2030-01-07",
        ends_on: "2030-01-08",
      }),
  );
  expect(
    await ok(member.c.from("team_time_off").select().eq("workspace_id", w)),
  ).toEqual(ownLeave);
  await ok(admin.c.from("saved_task_views").delete().eq("id", view.id));
  expect(
    await ok(admin.c.from("saved_task_views").select().eq("id", view.id)),
  ).toEqual([]);
});

test("Daily and weekly schedules skip missed work, unassign removed staff and stop for removed owners", async () => {
  const admin = await account("schedule-access"),
    member = await account("schedule-manager");
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Schedule access" }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: member.email,
      member_role: "member",
    }),
  );
  const p = (
    await ok(
      admin.c
        .from("projects")
        .insert({ workspace_id: w, name: "Scheduled work" })
        .select(),
    )
  )[0];
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p: p.id,
      target: member.id,
      project_role: "owner",
    }),
  );
  const input = {
    project: p.id,
    title: "Daily check",
    description: "",
    priority: "Medium",
    assignee: member.id,
    estimated_minutes: 15,
    cadence: "daily",
    timezone: "UTC",
    starts_on: "2030-01-01",
  };
  const daily = await ok(admin.c.rpc("save_task_recurrence", input));
  const weekly = await ok(
    member.c.rpc("save_task_recurrence", {
      ...input,
      title: "Weekly check",
      cadence: "weekly",
    }),
  );
  expect(
    await ok(
      service.rpc("run_task_recurrences", {
        only_workspace: w,
        at_time: "2030-01-08T12:00:00Z",
      }),
    ),
  ).toBe(2);
  expect(
    await ok(admin.c.from("tasks").select().eq("project_id", p.id)),
  ).toHaveLength(2);
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p: p.id,
      target: member.id,
      remove_member: true,
    }),
  );
  expect(
    await ok(
      service.rpc("run_task_recurrences", {
        only_workspace: w,
        at_time: "2030-01-15T12:00:00Z",
      }),
    ),
  ).toBe(1);
  const task = (
    await ok(
      admin.c
        .from("tasks")
        .select()
        .eq("project_id", p.id)
        .eq("due_date", "2030-01-15"),
    )
  )[0];
  expect(task.assignee_id).toBeNull();
  const paused = (
    await ok(admin.c.from("task_recurrences").select().eq("id", weekly))
  )[0];
  expect(paused.enabled).toBe(false);
  expect(paused.last_error).toContain("no longer manages");
  expect(
    (await ok(admin.c.from("task_recurrences").select().eq("id", daily)))[0]
      .enabled,
  ).toBe(true);
});

test("Typed fields, bookings, scope decisions and payment limits enforce workspace permissions", async () => {
  const [admin, guest] = await Promise.all([
    account("operations"),
    account("ops-guest"),
  ]);
  const w = await ok(
    admin.c.rpc("create_workspace", {
      workspace_name: "Operations verification",
    }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: guest.email,
      member_role: "client",
    }),
  );
  const p = (
    await ok(
      admin.c
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Ops project",
          client_tools: ["approvals"],
        })
        .select(),
    )
  )[0];
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p: p.id,
      target: guest.id,
      project_role: "guest",
    }),
  );
  const field = (
    await ok(
      admin.c
        .from("task_field_definitions")
        .insert({ workspace_id: w, name: "Complexity", kind: "number" })
        .select(),
    )
  )[0];
  const task = {
    workspace_id: w,
    project_id: p.id,
    title: "Typed task",
    custom_fields: { [`field:${field.id}`]: "three" },
  };
  expect((await admin.c.from("tasks").insert(task)).error).not.toBeNull();
  await ok(
    admin.c.from("tasks").insert({
      ...task,
      remaining_minutes: 40,
      custom_fields: { [`field:${field.id}`]: "3" },
    }),
  );
  expect(
    await ok(
      guest.c.from("task_field_definitions").select().eq("workspace_id", w),
    ),
  ).toHaveLength(0);
  const booking = {
    workspace_id: w,
    project_id: p.id,
    user_id: admin.id,
    starts_on: "2026-10-01",
    ends_on: "2026-10-03",
    daily_minutes: 120,
  };
  await ok(admin.c.from("resource_bookings").insert(booking));
  expect(
    (await guest.c.from("resource_bookings").insert(booking)).error,
  ).not.toBeNull();
  expect(
    (
      await admin.c
        .from("resource_bookings")
        .insert({ ...booking, ends_on: "2026-09-01" })
    ).error,
  ).not.toBeNull();
  const change = await ok(
    admin.c.rpc("save_scope_change", {
      project: p.id,
      title: "Extra page",
      description: "One additional page",
      amount: 500,
      added_days: 2,
      reviewer: guest.id,
    }),
  );
  expect(
    await ok(guest.c.from("scope_changes").select().eq("id", change)),
  ).toHaveLength(0);
  await ok(
    admin.c.rpc("act_on_scope_change", { change_id: change, action: "submit" }),
  );
  expect(
    (
      await admin.c.rpc("act_on_scope_change", {
        change_id: change,
        action: "approve",
      })
    ).error,
  ).not.toBeNull();
  await ok(
    guest.c.rpc("act_on_scope_change", {
      change_id: change,
      action: "approve",
    }),
  );
  const estimate = await ok(
    admin.c.rpc("act_on_scope_change", {
      change_id: change,
      action: "estimate",
    }),
  );
  expect(
    await ok(
      admin.c.rpc("act_on_scope_change", {
        change_id: change,
        action: "estimate",
      }),
    ),
  ).toBe(estimate);
  expect(
    (
      await admin.c.rpc("save_scope_change", {
        project: p.id,
        change_id: change,
        title: "Changed",
        description: "Changed",
        amount: 1,
        added_days: 0,
        reviewer: guest.id,
      })
    ).error,
  ).not.toBeNull();
  const invoice = (
    await ok(
      admin.c
        .from("invoices")
        .insert({
          workspace_id: w,
          project_id: p.id,
          number: "OPS-1",
          client_name: "Client",
          status: "Draft",
          lines: [{ description: "Work", quantity: 1, rate: 500 }],
        })
        .select(),
    )
  )[0];
  const receipt = {
    invoice: invoice.id,
    amount: 300,
    received_on: "2026-10-01",
    reference: "test",
  };
  expect(
    (await admin.c.rpc("record_invoice_receipt", receipt)).error,
  ).not.toBeNull();
  await ok(
    admin.c.from("invoices").update({ status: "Sent" }).eq("id", invoice.id),
  );
  const simultaneous = await Promise.all([
    admin.c.rpc("record_invoice_receipt", receipt),
    admin.c.rpc("record_invoice_receipt", receipt),
  ]);
  expect(simultaneous.filter((r) => !r.error)).toHaveLength(1);
  expect(
    (await guest.c.rpc("record_invoice_receipt", { ...receipt, amount: 200 }))
      .error,
  ).not.toBeNull();
  await ok(admin.c.rpc("record_invoice_receipt", { ...receipt, amount: 200 }));
  expect(
    (await ok(admin.c.from("invoices").select().eq("id", invoice.id)))[0]
      .status,
  ).toBe("Paid");
  expect(
    await ok(guest.c.from("invoice_receipts").select().eq("workspace_id", w)),
  ).toHaveLength(0);
  const receipts = await ok(
    admin.c.from("invoice_receipts").select().eq("invoice_id", invoice.id),
  );
  expect(
    (await guest.c.rpc("remove_invoice_receipt", { receipt: receipts[0].id }))
      .error,
  ).not.toBeNull();
  await ok(admin.c.rpc("remove_invoice_receipt", { receipt: receipts[0].id }));
  expect(
    (await ok(admin.c.from("invoices").select().eq("id", invoice.id)))[0]
      .status,
  ).toBe("Sent");
});

test("Ordered reviewers prevent bypass; PDF rectangles validate; public intake requires bot proof and is revocable", async ({
  request,
}) => {
  const [admin, guest] = await Promise.all([
    account("routes"),
    account("route-guest"),
  ]);
  const w = await ok(
    admin.c.rpc("create_workspace", { workspace_name: "Routes verification" }),
  );
  await ok(
    admin.c.rpc("add_workspace_member", {
      w,
      member_email: guest.email,
      member_role: "client",
    }),
  );
  const p = (
    await ok(
      admin.c
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Review project",
          client_tools: ["files", "approvals"],
        })
        .select(),
    )
  )[0];
  await ok(
    admin.c.rpc("manage_project_member", {
      w,
      p: p.id,
      target: guest.id,
      project_role: "guest",
    }),
  );
  const file = (
    await ok(
      admin.c
        .from("project_files")
        .insert({
          workspace_id: w,
          project_id: p.id,
          path: `${w}/${p.id}/review.pdf`,
          name: "review.pdf",
          is_published: true,
        })
        .select(),
    )
  )[0];
  const version = await ok(
    admin.c.rpc("add_deliverable_version", {
      p: p.id,
      file: file.id,
      label: "Review",
      shared: true,
    }),
  );
  await ok(
    admin.c.rpc("configure_review_stages", {
      version,
      reviewers: [admin.id, guest.id],
    }),
  );
  const stages = await ok(
    admin.c
      .from("review_stages")
      .select()
      .eq("version_id", version)
      .order("position"),
  );
  expect(
    (
      await guest.c.rpc("decide_review_stage", {
        stage: stages[1].id,
        decision: "Approved",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await admin.c.rpc("decide_deliverable_version", {
        version_id: version,
        decision: "Approved",
      })
    ).error,
  ).not.toBeNull();
  await ok(
    admin.c.rpc("decide_review_stage", {
      stage: stages[0].id,
      decision: "Approved",
    }),
  );
  await ok(
    guest.c.rpc("decide_review_stage", {
      stage: stages[1].id,
      decision: "Approved",
    }),
  );
  expect(
    (
      await ok(admin.c.from("deliverable_versions").select().eq("id", version))
    )[0].status,
  ).toBe("Approved");
  const feedback = {
    workspace_id: w,
    project_id: p.id,
    version_id: version,
    body: "Area comment",
    annotation: {
      type: "pdf",
      page: 1,
      rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    },
  };
  await ok(guest.c.from("review_feedback").insert(feedback));
  expect(
    (
      await guest.c.from("review_feedback").insert({
        ...feedback,
        annotation: {
          ...feedback.annotation,
          rect: { x: 0.9, y: 0, width: 0.5, height: 0.2 },
        },
      })
    ).error,
  ).not.toBeNull();
  const link = (
    await ok(
      admin.c
        .from("intake_links")
        .insert({
          workspace_id: w,
          title: "Design request",
          description: "Tell us about your project",
        })
        .select(),
    )
  )[0];
  expect(
    await ok(guest.c.from("intake_links").select().eq("workspace_id", w)),
  ).toHaveLength(0);
  const publicForm = await request.get(`/api/intake/${link.token}`);
  expect(publicForm.ok()).toBeTruthy();
  expect(await publicForm.json()).toEqual({
    title: "Design request",
    description: "Tell us about your project",
  });
  expect(
    (
      await service.rpc("submit_public_intake", {
        link_token: link.token,
        fingerprint: "a".repeat(64),
        title: "Retired endpoint",
        brief: "Probe",
        client_name: "Example",
        email: "client@example.com",
      })
    ).error?.code,
  ).toBe("42501");
  const submission = crypto.randomUUID();
  const payload = {
    submission_id: submission,
    service: "product-design",
    title: "New website",
    brief: "A studio website",
    client_name: "Example",
    email: "client@example.com",
    answers: ["Redesign", "Five pages", "Prospective clients"],
    budget: "",
    desired_date: "",
    references: "",
    website: "",
  };
  const withoutProof = await request.post(`/api/intake/${link.token}`, {
    data: payload,
  });
  expect(withoutProof.status()).toBe(400);
  expect(
    await ok(admin.c.from("work_requests").select().eq("workspace_id", w)),
  ).toHaveLength(0);
  const args = {
    link_token: link.token,
    submission,
    request_title: payload.title,
    request_brief: payload.brief,
    client: payload.client_name,
    contact_email: payload.email,
    service_details: {
      service_id: payload.service,
      answers: payload.answers,
      contact_email: payload.email,
    },
    desired: null,
  };
  const submitted = await ok(service.rpc("submit_service_intake", args));
  expect(await ok(service.rpc("submit_service_intake", args))).toBe(submitted);
  expect(
    (
      await guest.c.rpc("submit_service_intake", {
        ...args,
        submission: crypto.randomUUID(),
      })
    ).error,
  ).not.toBeNull();
  expect(
    await ok(admin.c.from("work_requests").select().eq("workspace_id", w)),
  ).toHaveLength(1);
  await ok(
    admin.c.from("intake_links").update({ enabled: false }).eq("id", link.id),
  );
  expect((await request.get(`/api/intake/${link.token}`)).status()).toBe(404);
  expect(
    (
      await request.post(`/api/intake/${link.token}`, { data: payload })
    ).status(),
  ).toBe(404);
  expect(
    (
      await service.rpc("submit_service_intake", {
        ...args,
        submission: crypto.randomUUID(),
      })
    ).error,
  ).not.toBeNull();
});

test("Email queue is opt-in, claims are exclusive, credentials private, and preview sends nothing", async () => {
  const admin = await account("email"),
    w = await ok(
      admin.c.rpc("create_workspace", { workspace_name: "Email verification" }),
    );
  await ok(
    service.from("studio_notifications").insert({
      workspace_id: w,
      user_id: admin.id,
      title: "No email",
      event_key: "email-off",
    }),
  );
  expect(
    await ok(admin.c.from("studio_email_jobs").select().eq("workspace_id", w)),
  ).toHaveLength(0);
  await ok(
    admin.c
      .from("email_preferences")
      .upsert({ workspace_id: w, user_id: admin.id, enabled: true }),
  );
  await ok(
    service.from("studio_notifications").insert({
      workspace_id: w,
      user_id: admin.id,
      title: "New email",
      event_key: "email-on",
    }),
  );
  const claims = await Promise.all([
    service.rpc("claim_studio_email_jobs", { only_workspace: w }),
    service.rpc("claim_studio_email_jobs", { only_workspace: w }),
  ]);
  expect(claims.flatMap((r) => r.data || [])).toHaveLength(1);
  expect(
    (await admin.c.rpc("claim_studio_email_jobs", { only_workspace: w })).error,
  ).not.toBeNull();
  expect(
    (
      await admin.c
        .from("google_email_connections")
        .select("encrypted_refresh_token")
    ).error,
  ).not.toBeNull();
  await ok(
    service.from("studio_notifications").insert({
      workspace_id: w,
      user_id: admin.id,
      title: "Preview",
      event_key: "email-preview",
    }),
  );
  const { deliverNotifications } = await import("../lib/studio-email");
  const before = process.env.ENABLE_NOTIFICATION_EMAIL_WORKER;
  delete process.env.ENABLE_NOTIFICATION_EMAIL_WORKER;
  try {
    expect(await deliverNotifications(w)).toEqual({ disabled: true });
    await deliverNotifications(w, true);
    expect(
      (
        await ok(
          admin.c.from("studio_email_jobs").select().eq("workspace_id", w),
        )
      ).some((j: any) => j.status === "Preview"),
    ).toBeTruthy();
  } finally {
    if (before) process.env.ENABLE_NOTIFICATION_EMAIL_WORKER = before;
  }
});

test("Google credentials are encrypted with tamper detection and mail headers reject injection", async () => {
  const { randomBytes } = await import("node:crypto");
  const { seal, unseal, emailMessage, googleToken } =
    await import("../lib/google-email");
  const names = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "EMAIL_TOKEN_ENCRYPTION_KEY",
  ];
  const previous = names.map((n) => process.env[n]);
  const original = globalThis.fetch;
  try {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "http://127.0.0.1:3101/api/email/google/callback";
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const encrypted = seal("test-refresh-token");
    expect(unseal(encrypted)).toBe("test-refresh-token");
    expect(encrypted).not.toContain("test-refresh-token");
    const tampered = Buffer.from(encrypted, "base64url");
    tampered[14] ^= 1;
    expect(() => unseal(tampered.toString("base64url"))).toThrow();
    expect(() =>
      emailMessage(
        "client@example.com\r\nBcc: stranger@example.com",
        "id",
        "https://example.com",
      ),
    ).toThrow();
    const message = Buffer.from(
      emailMessage("client@example.com", "id", "https://example.com"),
      "base64url",
    ).toString();
    expect(message).toContain("From: Example Studio <studio@example.com>");
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return Response.json({ access_token: "mock-access" });
    };
    expect(
      await googleToken({
        grant_type: "refresh_token",
        refresh_token: "test-refresh-token",
      }),
    ).toEqual({ access_token: "mock-access" });
  } finally {
    globalThis.fetch = original;
    names.forEach((n, i) => {
      if (previous[i] === undefined) delete process.env[n];
      else process.env[n] = previous[i];
    });
  }
});

test("Gmail delivery uses the verified sender and marks only confirmed sends, with mocked Google", async () => {
  const admin = await account("gmail-delivery"),
    w = await ok(
      admin.c.rpc("create_workspace", {
        workspace_name: "Gmail transport test",
      }),
    );
  const { randomBytes } = await import("node:crypto");
  const { seal } = await import("../lib/google-email");
  const { deliverNotifications } = await import("../lib/studio-email");
  const values: Record<string, string> = {
    GOOGLE_OAUTH_CLIENT_ID: "mock-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "mock-secret",
    GOOGLE_OAUTH_REDIRECT_URI:
      "http://127.0.0.1:3101/api/email/google/callback",
    EMAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ENABLE_NOTIFICATION_EMAIL_WORKER: "true",
    PMS_PUBLIC_URL: "https://pms.example.test",
  };
  const old = Object.fromEntries(
      Object.keys(values).map((k) => [k, process.env[k]]),
    ),
    original = globalThis.fetch;
  let sends = 0;
  try {
    Object.assign(process.env, values);
    await ok(
      service.from("google_email_connections").insert({
        workspace_id: w,
        sender: "studio@example.com",
        connected_by: admin.id,
        encrypted_refresh_token: seal("mock-refresh"),
      }),
    );
    expect(
      (
        await admin.c
          .from("google_email_connections")
          .select("encrypted_refresh_token")
          .eq("workspace_id", w)
      ).error,
    ).not.toBeNull();
    await ok(
      admin.c
        .from("email_preferences")
        .upsert({ workspace_id: w, user_id: admin.id, enabled: true }),
    );
    await ok(
      service.from("studio_notifications").insert({
        workspace_id: w,
        user_id: admin.id,
        title: "Private project details must not enter email",
        event_key: "mock-delivery",
      }),
    );
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      if (address === "https://oauth2.googleapis.com/token")
        return Response.json({ access_token: "mock-access" });
      if (
        address ===
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
      ) {
        sends++;
        const raw = Buffer.from(
          JSON.parse(String(init?.body)).raw,
          "base64url",
        ).toString();
        expect(raw).toContain("studio@example.com");
        expect(raw).toContain(admin.email);
        expect(raw).not.toContain("Private project details");
        return Response.json({ id: "mock-message" });
      }
      if (!["localhost", "127.0.0.1"].includes(new URL(address).hostname))
        throw Error("Unexpected external request in test");
      return original(input, init);
    };
    await deliverNotifications(w);
    expect(sends).toBe(1);
    expect(
      (
        await ok(
          admin.c.from("studio_email_jobs").select().eq("workspace_id", w),
        )
      )[0].status,
    ).toBe("Sent");
    await deliverNotifications(w);
    expect(sends).toBe(1);
    await ok(
      service.from("studio_notifications").insert({
        workspace_id: w,
        user_id: admin.id,
        title: "Disabled preference",
        event_key: "mock-skipped",
      }),
    );
    await ok(
      admin.c
        .from("email_preferences")
        .update({ enabled: false })
        .eq("workspace_id", w),
    );
    await deliverNotifications(w);
    expect(sends).toBe(1);
    expect(
      (
        await ok(
          admin.c.from("studio_email_jobs").select().eq("workspace_id", w),
        )
      ).some((j: any) => j.status === "Skipped"),
    ).toBeTruthy();
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(values)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
