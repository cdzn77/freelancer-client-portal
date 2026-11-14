import { createHmac, timingSafeEqual } from "node:crypto";
import { square } from "@/lib/square";
import { serviceDB } from "@/lib/service-db";
export async function POST(request: Request) {
  const secret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    url = process.env.SQUARE_WEBHOOK_URL;
  if (!secret || !url) return new Response("Not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1000000) return new Response("Too large", { status: 413 });
  const expected = createHmac("sha256", secret)
    .update(url + raw)
    .digest("base64");
  const received = request.headers.get("x-square-hmacsha256-signature") || "";
  if (
    Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  )
    return new Response("Invalid signature", { status: 401 });
  try {
    const event = JSON.parse(raw);
    if (
      !["payment.created", "payment.updated", "refund.updated"].includes(
        event.type,
      )
    )
      return Response.json({ ok: true });
    const paymentId =
      event.data?.object?.payment?.id || event.data?.object?.refund?.payment_id;
    if (!paymentId) return Response.json({ ok: true });
    const { payment } = await square(
      "/v2/payments/" + encodeURIComponent(paymentId),
    );
    if (payment?.status !== "COMPLETED") return Response.json({ ok: true });
    const db = serviceDB();
    const { data: link } = await db
      .from("client_checkout_links")
      .select("*")
      .eq("order_id", payment.order_id)
      .maybeSingle();
    if (!link) return Response.json({ ok: true });
    if (
      payment.location_id !== process.env.SQUARE_LOCATION_ID ||
      payment.amount_money?.currency !== "USD" ||
      payment.amount_money.amount !== link.amount_cents
    )
      return new Response("Payment mismatch", { status: 400 });
    const { error } = await db.from("client_payments").upsert(
      {
        workspace_id: link.workspace_id,
        document_id: link.document_id,
        provider: "Square",
        provider_id: payment.id,
        amount_cents: payment.amount_money.amount,
        refunded_cents: payment.refunded_money?.amount || 0,
      },
      { onConflict: "provider_id" },
    );
    if (error) throw error;
    return Response.json({ ok: true });
  } catch {
    return new Response("Retry later", { status: 503 });
  }
}
