import { validCollaborationWorker } from "../../lib/collaboration-worker-auth";
import { collaborationMaintenance } from "../../lib/discussion-email";
export default async function (request: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    request.method !== "POST" ||
    !key ||
    !validCollaborationWorker(
      request.headers.get("x-discussion-time") || "",
      request.headers.get("x-discussion-signature") || "",
      key,
    )
  )
    return new Response(null, { status: 401 });
  await collaborationMaintenance();
  return new Response(null, { status: 204 });
}
