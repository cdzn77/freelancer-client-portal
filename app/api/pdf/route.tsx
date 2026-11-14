import { brand } from "../../../lib/brand";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { requestClient } from "@/lib/server";
import { Financial, total, money } from "@/lib/types";
export const runtime = "nodejs";
const s = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#293126",
  },
  brand: { fontSize: 22, marginBottom: 42 },
  title: { fontSize: 28, marginBottom: 10 },
  muted: { color: "#606958", marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e8dd",
  },
  sum: { fontSize: 20, textAlign: "right", marginTop: 24 },
  notes: { marginTop: 40, lineHeight: 1.6 },
});
export async function GET(request: Request) {
  try {
    const client = await requestClient(request),
      url = new URL(request.url),
      kind = url.searchParams.get("kind");
    if (kind !== "invoices" && kind !== "estimates")
      return Response.json({ error: "Invalid document type" }, { status: 400 });
    const { data, error } = await client
      .from(kind)
      .select("*")
      .eq("workspace_id", url.searchParams.get("workspace"))
      .eq("id", url.searchParams.get("id"))
      .single();
    if (error || !data)
      return Response.json({ error: "Document not found" }, { status: 404 });
    const f = data as Financial;
    const buffer = await renderToBuffer(
      <Document>
        <Page size="A4" style={s.page}>
          <Text style={s.brand}>{brand.name}</Text>
          <Text style={s.title}>
            {kind === "invoices" ? "Invoice" : "Estimate"} {f.number}
          </Text>
          <Text style={s.muted}>Prepared for {f.client_name}</Text>
          <Text style={s.muted}>Due {f.due_date || "on receipt"}</Text>
          <Text style={s.muted}>Status: {f.status}</Text>
          <View style={s.row}>
            <Text>Description</Text>
            <Text>Quantity x rate</Text>
            <Text>Amount</Text>
          </View>
          {f.lines.map((l, i) => (
            <View key={i} style={s.row}>
              <Text>{l.description}</Text>
              <Text>
                {l.quantity} x {money(l.rate)}
              </Text>
              <Text>{money(l.quantity * l.rate)}</Text>
            </View>
          ))}
          <Text style={s.sum}>Total {money(total(f))}</Text>
          <Text style={s.notes}>
            {f.notes || "Thank you for making good things with us."}
          </Text>
        </Page>
      </Document>,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${f.number.replace(/[^a-zA-Z0-9-]/g, "")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Sign in to download this document." },
      { status: 401 },
    );
  }
}
