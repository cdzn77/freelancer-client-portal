import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { googleConfig, seal } from "@/lib/google-email";
import { expenseMailboxes, syncExpenseMailbox } from "@/lib/expense-mail-sync";
import { receiptCookie, oauthHash } from "@/lib/expense-mail-oauth";
export const runtime = "nodejs";
const metadata =
  "id,email,enabled,connected_at,last_attempt,last_sync,last_error";
async function owner(request: Request, w: string) {
  const c = await requestClient(request);
  const { data: role } = await c.rpc("workspace_role", { w });
  if (role !== "owner") throw Error("Administrator access required");
  return c;
}
export async function GET(request: Request) {
  try {
    const w = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("workspace"));
    const c = await owner(request, w);
    const params = new URL(request.url).searchParams;
    const status = z
      .enum(["Review", "Recorded", "Dismissed", "Duplicate"])
      .parse(params.get("status") || "Review");
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("offset") || "0");
    const [accounts, items] = await Promise.all([
      c.from("expense_mail_accounts").select(metadata).eq("workspace_id", w),
      c
        .from("expense_mail_items")
        .select("*", { count: "exact" })
        .eq("workspace_id", w)
        .eq("status", status)
        .order("created_at", { ascending: true })
        .order("id")
        .range(offset, offset + 49),
    ]);
    if (accounts.error || items.error) throw Error("Data unavailable");
    return Response.json(
      {
        configured: !!googleConfig(),
        mailboxes: expenseMailboxes,
        accounts: accounts.data,
        items: items.data,
        total: items.count,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Could not load email sync. Sign in as a workspace administrator.",
      },
      { status: 403 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const input = z
      .object({
        workspace: z.string().uuid(),
        action: z.enum(["connect", "disconnect", "sync", "pause", "resume"]),
        email: z.string().email().optional(),
        account: z.string().uuid().optional(),
      })
      .parse(await request.json());
    const c = await owner(request, input.workspace),
      db = serviceDB();
    if (input.action === "connect") {
      const conf = googleConfig();
      if (!conf)
        return Response.json(
          { error: "Google connection settings are missing on the server." },
          { status: 503 },
        );
      if (!input.email || !expenseMailboxes.includes(input.email))
        throw Error("Choose a configured mailbox");
      const {
        data: { user },
      } = await c.auth.getUser(
        request.headers.get("authorization")!.replace(/^Bearer /, ""),
      );
      const state = randomBytes(32).toString("base64url"),
        exp = Date.now() + 600000;
      const { error } = await db.from("expense_mail_oauth").insert({
        state_hash: oauthHash(state),
        workspace_id: input.workspace,
        user_id: user!.id,
        email: input.email,
        expires_at: new Date(exp).toISOString(),
      });
      if (error) throw Error("Could not start connection");
      const proof = seal(
        JSON.stringify({
          purpose: "expense-read",
          state,
          user: user!.id,
          workspace: input.workspace,
          email: input.email,
          exp,
        }),
      );
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: conf.client,
        redirect_uri: conf.redirect,
        response_type: "code",
        scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent select_account",
        login_hint: input.email,
        state,
      }).toString();
      const response = NextResponse.json({ url: url.toString() });
      response.cookies.set(receiptCookie, proof, {
        httpOnly: true,
        secure: new URL(conf.redirect).protocol === "https:",
        sameSite: "lax",
        path: "/api/email/google/callback",
        maxAge: 600,
      });
      return response;
    }
    if (!input.account) throw Error("Choose a mailbox");
    if (input.action === "sync")
      return Response.json(
        await syncExpenseMailbox(input.workspace, input.account),
      );
    const result =
      input.action === "disconnect"
        ? await db
            .from("expense_mail_accounts")
            .delete()
            .eq("workspace_id", input.workspace)
            .eq("id", input.account)
        : await db
            .from("expense_mail_accounts")
            .update({ enabled: input.action === "resume" })
            .eq("workspace_id", input.workspace)
            .eq("id", input.account);
    if (result.error) throw Error("Could not update mailbox");
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          "Email sync could not complete. Check the mailbox connection and try again.",
      },
      { status: 400 },
    );
  }
}
