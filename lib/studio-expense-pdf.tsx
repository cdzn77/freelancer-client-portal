import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { CostPayment, expenseSummary, usd } from "./studio-expenses";
const s = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 50,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#222",
  },
  brand: { fontSize: 20, marginBottom: 14 },
  title: { fontSize: 16, marginBottom: 8 },
  note: { fontSize: 9, color: "#555", lineHeight: 1.5, marginBottom: 10 },
  section: { fontSize: 12, marginTop: 16, marginBottom: 8 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    paddingVertical: 7,
  },
  date: { width: "15%" },
  name: { width: "39%", paddingRight: 10 },
  category: { width: "28%", paddingRight: 10 },
  amount: { width: "18%", textAlign: "right" },
  small: { fontSize: 8, color: "#555", marginTop: 3 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#666",
    textAlign: "right",
  },
});
export function StudioExpensePDF({
  rows,
  workspace,
  from,
  to,
}: {
  rows: CostPayment[];
  workspace: string;
  from: string;
  to: string;
}) {
  const summary = expenseSummary(rows);
  return (
    <Document title={`${workspace} studio expenses ${from} to ${to}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>{workspace}</Text>
        <Text style={s.title}>Studio expense report</Text>
        <Text style={s.note}>
          {from} through {to} · USD · {rows.length} selected payment records
          {"\n"}Generated {new Date().toISOString().slice(0, 10)}
        </Text>
        <Text style={s.title}>Recorded payments: {usd(summary.total)}</Text>
        <Text style={s.note}>
          Based on manually recorded payment dates and amounts. Includes
          selected archived payments; excludes Trash and subscription forecasts.
          Categories are bookkeeping labels, not a determination of tax
          deductibility. Retain receipts and review classification with your tax
          preparer. Project expenses are reported separately.
        </Text>
        <Text style={s.section}>By category</Text>
        {summary.categories.map((c) => (
          <View style={s.row} key={c.label} wrap={false}>
            <Text style={{ width: "80%" }}>{c.label}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>
              {usd(c.value)}
            </Text>
          </View>
        ))}
        <Text style={s.section}>By month</Text>
        {summary.months.map((m) => (
          <View key={m.label} style={s.row} wrap={false}>
            <Text style={{ width: "80%" }}>{m.label}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>
              {usd(m.value)}
            </Text>
          </View>
        ))}
        <Text style={s.section}>Selected payments</Text>
        <View style={s.row} wrap={false}>
          <Text style={s.date}>Paid date</Text>
          <Text style={s.name}>Expense / vendor</Text>
          <Text style={s.category}>Category / frequency</Text>
          <Text style={s.amount}>Amount</Text>
        </View>
        {rows.map((r) => (
          <View key={r.id} style={s.row} wrap={false}>
            <Text style={s.date}>{r.paid_on}</Text>
            <View style={s.name}>
              <Text>{r.name}</Text>
              {r.vendor && <Text style={s.small}>{r.vendor}</Text>}
              {r.payment_method && (
                <Text style={s.small}>Paid via: {r.payment_method}</Text>
              )}
              {r.receipt_reference && (
                <Text style={s.small}>Receipt: {r.receipt_reference}</Text>
              )}
              {r.notes && (
                <Text style={s.small}>
                  {r.notes.slice(0, 400)}
                  {r.notes.length > 400 ? " [Note truncated; see PMS]" : ""}
                </Text>
              )}
            </View>
            <View style={s.category}>
              <Text>{r.category}</Text>
              <Text style={s.small}>{r.frequency}</Text>
            </View>
            <Text style={s.amount}>{usd(Number(r.amount))}</Text>
          </View>
        ))}
        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Studio expenses · ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
