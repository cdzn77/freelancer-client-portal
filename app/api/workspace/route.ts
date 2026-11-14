import { z } from "zod";
import { requestClient } from "@/lib/server";
import { cleanupTrashFiles } from "@/lib/trash-cleanup";
export async function DELETE(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const input = z
    .object({
      workspace: z.string().uuid(),
      confirmedName: z.string().min(1).max(120),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Type the workspace name to confirm." },
      { status: 400 },
    );
  const { error } = await client.rpc("delete_workspace", {
    w: input.data.workspace,
    confirmed_name: input.data.confirmedName,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  let pendingFiles: number | null = null;
  try {
    pendingFiles = await cleanupTrashFiles(input.data.workspace);
  } catch {
    /* Durable worker retries file cleanup. */
  }
  return Response.json(
    { deleted: true, pendingFiles },
    { headers: { "Cache-Control": "no-store" } },
  );
}
