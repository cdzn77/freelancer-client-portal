import { z } from "zod";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
export const runtime = "nodejs";
const inputSchema = z.object({
  workspace: z.string().uuid(),
  mode: z.enum(["create", "existing"]),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  name: z.string().trim().max(100).optional(),
  role: z.enum(["owner", "member", "client"]),
  project: z.string().uuid().nullable().optional(),
  password: z
    .string()
    .min(12)
    .max(64)
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72)
    .optional(),
});
const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return reply({ error: "Sign in to continue." }, 401);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return reply(
      {
        error:
          "Check the email, role and password. Use 12–64 characters for a new password.",
      },
      400,
    );
  const input = parsed.data;
  const { data: role, error: roleError } = await client.rpc("workspace_role", {
    w: input.workspace,
  });
  if (roleError || role !== "owner")
    return reply(
      { error: "Only administrators can create accounts or add members." },
      403,
    );
  if (input.project) {
    const { data: project, error } = await client
      .from("projects")
      .select("id")
      .eq("workspace_id", input.workspace)
      .eq("id", input.project)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !project)
      return reply({ error: "Choose a project in this workspace." }, 400);
  }
  let created = false;
  if (input.mode === "create") {
    if (!input.name || !input.password)
      return reply({ error: "Add a name and initial password." }, 400);
    try {
      const { data, error } = await serviceDB().auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        app_metadata: {
          pms_admin_provisioned: true,
          pms_password_change_required: true,
        },
        user_metadata: { full_name: input.name, pms_password_choice: true },
      });
      if (error || !data.user) {
        if (
          error?.code === "email_exists" ||
          error?.code === "user_already_exists"
        )
          return reply(
            {
              error:
                "This email already has an account. Choose Add existing account; their password will stay unchanged.",
            },
            409,
          );
        return reply(
          {
            error:
              "Account could not be created. Check the password requirements and try again.",
          },
          400,
        );
      }
      created = true;
    } catch {
      return reply(
        { error: "Account service is unavailable. Please try again." },
        503,
      );
    }
  }
  const { data, error } = await client.rpc("provision_workspace_member", {
    w: input.workspace,
    member_email: input.email,
    member_role: input.role,
    project: input.project || null,
  });
  if (error)
    return reply(
      {
        created,
        error: created
          ? "The account was created, but workspace access was not saved. Keep the initial password and use Add existing account to finish."
          : "Could not add this account. Check that it exists and that you still have administrator access.",
      },
      400,
    );
  return reply({
    created,
    user_id: data?.user_id,
    email: input.email,
    already_member: !!data?.already_member,
    role: data?.role,
  });
}
