import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { googleConfig, notificationSender, seal } from "@/lib/google-email";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const c = await requestClient(request),
      w = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("workspace"));
    const { data: role } = await c.rpc("workspace_role", { w });
    if (role !== "owner")
      return Response.json(
        { error: "Administrator access required" },
        { status: 403 },
      );
    const { data } = await c
      .from("google_email_connections")
      .select(
        "sender,connected_at,reply_enabled,reply_checked_at,reply_last_error",
      )
      .eq("workspace_id", w)
      .maybeSingle();
    return Response.json(
      {
        configured: !!googleConfig(),
        sender: notificationSender,
        connection: data,
        deliveryEnabled:
          process.env.ENABLE_NOTIFICATION_EMAIL_WORKER === "true",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Unable to load email settings" },
      { status: 401 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const c = await requestClient(request),
      input = z
        .object({
          workspace: z.string().uuid(),
          action: z.enum(["connect", "disconnect"]),
          replies: z.boolean().optional().default(false),
        })
        .parse(await request.json());
    const { data: role } = await c.rpc("workspace_role", {
      w: input.workspace,
    });
    if (role !== "owner")
      return Response.json(
        { error: "Administrator access required" },
        { status: 403 },
      );
    if (input.action === "disconnect") {
      const { error } = await serviceDB()
        .from("google_email_connections")
        .delete()
        .eq("workspace_id", input.workspace);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    const conf = googleConfig();
    if (!conf)
      return Response.json(
        {
          error:
            "Add the Google OAuth settings and encryption key on the server first.",
        },
        { status: 503 },
      );
    const {
      data: { user },
    } = await c.auth.getUser(
      request.headers.get("authorization")!.replace(/^Bearer /, ""),
    );
    const state = randomBytes(32).toString("base64url"),
      proof = seal(
        JSON.stringify({
          state,
          replies: input.replies,
          workspace: input.workspace,
          user: user!.id,
          exp: Date.now() + 600000,
        }),
      );
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: conf.client,
      redirect_uri: conf.redirect,
      response_type: "code",
      scope:
        "openid email https://www.googleapis.com/auth/gmail.send" +
        (input.replies
          ? " https://www.googleapis.com/auth/gmail.readonly"
          : ""),
      access_type: "offline",
      prompt: "consent",
      login_hint: notificationSender,
      state,
    }).toString();
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set("pms_google_oauth", proof, {
      httpOnly: true,
      secure: new URL(conf.redirect).protocol === "https:",
      sameSite: "lax",
      path: "/api/email/google/callback",
      maxAge: 600,
    });
    return response;
  } catch {
    return Response.json(
      { error: "Could not update Google email connection" },
      { status: 400 },
    );
  }
}
