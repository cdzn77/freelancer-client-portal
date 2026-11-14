import { createDecipheriv } from "node:crypto";
export function openMonitorCredentials(payload: string, workspace: string) {
  const key = Buffer.from(
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY || "",
    "base64",
  );
  if (key.length !== 32)
    throw Error("Website credential encryption is not configured.");
  const b = Buffer.from(payload, "base64url");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from("website-monitor-v1:" + workspace));
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(
    Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8"),
  ) as {
    google: { client_id: string; client_secret: string; refresh_token: string };
    google_search?: {
      client_id: string;
      client_secret: string;
      refresh_token: string;
    };
    netlify: string;
    pagespeed: string;
  };
}
