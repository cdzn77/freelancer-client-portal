
import { brand } from "../../../../../lib/brand";
import { requestClient } from "@/lib/server";
import { serviceDB } from "@/lib/service-db";
import { square, squareCheckoutReady } from "@/lib/square";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!squareCheckoutReady())
      throw Error("Square checkout is not connected yet.");
    const db = await requestClient(request);
    const { data: d } = await db
      .from("client_documents")
      .select("*")
      .eq("id", (await params).id)
      .single();
    if (
      !d ||
      d.status !== "Approved" ||
      ![
        "Estimate",
        "Contract",
        "Project agreement",
        "Invoice",
        "Change order",
      ].includes(d.kind) ||
      d.deposit_cents <= 0
    )
      throw Error("An approved priced document is required.");
    const claim = await db.rpc("claim_billing_checkout", { doc: d.id });
    if (claim.error || !claim.data)
      throw Error(claim.error?.message || "Checkout unavailable.");
    if (claim.data.url) return Response.json({ url: claim.data.url });
    const collection = claim.data;
    const svc = serviceDB();
    const location = process.env.SQUARE_LOCATION_ID;
    if (!location) throw Error("Square checkout is not connected yet.");
    const x = await square("/v2/online-checkout/payment-links", {
      idempotency_key: collection.key,
      quick_pay: {
        name: `50% deposit · ${collection.title}`.slice(0, 255),
        price_money: { amount: collection.amount_cents, currency: "USD" },
        location_id: location,
      },
      checkout_options: {
        allow_tipping: false,
        redirect_url: (brand.portalUrl + "/"),
      },
    });
    const link = x.payment_link;
    if (!link?.url || !link.order_id) throw Error("Checkout link unavailable.");
    const { error } = await svc.from("client_checkout_links").upsert(
      {
        document_id: collection.document_id,
        workspace_id: collection.workspace_id,
        url: link.url,
        order_id: link.order_id,
        amount_cents: collection.amount_cents,
      },
      { onConflict: "document_id" },
    );
    if (error)
      throw Error("Could not save checkout. Retry to recover the same link.");
    return Response.json({ url: link.url });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
