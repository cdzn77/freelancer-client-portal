import { createHmac, timingSafeEqual } from "node:crypto";
export function collaborationWorkerSignature(timestamp: string, key: string) {
  return createHmac("sha256", key)
    .update("discussion-updates:" + timestamp)
    .digest("hex");
}
export function validCollaborationWorker(
  timestamp: string,
  signature: string,
  key: string,
  now = Date.now(),
) {
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 60000 ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(collaborationWorkerSignature(timestamp, key), "hex"),
  );
}
