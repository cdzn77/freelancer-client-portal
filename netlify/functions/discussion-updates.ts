import type { Config } from "@netlify/functions";
import { collaborationWorkerSignature } from "../../lib/collaboration-worker-auth";
export default async function () {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    site = process.env.URL || process.env.PMS_PUBLIC_URL;
  if (!key || !site) throw Error("Discussion worker configuration required");
  const timestamp = String(Date.now());
  const result = await fetch(
    new URL("/.netlify/functions/discussion-worker-background", site),
    {
      method: "POST",
      headers: {
        "x-discussion-time": timestamp,
        "x-discussion-signature": collaborationWorkerSignature(timestamp, key),
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!result.ok) throw Error("Discussion worker dispatch failed");
  return new Response(null, { status: 204 });
}
export const config: Config = { schedule: "*/5 * * * *" };
