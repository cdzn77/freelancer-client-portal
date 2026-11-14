
import { brand } from "./brand";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export const notificationSender = (process.env.NOTIFICATION_SENDER || brand.email).trim().toLowerCase();
export const notificationDomain = notificationSender.split("@")[1] || brand.domain;
export function googleConfig() {
  const client = process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI,
    key = process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
  if (
    !client ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(notificationSender) ||
    /[\r\n<>]/.test(brand.name) ||
    !secret ||
    !redirect ||
    !key ||
    Buffer.from(key, "base64").length !== 32
  )
    return null;
  return { client, secret, redirect, key: Buffer.from(key, "base64") };
}
export function seal(value: string) {
  const c = googleConfig();
  if (!c) throw Error("Email setup required");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", c.key, iv);
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}
export function unseal(value: string) {
  const c = googleConfig();
  if (!c) throw Error("Email setup required");
  const b = Buffer.from(value, "base64url"),
    decipher = createDecipheriv("aes-256-gcm", c.key, b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(-16));
  return Buffer.concat([
    decipher.update(b.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}
export async function googleToken(params: Record<string, string>) {
  const c = googleConfig();
  if (!c) throw Error("Email setup required");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...params,
      client_id: c.client,
      client_secret: c.secret,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error("Google authorization needs attention");
  return (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    scope?: string;
  };
}
export function emailMessage(
  to: string,
  id: string,
  appUrl: string,
  replyToken?: string,
) {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to))
    throw Error("Invalid recipient");
  return Buffer.from(
    [
      `From: ${brand.name} <${notificationSender}>`,
      `To: ${to}`,
      "Subject: A new update in your studio workspace",
      `Message-ID: <${replyToken ? `pms-reply-${replyToken}` : id}@${notificationDomain}>`,
      `Reply-To: ${notificationSender}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(
        `You have a new workspace notification. Sign in to read it:\n\n${appUrl}\n\n${replyToken ? "You can reply to this email to add a comment. Reply from this same email address, above any quoted text.\n\n" : ""}You can turn email updates off in Inbox > Email notifications.`,
      ).toString("base64"),
    ].join("\r\n"),
  ).toString("base64url");
}
