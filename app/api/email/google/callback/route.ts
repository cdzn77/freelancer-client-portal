import { expenseMailCallback, receiptCookie } from "@/lib/expense-mail-oauth";
import { NextRequest, NextResponse } from "next/server";
import {
  googleConfig,
  googleToken,
  notificationSender,
  seal,
  unseal,
} from "@/lib/google-email";
import { serviceDB } from "@/lib/service-db";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (request.cookies.get(receiptCookie)) {
    try {
      const receiptProof = JSON.parse(
        unseal(request.cookies.get(receiptCookie)!.value),
      );
      if (receiptProof.state === request.nextUrl.searchParams.get("state"))
        return expenseMailCallback(request);
    } catch {
      /* Existing notification flow remains separate. */
    }
  }
  let message =
    "Google email could not be connected. Return to the PMS and try again.";
  let status = 400;
  try {
    const proof = JSON.parse(
      unseal(request.cookies.get("pms_google_oauth")?.value || ""),
    );
    if (
      proof.exp < Date.now() ||
      proof.state !== request.nextUrl.searchParams.get("state")
    )
      throw Error("Expired connection");
    const db = serviceDB();
    const { data: member } = await db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", proof.workspace)
      .eq("user_id", proof.user)
      .single();
    if (member?.role !== "owner") throw Error("Access changed");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw Error("Cancelled");
    const token = await googleToken({
      code,
      grant_type: "authorization_code",
      redirect_uri: googleConfig()!.redirect,
    });
    if (
      !token.refresh_token ||
      !token.scope
        ?.split(" ")
        .includes("https://www.googleapis.com/auth/gmail.send")
    )
      throw Error("Send permission required");
    if (
      proof.replies &&
      !token.scope
        ?.split(" ")
        .includes("https://www.googleapis.com/auth/gmail.readonly")
    )
      throw Error("Read permission required for replies");
    const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    const account = await r.json();
    if (
      !r.ok ||
      !account.email_verified ||
      account.email?.toLowerCase() !== notificationSender
    )
      throw Error("Wrong sender");
    const { error } = await db.from("google_email_connections").upsert({
      workspace_id: proof.workspace,
      sender: notificationSender,
      encrypted_refresh_token: seal(token.refresh_token),
      connected_by: proof.user,
      connected_at: new Date().toISOString(),
      reply_enabled: !!proof.replies,
      reply_page_token: null,
      reply_last_error: null,
    });
    if (error) throw error;
    message =
      "Google email connected. Return to PMS > Inbox to check notification settings. Connecting does not enable delivery by itself.";
    status = 200;
  } catch {
    /* Tokens and Google responses must never enter logs or browser output. */
  }
  const response = new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  response.cookies.set("pms_google_oauth", "", {
    path: "/api/email/google/callback",
    maxAge: 0,
  });
  return response;
}
