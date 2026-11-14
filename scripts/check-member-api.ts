import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { POST } from "../app/api/workspace/members/route";
const url = process.env.SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const anon = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const run = randomUUID();
const suffix = "@example.invalid";
const emails = new Set(
  ["admin", "client", "member", "blocked"].map(
    (role) => `pms-invite-${role}-${run}${suffix}`,
  ),
);
const email = (role: string) => `pms-invite-${role}-${run}${suffix}`;
const password = "Fixture!" + randomUUID();
let w: string | undefined;
let ownerClient: ReturnType<typeof anon> | undefined;
async function main() {
  try {
    const owner = await admin.auth.admin.createUser({
      email: email("admin"),
      password,
      email_confirm: true,
      app_metadata: { pms_admin_provisioned: true },
    });
    if (owner.error)
      throw Error(
        "Fixture administrator creation failed: " +
          owner.error.code +
          " " +
          owner.error.message,
      );
    const c = anon();
    ownerClient = c;
    const login = await c.auth.signInWithPassword({
      email: email("admin"),
      password,
    });
    assert.ok(!login.error, "Fixture sign-in failed");
    const token = login.data.session!.access_token;
    const made = await c.rpc("create_workspace", {
      workspace_name: "DISPOSABLE invitation test " + run,
    });
    assert.ok(!made.error, "Fixture workspace creation failed");
    w = made.data;
    const project = await c
      .from("projects")
      .insert({
        workspace_id: w,
        name: "Shared test project",
        created_by: owner.data.user!.id,
      })
      .select("id")
      .single();
    assert.ok(!project.error, "Fixture project creation failed");
    const hidden = await c
      .from("projects")
      .insert({
        workspace_id: w,
        name: "Private test project",
        created_by: owner.data.user!.id,
      })
      .select("id")
      .single();
    assert.ok(!hidden.error, "Private fixture project creation failed");
    async function post(body: object, t: string | null = token) {
      return POST(
        new Request("https://pms.test/api/workspace/members", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(t ? { Authorization: `Bearer ${t}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    }
    const input = {
      workspace: w,
      mode: "create",
      email: email("client"),
      name: "Fixture client",
      password,
      role: "client",
      project: project.data!.id,
    };
    assert.equal((await post(input, null)).status, 401);
    assert.equal(
      (await post({ ...input, workspace: randomUUID() })).status,
      403,
    );
    assert.equal((await post({ ...input, project: randomUUID() })).status, 400);
    const madeClient = await post(input);
    assert.equal(madeClient.status, 200, "Admin client creation failed");
    const result = await madeClient.json();
    assert.equal(result.created, true);
    assert.equal(result.role, "client");
    assert.equal(
      (await post(input)).status,
      409,
      "Existing password must not be overwritten",
    );
    const repeat = await post({ ...input, mode: "existing", role: "owner" });
    assert.equal(repeat.status, 200);
    const repeated = await repeat.json();
    assert.equal(repeated.role, "client");
    assert.equal(repeated.already_member, true);
    const guest = anon();
    const guestLogin = await guest.auth.signInWithPassword({
      email: email("client"),
      password,
    });
    assert.ok(!guestLogin.error, "Initial client password failed");
    assert.equal(guestLogin.data.user!.user_metadata.pms_password_choice, true);
    assert.equal(
      guestLogin.data.user!.app_metadata.pms_password_change_required,
      true,
    );
    assert.ok(
      (await guest.from("projects").select("id")).error,
      "Temporary password accessed data",
    );
    await guest.auth.updateUser({
      data: { pms_password_choice: false, pms_password_change_required: false },
    });
    assert.ok(
      (await guest.from("projects").select("id")).error,
      "User metadata bypassed password gate",
    );
    const nextPassword = "Changed!" + randomUUID();
    assert.ok(!(await guest.auth.updateUser({ password: nextPassword })).error);
    const visible = await guest
      .from("projects")
      .select("id")
      .eq("workspace_id", w!);
    assert.deepEqual(
      visible.data?.map((p) => p.id),
      [project.data!.id],
      "Guest saw private project",
    );
    const denied = await post(
      { ...input, email: email("member") },
      guestLogin.data.session!.access_token,
    );
    assert.equal(denied.status, 403, "Guest can provision accounts");
    const staff = await post({
      ...input,
      email: email("member"),
      name: "Fixture member",
      role: "member",
      project: null,
    });
    assert.equal(staff.status, 200);
    const staffSession = anon();
    const staffLogin = await staffSession.auth.signInWithPassword({
      email: email("member"),
      password,
    });
    assert.ok(!staffLogin.error);
    assert.ok(
      !(
        await staffSession.auth.updateUser({
          password: "StaffChanged!" + randomUUID(),
        })
      ).error,
    );
    assert.equal(
      (
        await post(
          { ...input, email: email("blocked") },
          staffLogin.data.session!.access_token,
        )
      ).status,
      403,
      "Regular member can provision accounts",
    );
    assert.ok(
      (
        await anon().auth.signInWithPassword({
          email: email("client"),
          password,
        })
      ).error,
      "Old password still works",
    );
    assert.ok(
      !(
        await anon().auth.signInWithPassword({
          email: email("client"),
          password: nextPassword,
        })
      ).error,
      "Changed password rejected",
    );
    const blocked = await anon().auth.signUp({
      email: email("blocked"),
      password,
      options: { data: { pms_admin_provisioned: true } },
    });
    assert.ok(blocked.error, "Public signup was accepted");
    console.log(
      "PASS: real admin creation, login, enforced password change, duplicate account protection, membership idempotency, project isolation, nonadmin denial, public signup denial.",
    );
  } finally {
    if (w) {
      const deleted = await ownerClient!.rpc("delete_workspace", {
        w,
        confirmed_name: "DISPOSABLE invitation test " + run,
      });
      assert.ok(!deleted.error, "Fixture workspace cleanup failed");
    }
    for (let page = 1; ; page++) {
      const found = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      assert.ok(!found.error, "Fixture cleanup lookup failed");
      for (const u of found.data.users)
        if (emails.has(u.email || "")) {
          const deleted = await admin.auth.admin.deleteUser(u.id);
          assert.ok(!deleted.error, "Fixture account cleanup failed");
        }
      if (found.data.users.length < 1000) break;
    }
    console.log(
      "Disposable workspace and accounts removed. No invitations emailed.",
    );
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
