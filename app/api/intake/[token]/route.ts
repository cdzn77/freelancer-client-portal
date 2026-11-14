import { serviceRequestSchema, requestDetails } from "@/lib/service-catalog";
import { verifyBot } from "@/lib/verify-bot";
import { z } from "zod";
import { serviceDB } from "@/lib/service-db";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
async function link(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const db = serviceDB();
  const { data, error } = await db
    .from("intake_links")
    .select("title,description,enabled,expires_on,workspace_id,created_by")
    .eq("token", token)
    .maybeSingle();
  if (
    error ||
    !data ||
    !data.enabled ||
    (data.expires_on && data.expires_on < new Date().toISOString().slice(0, 10))
  )
    return null;
  const { data: owner } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", data.workspace_id)
    .eq("user_id", data.created_by)
    .maybeSingle();
  return owner?.role === "owner" ? data : null;
}
export async function GET(_request: Request, ctx: Context) {
  try {
    const data = await link((await ctx.params).token);
    return Response.json(
      data
        ? { title: data.title, description: data.description }
        : { error: "This form is unavailable." },
      { status: data ? 200 : 404, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "This form is unavailable." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request, ctx: Context) {
  try {
    const token = (await ctx.params).token;
    if (!/^[a-f0-9]{48}$/.test(token) || !(await link(token)))
      return Response.json(
        { error: "This form is unavailable." },
        { status: 404 },
      );
    const raw = await request.text();
    if (raw.length > 40000)
      return Response.json(
        { error: "Please shorten your request." },
        { status: 413 },
      );
    const input = serviceRequestSchema.parse(JSON.parse(raw));
    await verifyBot(input.captcha_token);
    const { error } = await serviceDB().rpc("submit_service_intake", {
      link_token: token,
      submission: input.submission_id,
      request_title: input.title,
      request_brief: input.brief,
      client: input.client_name,
      contact_email: input.email,
      service_details: requestDetails(input),
      desired: input.desired_date || null,
    });
    if (error)
      throw Error("This form is unavailable. Please contact the studio.");
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the required fields and try again."
            : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
