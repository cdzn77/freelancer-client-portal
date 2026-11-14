
import { brand } from "./brand";
export async function verifyBot(token: string | undefined) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret)
    throw Error(
      "Public requests are being configured. Please contact the studio.",
    );
  if (!token) throw Error("Complete the bot verification before sending.");
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const result = await response.json();
  if (
    !response.ok ||
    !result.success ||
    result.hostname !== new URL(process.env.PMS_PUBLIC_URL || brand.portalUrl).hostname
  )
    throw Error("Bot verification expired. Please verify again.");
}
