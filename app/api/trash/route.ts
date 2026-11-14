import { z } from "zod";
import { requestClient } from "@/lib/server";
import { cleanupTrashFiles } from "@/lib/trash-cleanup";
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const input = z
    .object({
      workspace: z.string().uuid(),
      kind: z.enum([
        "project",
        "budget",
        "blueprint",
        "request",
        "notification",
        "deliverable",
      ]),
      ids: z.array(z.string().uuid()).min(1).max(5000),
      confirmation: z.literal("DELETE"),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Check the selection and confirmation." },
      { status: 400 },
    );
  const { workspace, kind, ids } = input.data;
  const { data: deleted, error } = await client.rpc("purge_trash", {
    w: workspace,
    kind,
    item_ids: ids,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  let pendingFiles: number | null = null;
  try {
    pendingFiles = await cleanupTrashFiles(workspace);
  } catch {
    /* Deletion committed; cleanup worker can retry. */
  }
  return Response.json(
    { deleted, pendingFiles },
    { headers: { "Cache-Control": "no-store" } },
  );
}
