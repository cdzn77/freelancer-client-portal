import { renderToBuffer } from "@react-pdf/renderer";
import { z } from "zod";
import { requestClient } from "@/lib/server";
import { StudioExpensePDF } from "@/lib/studio-expense-pdf";
import { CostPayment, dateOnly } from "@/lib/studio-expenses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return Response.json(
      { error: "Sign in to export expenses." },
      { status: 401 },
    );
  }
  const input = z
    .object({
      workspace: z.string().uuid(),
      ids: z.array(z.string().uuid()).min(1).max(2500),
      from: z.string().refine(dateOnly),
      to: z.string().refine(dateOnly),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success || input.data.from > input.data.to)
    return Response.json(
      { error: "Select up to 2,500 payments and a valid date range." },
      { status: 400 },
    );
  const { workspace, from, to } = input.data;
  const { data: role } = await client.rpc("workspace_role", { w: workspace });
  if (role !== "owner")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const ids = [...new Set(input.data.ids)];
  const rows: CostPayment[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await client
      .from("studio_cost_payments")
      .select("*")
      .eq("workspace_id", workspace)
      .is("deleted_at", null)
      .gte("paid_on", from)
      .lte("paid_on", to)
      .in("id", ids.slice(offset, offset + 200));
    if (error)
      return Response.json(
        { error: "Could not read the selected payments." },
        { status: 503 },
      );
    rows.push(...data);
  }
  if (rows.length !== ids.length)
    return Response.json(
      {
        error:
          "Some selected payments changed or are no longer available. Reload and select again.",
      },
      { status: 409 },
    );
  const { data: w } = await client
    .from("workspaces")
    .select("name")
    .eq("id", workspace)
    .single();
  rows.sort(
    (a, b) =>
      a.paid_on.localeCompare(b.paid_on) || a.name.localeCompare(b.name),
  );
  try {
    const buffer = await renderToBuffer(
      <StudioExpensePDF
        rows={rows}
        workspace={w?.name || "Studio"}
        from={from}
        to={to}
      />,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="studio-expenses-${from}-to-${to}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "The PDF could not be created. Try a smaller selection." },
      { status: 503 },
    );
  }
}
