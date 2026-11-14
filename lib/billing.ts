export type BillingProfile = {
  client_account_id: string;
  workspace_id: string;
  revision: number;
  billing_name: string;
  email: string;
  address: string;
  contacts: {
    name: string;
    email: string;
    role: "Billing" | "Approver" | "Primary";
  }[];
  default_rate_cents: number;
  tax_rate: number;
  tax_note: string;
};
export type BillingSource = {
  id: string;
  source_id: string;
  kind: "document" | "invoice" | "estimate";
  title: string;
  type: string;
  status: string;
  primary: boolean;
  total_cents: number;
  due_date: string | null;
};
export type BillingPayment = {
  id: string;
  kind: "payment" | "receipt";
  source_id: string;
  gross_cents: number;
  refunded_cents: number;
  net_cents: number;
  date: string;
  reference: string;
  matched: boolean;
  matched_payment?: string | null;
};
export type BillingGroup = {
  id: string;
  project_id: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  unverified_paid: boolean;
  sources: BillingSource[];
  payments: BillingPayment[];
};
export const billingIssued = (g: BillingGroup) =>
  g.sources.some((s) =>
    s.kind === "invoice"
      ? ["Sent", "Overdue", "Paid"].includes(s.status)
      : s.kind === "document" &&
        s.type !== "Creative brief" &&
        s.status === "Approved",
  );
