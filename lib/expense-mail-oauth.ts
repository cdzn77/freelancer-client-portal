import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { googleConfig, googleToken, seal, unseal } from "./google-email";
import { serviceDB } from "./service-db";
export const receiptCookie = "pms_receipt_oauth";
export const oauthHash = (state: string) =>
  createHash("sha256").update(state).digest("hex");
export async function expenseMailCallback(request: NextRequest) {
  let ok = false;
  try {
    const proof = JSON.parse(
      unseal(request.cookies.get(receiptCookie)?.value || ""),
    );
    if (
      proof.purpose !== "expense-read" ||
      proof.exp < Date.now() ||
      proof.state !== request.nextUrl.searchParams.get("state")
    )
      throw Error("Invalid state");
    const db = serviceDB();
    const { data: nonce, error } = await db
      .from("expense_mail_oauth")
      .delete()
      .eq("state_hash", oauthHash(proof.state))
      .eq("user_id", proof.user)
      .eq("workspace_id", proof.workspace)
      .eq("email", proof.email)
      .gt("expires_at", new Date().toISOString())
      .select("state_hash")
      .maybeSingle();
    if (error || !nonce) throw Error("Expired state");
    const { data: member } = await db
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", proof.workspace)
      .eq("user_id", proof.user)
      .maybeSingle();
    if (member?.role !== "owner") throw Error("Access changed");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw Error("Canceled");
    const token = await googleToken({
      code,
      grant_type: "authorization_code",
      redirect_uri: googleConfig()!.redirect,
    });
    if (
      !token.refresh_token ||
      !token.scope
        ?.split(" ")
        .includes("https://www.googleapis.com/auth/gmail.readonly")
    )
      throw Error("Read permission required");
    const result = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    const identity = await result.json();
    if (
      !result.ok ||
      !identity.email_verified ||
      identity.email?.toLowerCase() !== proof.email
    )
      throw Error("Wrong mailbox");
    const { error: e } = await db.from("expense_mail_accounts").upsert(
      {
        workspace_id: proof.workspace,
        email: proof.email,
        encrypted_refresh_token: seal(token.refresh_token),
        connected_by: proof.user,
        enabled: true,
        connected_at: new Date().toISOString(),
        last_error: null,
        page_token: null,
        window_start: null,
        window_end: null,
      },
      { onConflict: "workspace_id,email" },
    );
    if (e) throw Error("Save failed");
    ok = true;
  } catch {
    /* Never log tokens or provider responses. */
  }
  const response = new NextResponse(
    ok
      ? "Mailbox connected for read-only receipt sync. Return to PMS > Studio expenses > Email sync. No payments are created until reviewed."
      : "Mailbox connection was not completed. Return to PMS and retry with the exact mailbox shown. Google may require this account to be allowed in the OAuth consent configuration.",
    {
      status: ok ? 200 : 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
  response.cookies.set(receiptCookie, "", {
    path: "/api/email/google/callback",
    maxAge: 0,
  });
  return response;
}
