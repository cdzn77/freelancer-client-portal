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
test.use({ actionTimeout: 10000 });
let w = "",
  p = "",
  guest = "",
  task = "",
  thread = "";
const stamp = Date.now(),
  name = `Collaboration UI ${stamp}`,
  email = `collab-ui-${stamp}@example.invalid`;
async function ok(q: PromiseLike<any>) {
  const r = await q;
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
}
test.beforeEach(async () => {
  await ok(
    admin.auth.signInWithPassword({
      email: "admin@studio.test",
      password: "Studio-demo-2026!",
    }),
  );
  w = await ok(admin.rpc("create_workspace", { workspace_name: name }));
  guest = (
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
      user_id: guest,
      role: "client",
      display_name: "Collaboration client",
    }),
  );
  p = (
    await ok(
      admin
        .from("projects")
        .insert({
          workspace_id: w,
          name: "Collaboration project",
          client_name: "Test client",
          access_type: "workspace",
          client_tools: ["tasks", "discussions", "files", "approvals"],
        })
        .select()
        .single(),
    )
  ).id;
  await ok(
    admin.rpc("manage_project_member", {
      w,
      p,
      target: guest,
      project_role: "guest",
      remove_member: false,
    }),
  );
  task = (
    await ok(
      admin
        .from("tasks")
        .insert({
          workspace_id: w,
          project_id: p,
          title: "Approve the homepage",
          description: "Read this task without opening the editor.",
          assignee_id: guest,
        })
        .select()
        .single(),
    )
  ).id;
  thread = (
    await ok(
      admin.rpc("collaboration_command", {
        p_action: "create",
        p_project: p,
        p_payload: {
          title:
            "Shared launch discussion about the vehicle photo requirements and upcoming artwork review",
          hidden: false,
        },
      }),
    )
  ).thread;
  await ok(
    admin.rpc("collaboration_command", {
      p_action: "create",
      p_project: p,
      p_payload: { title: "Internal pricing strategy", hidden: true },
    }),
  );
});
test.afterEach(async () => {
  if (w) await ok(admin.rpc("delete_workspace", { w, confirmed_name: name }));
  if (guest) await service.auth.admin.deleteUser(guest);
});
for (const viewport of [
  { width: 1440, height: 1100 },
  { width: 390, height: 844 },
]) {
  test(`Assigned client opens tasks, discusses and uploads photos at ${viewport.width}px`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    await login(page);
    await page.goto(
      `/?workspace=${w}&page=Projects&project=${p}&section=Tasks&task=${task}`,
    );
    const detail = page.getByRole("dialog", {
      name: "Approve the homepage",
      exact: true,
    });
    await expect(
      detail.getByText("Read this task without opening the editor."),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Edit task", exact: true }),
    ).toBeVisible();
    await expect(detail.getByLabel("Title", { exact: true })).toHaveCount(0);
    await detail
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.goto(
      `/?workspace=${w}&page=Projects&project=${p}&section=Discussions&discussion=${thread}`,
    );
    await expect(
      page.getByRole("heading", {
        name: "Shared launch discussion about the vehicle photo requirements and upcoming artwork review",
        exact: true,
      }),
    ).toBeVisible();
    const clientContext = await browser.newContext({ viewport }),
      client = await clientContext.newPage();
    try {
      await login(client, email);
      await client.goto(
        `/?workspace=${w}&page=Client%20portal&clientProject=${p}&clientView=Project&clientSection=Messages`,
      );
      await expect(
        client.getByRole("button", {
          name: "Shared launch discussion about the vehicle photo requirements and upcoming artwork review",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        client.getByText("Internal pricing strategy", { exact: true }),
      ).toHaveCount(0);
      await client
        .getByRole("button", {
          name: "Shared launch discussion about the vehicle photo requirements and upcoming artwork review",
          exact: true,
        })
        .click();
      await expect(
        client.getByRole("button", { name: "Edit discussion", exact: true }),
      ).toHaveCount(0);
      await client
        .getByRole("textbox", { name: "Comment", exact: true })
        .fill("Here is the client proof.");
      await client.locator("input[type=file]").setInputFiles({
        name: "proof.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBuoAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await client
        .getByRole("button", { name: "Post comment", exact: true })
        .click();
      await expect(
        client.getByText("Here is the client proof.", { exact: true }),
      ).toBeVisible();
      await expect(
        client.getByText("proof.png", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Here is the client proof.", { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await client
        .getByRole("button", { name: "proof.png", exact: true })
        .click();
      const preview = client.getByRole("dialog", {
        name: "proof.png",
        exact: true,
      });
      await expect(
        preview.getByRole("img", { name: "proof.png" }),
      ).toBeVisible();
      await expect(
        preview.getByRole("link", { name: "Download", exact: true }),
      ).toBeVisible();
      await preview
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();

      await page.getByRole("button", { name: "Reply", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Comment", exact: true })
        .fill("Thanks, the proof is ready.");
      await page
        .getByRole("button", { name: "Post comment", exact: true })
        .click();
      await expect(
        client.getByText("Thanks, the proof is ready.", { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await client
        .locator(".discussion-post")
        .first()
        .locator("summary")
        .filter({ hasText: "React" })
        .click();
      await client
        .locator(".discussion-post")
        .first()
        .getByRole("button", { name: "Thumbs up", exact: true })
        .click();
      await expect(
        client.getByRole("button", {
          name: "Thumbs up: Collaboration client",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page: client })
            .include(".discussion-workspace")
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await client.getByRole("button", { name: "Tasks", exact: true }).click();
      await expect(
        client.getByRole("heading", { name: "Your project tasks" }),
      ).toBeVisible();
      await expect(client).toHaveURL(/clientSection=Tasks/);
      await client.reload();
      await expect(
        client.getByRole("heading", { name: "Your project tasks" }),
      ).toBeVisible();
      await client.screenshot({
        path: "test-results/client-tasks-desktop.png",
        fullPage: true,
      });
      await client.setViewportSize({ width: 390, height: 844 });
      expect(
        await client.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await expect(client.locator(".cp-topbar")).toHaveCount(1);
      await expect(client.locator(".client-shell > .main-shell")).toHaveCount(
        1,
      );
      await client.locator(".app-footer").scrollIntoViewIfNeeded();
      await client.evaluate(() => window.scrollTo(0, 0));
      await client.screenshot({
        path: "test-results/client-tasks-mobile.png",
        fullPage: true,
      });
      expect(
        (
          await new AxeBuilder({ page: client })
            .include(".client-shell")
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await client.setViewportSize(viewport);
      await client
        .getByRole("button", { name: "Approve the homepage", exact: true })
        .click();
      const clientTask = client.getByRole("dialog", {
        name: "Approve the homepage",
        exact: true,
      });
      await expect(
        clientTask.getByRole("button", { name: "Edit task", exact: true }),
      ).toHaveCount(0);
      // Large phone images bypass the function payload limit and can be selected together.
      const photo = Buffer.concat([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBuoAAAAASUVORK5CYII=",
          "base64",
        ),
        Buffer.alloc(6 * 1024 * 1024),
      ]);
      await clientTask
        .getByRole("textbox", { name: "Comment", exact: true })
        .fill("Van photos from my phone");
      await clientTask.locator("input[type=file]").setInputFiles([
        { name: "driver-side.png", mimeType: "image/png", buffer: photo },
        { name: "passenger-side.png", mimeType: "image/png", buffer: photo },
      ]);
      await expect(
        clientTask.getByRole("button", {
          name: "Remove pending file",
          exact: true,
        }),
      ).toHaveCount(2);
      await clientTask
        .getByRole("button", { name: "Post comment", exact: true })
        .click();
      await expect(
        clientTask.getByRole("button", {
          name: "driver-side.png",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        clientTask.getByRole("button", {
          name: "passenger-side.png",
          exact: true,
        }),
      ).toBeVisible();
      await clientTask
        .getByRole("button", { name: "driver-side.png", exact: true })
        .click();
      const largePreview = client.getByRole("dialog", {
        name: "driver-side.png",
        exact: true,
      });
      await expect(
        largePreview.getByRole("img", { name: "driver-side.png" }),
      ).toBeVisible();
      await expect(
        largePreview.getByRole("link", { name: "Download", exact: true }),
      ).toBeVisible();
      await largePreview
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      expect(
        await client.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await clientTask.screenshot({
        path: `test-results/client-task-detail-${viewport.width}.png`,
      });
      await clientTask.getByLabel("Your task status").selectOption("Done");
      await expect
        .poll(
          async () =>
            (await admin.from("tasks").select("status").eq("id", task).single())
              .data?.status,
        )
        .toBe("Done");
      await clientTask
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await client.goto(
        `/?workspace=${w}&page=Client%20portal&clientProject=${p}&clientView=Project&clientSection=Messages`,
      );
      await client
        .getByRole("button", { name: "Start discussion", exact: true })
        .click();
      await client
        .getByLabel("Discussion title")
        .fill(`Client started topic ${viewport.width}`);
      await client
        .getByRole("dialog")
        .getByRole("button", { name: "Create discussion", exact: true })
        .click();
      await expect(
        client.getByRole("heading", {
          name: `Client started topic ${viewport.width}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        client.getByRole("button", { name: "Edit discussion", exact: true }),
      ).toBeVisible();
    } finally {
      await clientContext.close();
    }
  });
}

test("Admin shares, pins, mentions, schedules, edits and restores a discussion", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    `/?workspace=${w}&page=Projects&project=${p}&section=Discussions&discussion=${thread}`,
  );
  await page
    .getByRole("button", { name: "Edit discussion", exact: true })
    .click();
  await page.getByLabel("Hidden from clients").check();
  await page
    .getByRole("button", { name: "Save discussion", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("discussion_threads")
            .select("hidden_from_clients")
            .eq("id", thread)
            .single()
        ).data?.hidden_from_clients,
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Edit discussion", exact: true })
    .click();
  await page.getByLabel("Hidden from clients").uncheck();
  await page
    .getByRole("button", { name: "Save discussion", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Manage discussion" })
    .click();
  await page
    .getByRole("button", { name: "Pin discussion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unpin", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("@");
  await page.getByRole("button", { name: "@everyone", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .pressSequentially(" Review the launch proof.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await service
            .from("studio_notifications")
            .select("id")
            .eq("user_id", guest)
            .eq("discussion_id", thread)
            .like("event_key", "discussion-post:%")
        ).data?.length || 0,
    )
    .toBeGreaterThan(0);
  await page
    .locator("summary")
    .filter({ hasText: "Subscribers and reminders" })
    .click();
  await page.getByLabel("Reminder date and time").fill("2027-01-01T10:00");
  await page
    .getByRole("button", { name: "Schedule reminder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel reminder", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move discussion to Trash", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Shared launch discussion about the vehicle photo requirements and upcoming artwork review",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Restore discussion", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Comment", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".discussion-workspace")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("Photo upload tickets enforce ownership, size, and current task access", async ({
  request,
}) => {
  const guestClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const session = await ok(
    guestClient.auth.signInWithPassword({
      email,
      password: "Studio-demo-2026!",
    }),
  );
  const headers = { Authorization: `Bearer ${session.session.access_token}` };
  const taskThread = (
    await ok(
      admin.rpc("collaboration_command", {
        p_action: "ensure_task",
        p_project: p,
        p_payload: { task },
      }),
    )
  ).thread;
  const data = { thread: taskThread, post: null, name: "phone.png", size: 3 };
  expect(
    (await request.post("/api/collaboration/uploads", { data })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/collaboration/uploads", {
        headers,
        data: { ...data, size: 26 * 1024 * 1024 },
      })
    ).status(),
  ).toBe(400);
  const start = await request.post("/api/collaboration/uploads", {
    headers,
    data,
  });
  expect(start.ok(), await start.text()).toBeTruthy();
  const ticket = await start.json();
  await ok(
    guestClient.storage
      .from("collaboration-staging")
      .uploadToSignedUrl(ticket.path, ticket.token, Buffer.from([1, 2, 3])),
  );
  expect(
    (
      await guestClient.storage
        .from("collaboration-staging")
        .download(ticket.path)
    ).error,
  ).toBeTruthy();
  const owner = (await admin.auth.getSession()).data.session!;
  expect(
    (
      await request.put("/api/collaboration/uploads", {
        headers: { Authorization: `Bearer ${owner.access_token}` },
        data: { blob: ticket.blob },
      })
    ).status(),
  ).toBe(400);
  await ok(
    admin
      .from("tasks")
      .update({ is_published: false, assignee_id: null })
      .eq("id", task),
  );
  expect(
    (
      await request.put("/api/collaboration/uploads", {
        headers,
        data: { blob: ticket.blob },
      })
    ).status(),
  ).toBe(400);
  await ok(
    admin
      .from("tasks")
      .update({ is_published: true, assignee_id: guest })
      .eq("id", task),
  );
  const done = await request.put("/api/collaboration/uploads", {
    headers,
    data: { blob: ticket.blob },
  });
  expect(done.ok(), await done.text()).toBeTruthy();
  expect(
    (
      await request.put("/api/collaboration/uploads", {
        headers,
        data: { blob: ticket.blob },
      })
    ).ok(),
  ).toBeTruthy();
  const wrong = await request.post("/api/collaboration/uploads", {
    headers,
    data: { ...data, size: 4 },
  });
  const mismatch = await wrong.json();
  await ok(
    guestClient.storage
      .from("collaboration-staging")
      .uploadToSignedUrl(mismatch.path, mismatch.token, Buffer.from([1, 2, 3])),
  );
  expect(
    (
      await request.put("/api/collaboration/uploads", {
        headers,
        data: { blob: mismatch.blob },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await service
        .from("collaboration_blobs")
        .select("ready")
        .eq("id", mismatch.blob)
        .single()
    ).data?.ready,
  ).toBe(false);
});

for (const viewport of [
  { width: 1440, height: 1100 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`Client account and project screens remain accessible at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    await login(page, email);
    async function checkProjectIdentity() {
      const identity = page.locator(".cp-project-identity");
      await expect(identity).toHaveCount(1);
      await expect(identity).toHaveCSS(
        "background-color",
        "rgb(244, 214, 205)",
      );
      const bounds = await identity.evaluate((element) => {
        const area = element.getBoundingClientRect();
        const icon = element.querySelector(".card-shape")!;
        const r = icon.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          color: getComputedStyle(icon).color,
          inside:
            r.left >= area.left &&
            r.right <= area.right &&
            r.top >= area.top &&
            r.bottom <= area.bottom,
        };
      });
      expect(bounds).toEqual({
        width: 76,
        height: 76,
        color: "rgb(68, 68, 68)",
        inside: true,
      });
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let navigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        navigations++;
    });
    for (const destination of [
      "Home",
      "Projects",
      "Documents",
      "Messages",
      "Your updates",
      "Edit profile and password",
    ]) {
      await page
        .locator(".cp-topbar")
        .getByRole("button", { name: destination, exact: true })
        .click();
      await expect(page.locator("#main-content")).toBeVisible();
      const clipped = await page
        .locator(".cp-topbar button, .account-grid .text-button")
        .evaluateAll((elements) =>
          elements
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent),
        );
      expect(clipped, destination + " control labels fit").toEqual([]);
      await expect(page.getByText("Gathering your workspace...")).toHaveCount(
        0,
      );
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (a) => a.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((a) => a.finished.catch(() => {})),
        );
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        destination,
      ).toBeTruthy();
      const result = await new AxeBuilder({ page })
        .include(".client-shell")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        destination,
      ).toEqual([]);
      if (["Home", "Projects"].includes(destination))
        await checkProjectIdentity();
      await page.screenshot({
        path: `test-results/client-${viewport.width}-${destination.replaceAll(" ", "-")}.png`,
        fullPage: true,
      });
    }
    expect(navigations).toBe(0);
    await page
      .locator(".cp-topbar")
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Request a service", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "UX strategy & audits Find friction and decide what to improve.",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    for (const [label, value] of [
      ["Your name / company *", "Test client"],
      ["Reply email *", email],
      ["Give this request a name *", "Mobile service request"],
      ["Brief and goals *", "Check client experience"],
      ["Which website or product should we review? *", "Local test site"],
      ["Who uses it, and where are they getting stuck? *", "Test clients"],
      ["What would a successful outcome look like? *", "Easy-to-use forms"],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole("button", { name: "Review request", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Send request", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit details", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: "Give this request a name *",
        exact: true,
      }),
    ).toHaveValue("Mobile service request");
    await page
      .getByRole("textbox", { name: "Give this request a name *", exact: true })
      .fill("Updated service request");
    await page
      .getByRole("button", { name: "Change service", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Brand & campaign design Discuss visual identity, messaging, or campaign assets.",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("textarea").nth(1)).toHaveValue("");
    await expect(
      page.getByRole("textbox", { name: "Brief and goals *", exact: true }),
    ).toHaveValue("Check client experience");
    await page
      .getByRole("button", { name: "Change service", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "UX strategy & audits Find friction and decide what to improve.",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("textbox", {
        name: "Which website or product should we review? *",
        exact: true,
      }),
    ).toHaveValue("Local test site");
    await expect(
      page.getByRole("textbox", {
        name: "Give this request a name *",
        exact: true,
      }),
    ).toHaveValue("Updated service request");
    await page
      .getByRole("button", { name: "Review request", exact: true })
      .click();
    await expect(
      page.getByText("Updated service request", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/client-${viewport.width}-request-review.png`,
      fullPage: true,
    });
    expect(navigations).toBe(0);
    await page.goto(
      `/?workspace=${w}&page=Client%20portal&clientProject=${p}&clientView=Project&clientSection=Tasks`,
    );
    await expect(
      page.getByRole("heading", { name: "Your project tasks" }),
    ).toBeVisible();
    await checkProjectIdentity();
    const labels = await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button")
      .allTextContents();
    for (const label of labels) {
      await page
        .getByRole("navigation", { name: "Project sections" })
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (a) => a.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((a) => a.finished.catch(() => {})),
        );
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        label,
      ).toBeTruthy();
      expect(
        await page
          .locator(".discussion-thread-card .text-button")
          .evaluateAll((els) =>
            els.every(
              (el) =>
                el.getBoundingClientRect().right <=
                el.parentElement!.getBoundingClientRect().right,
            ),
          ),
        "Discussion titles fit their cards",
      ).toBeTruthy();
      const result = await new AxeBuilder({ page })
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        label,
      ).toEqual([]);
      await page.screenshot({
        path: `test-results/client-${viewport.width}-project-${label.replaceAll(" ", "-")}.png`,
        fullPage: true,
      });
    }
    expect(navigations).toBe(1);
    expect(errors).toEqual([]);
  });
}

test("Mobile photo queue validates limits and recovers a failed attachment without duplicating the comment", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, email);
  await page.goto(
    `/?workspace=${w}&page=Client%20portal&clientProject=${p}&clientView=Project&clientSection=Tasks`,
  );
  await page
    .getByRole("button", { name: "Approve the homepage", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Approve the homepage",
    exact: true,
  });
  const input = dialog.getByLabel("Attach files");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBuoAAAAASUVORK5CYII=",
    "base64",
  );
  await input.setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText("Choose nonempty files up to 25 MB each.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Remove pending file", exact: true }),
  ).toHaveCount(0);
  await input.setInputFiles(
    Array.from({ length: 11 }, (_, i) => ({
      name: `photo-${i}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await expect(
    page.getByText(
      "Attach up to 10 files per comment. Remove a pending file or send another comment.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Remove pending file", exact: true }),
  ).toHaveCount(0);
  const longName = "van-driver-side-" + "photo".repeat(20) + ".png";
  await input.setInputFiles([
    { name: longName, mimeType: "image/png", buffer: png },
    { name: "retry-photo.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(
    dialog.getByRole("button", { name: "Remove pending file", exact: true }),
  ).toHaveCount(2);
  await dialog.screenshot({
    path: "test-results/mobile-pending-photo-queue.png",
  });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    "Pending filenames fit the task dialog",
  ).toBeTruthy();
  let failed = false;
  await page.route("**/api/collaboration/uploads", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().name === "retry-photo.png" &&
      !failed
    ) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary upload failure" }),
      });
    } else await route.continue();
  });
  await dialog
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Two van photos with one interrupted upload");
  await dialog
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(
    page.getByText(/Comment saved. Some files failed: retry-photo.png/),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    dialog.getByRole("button", { name: "Remove pending file", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: longName, exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "retry-photo.png", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(dialog.locator(".discussion-post")).toHaveCount(1);
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    "Uploaded filenames fit the task dialog",
  ).toBeTruthy();
  await expect(
    dialog.getByRole("button", { name: "Remove pending file", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: longName, exact: true }).click();
  const longPreview = page.getByRole("dialog", { name: longName, exact: true });
  await expect(longPreview.getByRole("img")).toBeVisible();
  expect(
    await longPreview.evaluate((el) => el.scrollWidth <= el.clientWidth),
    "Long preview filenames fit the dialog",
  ).toBeTruthy();
  await longPreview
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "retry-photo.png", exact: true })
    .click();
  const preview = page.getByRole("dialog", {
    name: "retry-photo.png",
    exact: true,
  });
  await expect(preview.getByRole("img")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await preview.getByRole("link", { name: "Download", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("retry-photo.png");
  await preview
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove retry-photo.png", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove attachment", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "retry-photo.png", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Edit comment", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Edit comment", exact: true })
    .fill("Updated photo note");
  await dialog
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  await expect(
    dialog
      .locator(".discussion-post")
      .getByText("Updated photo note", { exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 390])
  test(
    "Admin task editing and multiple photo upload at " + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);
      await page.goto(
        `/?workspace=${w}&page=Projects&project=${p}&section=Tasks&task=${task}`,
      );
      await page
        .getByRole("button", { name: "Edit task", exact: true })
        .click();
      const title =
        "A long admin task title for reviewing multiple vehicle photos and confirming the final production artwork";
      await page.getByLabel("Task name", { exact: true }).fill(title);
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: title, exact: true }).click();
      await page
        .getByRole("textbox", { name: "Comment", exact: true })
        .fill("Admin photo review with two attachments.");
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBuoAAAAASUVORK5CYII=",
        "base64",
      );
      await page.locator("input[type=file]").setInputFiles(
        ["admin-front.png", "admin-side.png"].map((name) => ({
          name,
          mimeType: "image/png",
          buffer: Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]),
        })),
      );
      await page
        .getByRole("button", { name: "Post comment", exact: true })
        .click();
      await expect(
        page
          .getByLabel("Comments", { exact: true })
          .getByText("Admin photo review with two attachments.", {
            exact: true,
          }),
      ).toBeVisible();
      for (const name of ["admin-front.png", "admin-side.png"]) {
        await page.getByRole("button", { name, exact: true }).click();
        const preview = page.getByRole("dialog", { name, exact: true });
        await expect(
          preview.getByRole("img", { name, exact: true }),
        ).toBeVisible();
        await expect(
          preview.getByRole("link", { name: "Download", exact: true }),
        ).toBeVisible();
        await preview
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
      }
      await page.reload();
      await page.getByRole("button", { name: title, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByLabel("Comments", { exact: true })
          .getByText("Admin photo review with two attachments.", {
            exact: true,
          }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "admin-front.png", exact: true }),
      ).toBeVisible();
    },
  );

test("Project colors persist and card icons remain fully visible", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto(`/?workspace=${w}&page=Projects&project=${p}`);
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Project details" });
  await expect(dialog.getByRole("radio")).toHaveCount(12);
  await dialog.getByLabel("Due date", { exact: true }).fill("2026-12-31");
  await dialog.getByRole("radio", { name: "Teal", exact: true }).check();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "Teal", exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.locator(".project-color-picker").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("project-palette-mobile.png"),
    fullPage: false,
  });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const closeNav = page
      .locator(".sidebar.is-open")
      .getByRole("button", { name: "Close navigation", exact: true });
    if (width < 800 && (await closeNav.count())) await closeNav.click();
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const art = page.locator(".project-art.art-teal");
    await expect(art).toHaveCSS("background-color", "rgb(185, 223, 219)");
    const bounds = await art.evaluate((element) => {
      const area = element.getBoundingClientRect();
      const icon = element
        .querySelector(".card-shape")!
        .getBoundingClientRect();
      return {
        width: icon.width,
        height: icon.height,
        inside:
          icon.left >= area.left &&
          icon.right <= area.right &&
          icon.top >= area.top &&
          icon.bottom <= area.bottom,
      };
    });
    expect(bounds).toEqual({ width: 76, height: 76, inside: true });
    await page.screenshot({
      path: info.outputPath(`project-card-${width}.png`),
      fullPage: true,
    });
  }
});
