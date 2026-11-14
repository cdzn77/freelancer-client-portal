import { requestClient } from "@/lib/server";
import { payments } from "@/lib/adapters";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const client = await requestClient(request);
    const { id, workspace } = z
      .object({ id: z.string().uuid(), workspace: z.string().uuid() })
      .parse(await request.json());
    const { data, error } = await client
      .from("invoices")
      .select("*")
      .eq("workspace_id", workspace)
      .eq("id", id)
      .single();
    if (error || !data)
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    const amount = data.lines.reduce(
      (n: number, l: { quantity: number; rate: number }) =>
        n + l.quantity * l.rate,
      0,
    );
    return Response.json(await payments.paymentLink({ id, amount }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
