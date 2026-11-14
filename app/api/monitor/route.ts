import { requestClient } from "@/lib/server";
import { monitorWorkspace, refreshMonitor } from "@/lib/website-monitor";
import { z } from "zod";
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
      retestHealth: z.boolean().default(false),
      kind: z.enum([
        "health",
        "analytics",
        "domains",
        "delivery",
        "performance",
      ]),
      days: z
        .union([z.literal(7), z.literal(14), z.literal(28), z.literal(90)])
        .default(7),
      page: z
        .enum(["home", "info", "cases", "beat-saber", "marriott", "contact"])
        .default("home"),
      device: z.enum(["mobile", "desktop"]).default("mobile"),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Choose a valid report." }, { status: 400 });
  const { data: role } = await client.rpc("workspace_role", {
    w: input.data.workspace,
  });
  if (role !== "owner" || input.data.workspace !== monitorWorkspace())
    return Response.json(
      {
        error:
          "Website monitoring is available only to administrators of the connected workspace.",
      },
      { status: 403 },
    );
  try {
    return Response.json(
      await refreshMonitor(
        input.data.kind,
        input.data.days,
        input.data.page,
        input.data.device,
        input.data.kind === "health" && input.data.retestHealth,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "The refresh could not finish. Please try again." },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const w = new URL(request.url).searchParams.get("workspace");
  if (!z.string().uuid().safeParse(w).success)
    return Response.json({ error: "Choose a workspace." }, { status: 400 });
  const { data: role } = await client.rpc("workspace_role", { w });
  if (role !== "owner")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return Response.json(
    {
      configured: w === monitorWorkspace(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
