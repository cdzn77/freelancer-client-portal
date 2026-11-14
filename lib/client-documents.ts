import { z } from "zod";
export const documentKinds = [
  "Estimate",
  "Contract",
  "Project agreement",
  "Invoice",
  "Creative brief",
  "Change order",
] as const;
export const contentSchema = z.object({
  billing_address: z.string().max(2000).optional(),
  billing_profile: z
    .object({ id: z.string().uuid(), revision: z.number().int().positive() })
    .optional(),
  business: z.string().trim().min(1).max(200),
  client: z.string().trim().min(1).max(200),
  email: z.string().email(),
  service: z.string().min(1).max(200),
  start: z.string().max(30),
  end: z.string().max(30),
  scope: z.string().trim().min(1).max(16000),
  deliverables: z.string().trim().min(1).max(12000),
  terms: z.string().trim().min(1).max(20000),
  tax_note: z.string().trim().min(1).max(2000),
  tax_rate: z.number().min(0).max(20),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().positive().max(100000),
        unit_cents: z.number().int().min(0).max(100000000),
      }),
    )
    .min(1)
    .max(100),
});
export const documentSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  client_id: z.string().uuid().nullable(),
  kind: z.enum(documentKinds),
  due_date: z.string().date().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  previous_id: z.string().uuid().nullable().optional(),
  content: contentSchema,
});
export type DocumentContent = z.infer<typeof contentSchema>;
export type ClientDocument = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  client_id: string | null;
  kind: (typeof documentKinds)[number];
  title: string;
  version: number;
  due_date?: string | null;
  status: string;
  content: DocumentContent;
  total_cents: number;
  deposit_cents: number;
  signature_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};
export function totals(c: DocumentContent) {
  const subtotal = c.items.reduce(
    (n, i) => n + Math.round(i.quantity * i.unit_cents),
    0,
  );
  const tax = Math.round((subtotal * c.tax_rate) / 100);
  const total = subtotal + tax;
  if (!Number.isSafeInteger(total) || total > 100000000)
    throw Error("Total exceeds supported amount.");
  return { subtotal, tax, total, deposit: Math.ceil(total / 2) };
}
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export const standardTerms = `50% of the approved project total is due before any work begins. Approval alone does not authorize a start; the deposit must be received and verified. The remaining 50% is due before final delivery or transfer of final assets, unless a signed change order establishes a different final-payment schedule.\n\nOnly the scope and deliverables listed in this document are included. Additional services, revision rounds, third-party costs, and schedule changes require a written change order approved by both parties.\n\nThe client will provide timely feedback and materials they have the right to use. Delivery dates depend on receipt of the deposit, required materials, and approvals.\n\nRights to the final deliverables described here transfer only after full payment. Pre-existing tools, fonts, stock assets, and third-party materials remain subject to their own licenses.\n\nEither party may request cancellation in writing. Payment for completed work, committed costs, and any refundable balance will be reconciled against the approved scope; this document does not label all deposits automatically non-refundable.\n\nBoth parties agree to communicate concerns promptly and first attempt to resolve disputes in good faith. Electronic approval records the signer's intent to accept this exact document version.`;
