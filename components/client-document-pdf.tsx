
import { brand } from "../lib/brand";
import { workSansRegular, workSansMedium } from "@/lib/pdf-fonts";
import { PDFBrand } from "./pdf-brand";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { type ClientDocument, totals, money } from "@/lib/client-documents";

// Same family and weights as the supplied Papersign template; bundled for offline export.
Font.register({
  family: "Work Sans",
  fonts: [
    { src: workSansRegular, fontWeight: 400 },
    { src: workSansMedium, fontWeight: 500 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);
const styles = StyleSheet.create({
  page: {
    padding: 72,
    paddingBottom: 66,
    fontFamily: "Work Sans",
    fontSize: 11,
    lineHeight: 1.75,
    color: "#000",
  },
  cover: {
    width: 612,
    height: 792,
    fontFamily: "Work Sans",
    color: "#000",
    position: "relative",
  },
  title: {
    fontSize: 20,
    lineHeight: 1.3,
    textAlign: "center",
    marginBottom: 20,
  },
  h: {
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.3,
    marginTop: 18,
    marginBottom: 14,
  },
  paragraph: { marginBottom: 12 },
  small: { fontSize: 8, lineHeight: 1.5, color: "#444" },
  footer: {
    position: "absolute",
    bottom: 25,
    left: 72,
    right: 72,
    fontSize: 7,
    lineHeight: 1.4,
    color: "#555",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
});
const covers: Record<ClientDocument["kind"], string> = {
  Estimate: "Project\nServices\nEstimate",
  Contract: "Design\nServices\nContract",
  "Project agreement": "Design\nProject\nAgreement",
  Invoice: "Project\nDeposit\nInvoice",
  "Creative brief": "Project\nCreative\nBrief",
  "Change order": "Project\nChange\nOrder",
};

export function ClientDocumentPDF({
  document: d,
}: {
  document: ClientDocument;
}) {
  const c = d.content,
    t = totals(c),
    sample = d.id.startsWith("SAMPLE-");
  return (
    <Document title={d.title} author={c.business}>
      <Page size="LETTER" style={styles.cover}>
        <View style={{ width: 612, height: 792 }} />
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 612,
            height: 612,
            backgroundColor: "#f0f0f0",
          }}
        />
        <View style={{ position: "absolute", top: 48, left: 72 }}>
          <PDFBrand width={180} />
        </View>
        <Text
          style={{
            position: "absolute",
            top: 212,
            left: 72,
            width: 465,
            fontSize: 44,
            fontWeight: 500,
            lineHeight: 1.28,
          }}
        >
          {covers[d.kind]}
        </Text>
        <View
          style={{
            position: "absolute",
            top: 646,
            left: 77,
            right: 72,
            flexDirection: "row",
            gap: 30,
            fontSize: 11,
            lineHeight: 1.75,
          }}
        >
          <View style={{ width: 204 }}>
            <Text style={{ fontWeight: 500, marginBottom: 14 }}>
              Prepared for
            </Text>
            <Text>{c.client}</Text>
            <Text style={{ fontSize: 9 }}>{c.email}</Text>
          </View>
          <View style={{ width: 228 }}>
            <Text style={{ fontWeight: 500, marginBottom: 14 }}>
              Prepared by
            </Text>
            <Text>{c.business}</Text>
            <Text style={{ fontSize: 9 }}>{brand.domain}</Text>
            <Text style={{ fontSize: 9 }}>{brand.email}</Text>
          </View>
        </View>
        {sample && (
          <Text
            style={{
              position: "absolute",
              bottom: 14,
              left: 77,
              fontSize: 7,
              color: "#555",
            }}
          >
            DESIGN SAMPLE · FICTIONAL CLIENT · NOT FOR SIGNATURE OR PAYMENT
          </Text>
        )}
      </Page>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.footer} fixed>
          <Text>{brand.domain} · {brand.email}</Text>
          <Text>
            {d.kind} · Version {d.version} · {d.id}
          </Text>
        </View>
        <Text style={styles.title}>{d.title}</Text>
        <Text style={{ textAlign: "center", marginBottom: 18 }}>
          Prepared by {c.business} for {c.client}.{"\n"}
          {c.service}. Proposed dates: {c.start || "To be agreed"} to{" "}
          {c.end || "To be agreed"}.
        </Text>
        {c.billing_address && (
          <Text style={styles.paragraph}>
            Billing address: {c.billing_address}
          </Text>
        )}
        {d.due_date && (
          <Text style={styles.paragraph}>Payment due: {d.due_date}</Text>
        )}
        <Heading>
          {d.kind === "Invoice"
            ? "Billing summary"
            : d.kind === "Change order"
              ? "Requested change"
              : d.kind === "Creative brief"
                ? "Context & direction"
                : "Services & approach"}
        </Heading>
        <DocumentParagraphs text={c.scope} />
        <Heading>
          {d.kind === "Invoice"
            ? "Billing basis"
            : d.kind === "Change order"
              ? "Impact & delivery"
              : "Deliverables & review"}
        </Heading>
        <DocumentParagraphs text={c.deliverables} />
        {d.kind !== "Creative brief" && (
          <>
            <Heading>Fees & payment terms</Heading>
            {c.items.map((item, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <Text style={{ width: "72%" }}>
                  {item.description} · {item.quantity} ×{" "}
                  {money(item.unit_cents)}
                </Text>
                <Text style={{ width: "25%", textAlign: "right" }}>
                  {money(Math.round(item.quantity * item.unit_cents))}
                </Text>
              </View>
            ))}
            <View wrap={false} style={{ marginTop: 8, marginBottom: 12 }}>
              <Text>Subtotal: {money(t.subtotal)}</Text>
              <Text>
                Sales tax ({c.tax_rate}%): {money(t.tax)}
              </Text>
              <Text style={{ fontWeight: 500 }}>
                Total project investment: {money(t.total)}
              </Text>
              <Text>50% deposit before work begins: {money(t.deposit)}</Text>
              <Text>Remaining balance: {money(t.total - t.deposit)}</Text>
            </View>
            <Heading>Tax treatment</Heading>
            <Text style={styles.paragraph}>{c.tax_note}</Text>
          </>
        )}
        <Heading>
          {d.kind === "Creative brief"
            ? "Brief alignment"
            : "Working agreement"}
        </Heading>
        <DocumentParagraphs text={c.terms} />
        <View
          wrap={false}
          style={{ marginTop: 25, borderTop: "0.5 solid #888", paddingTop: 22 }}
        >
          <Text style={{ marginBottom: 16 }}>
            {d.status === "Approved"
              ? `Approved electronically by ${d.signature_name} on ${d.decided_at}. This record applies to this exact version.`
              : d.status === "Discussion"
                ? `Discussion requested on ${d.decided_at}.`
                : sample
                  ? "Sample only. No approval or signature has been recorded."
                  : "Not approved."}
          </Text>
          {d.decision_note && (
            <Text style={styles.paragraph}>{d.decision_note}</Text>
          )}
          {d.kind !== "Invoice" && (
            <>
              <Text style={{ marginBottom: 18 }}>
                {d.kind === "Creative brief"
                  ? "Both parties confirm the creative direction described in this version."
                  : "The parties agree to the terms and scope of this document, as demonstrated by their signatures below."}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ width: 210 }}>
                  <Text>{brand.name}</Text>
                  <Text>{brand.ownerName}</Text>
                  <View
                    style={{
                      height: 45,
                      borderBottom: "0.5 solid #555",
                      marginBottom: 10,
                    }}
                  />
                  <Text style={{ fontSize: 10 }}>Agency signature</Text>
                  <Text style={{ marginTop: 30 }}>
                    Date: __________________
                  </Text>
                </View>
                <View style={{ width: 210 }}>
                  <Text>Client representative</Text>
                  <Text>Name: __________________</Text>
                  <View
                    style={{
                      height: 45,
                      borderBottom: "0.5 solid #555",
                      marginBottom: 10,
                    }}
                  />
                  <Text style={{ fontSize: 10 }}>Client signature</Text>
                  <Text style={{ marginTop: 30 }}>
                    Date: __________________
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </Page>
    </Document>
  );
}
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text style={styles.h} minPresenceAhead={160}>
      {children}
    </Text>
  );
}
function DocumentParagraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((block, index) => {
        const [first, ...rest] = block.split("\n");
        const heading =
          first.length < 85 &&
          first === first.toUpperCase() &&
          /[A-Z]/.test(first);
        return (
          <View key={index} wrap={block.length > 1100} style={styles.paragraph}>
            {heading ? (
              <>
                <Text
                  style={{ fontSize: 12, fontWeight: 500, marginBottom: 5 }}
                  minPresenceAhead={35}
                >
                  {first.charAt(0) + first.slice(1).toLowerCase()}
                </Text>
                <Text>{rest.join("\n")}</Text>
              </>
            ) : (
              <Text>{block}</Text>
            )}
          </View>
        );
      })}
    </>
  );
}
