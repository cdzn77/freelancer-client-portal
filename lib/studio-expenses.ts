export const EXPENSE_CATEGORIES = [
  "AI services",
  "Software & subscriptions",
  "Hosting & domains",
  "Equipment & hardware",
  "Repairs & maintenance",
  "Office supplies",
  "Internet & phone",
  "Rent & coworking",
  "Utilities",
  "Advertising & marketing",
  "Contractors & freelancers",
  "Payroll & benefits",
  "Accounting & legal",
  "Insurance",
  "Education & training",
  "Travel & transport",
  "Meals",
  "Bank & payment fees",
  "Taxes, licenses & permits",
  "Printing & shipping",
  "Stock assets, fonts & music",
  "Other",
] as const;
export const EXPENSE_FREQUENCIES = [
  "One time",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Semiannually",
  "Annually",
] as const;
export type Cost = {
  id: string;
  workspace_id: string;
  name: string;
  vendor: string;
  category: string;
  amount: number | null;
  frequency: string;
  notes: string;
  archived_at: string | null;
  deleted_at: string | null;
};
export type CostPlan = Cost & {
  starts_on: string | null;
  ends_on: string | null;
  review_for_savings: boolean;
  status: string;
  include_in_forecast: boolean;
  next_renewal_on: string | null;
};
export type CostPayment = Cost & {
  amount: number;
  plan_id: string | null;
  paid_on: string;
  scheduled_for: string | null;
  payment_method: string;
  receipt_reference: string;
};
export const usd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
export const cents = (value: number | string) =>
  Math.round(Number(value) * 100);
export function dateOnly(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function planDates(
  plan: Pick<CostPlan, "starts_on" | "ends_on" | "frequency">,
  year: number,
) {
  if (
    !plan.starts_on ||
    !dateOnly(plan.starts_on) ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  )
    return [];
  const from = `${year}-01-01`,
    to = `${year}-12-31`,
    end = plan.ends_on && plan.ends_on < to ? plan.ends_on : to;
  if (plan.starts_on > end) return [];
  const result: string[] = [];
  const start = new Date(plan.starts_on + "T12:00:00Z");
  const anchor = start.getUTCDate();
  const step = (
    { Monthly: 1, Quarterly: 3, Semiannually: 6, Annually: 12 } as Record<
      string,
      number
    >
  )[plan.frequency];
  if (plan.frequency === "One time")
    return plan.starts_on >= from && plan.starts_on <= end
      ? [plan.starts_on]
      : [];
  if (plan.frequency === "Weekly") {
    const first = Math.max(
      0,
      Math.ceil(
        (Date.parse(from + "T12:00:00Z") - start.getTime()) / (7 * 86400000),
      ),
    );
    for (let i = first; i < first + 54; i++) {
      const d = new Date(start.getTime() + i * 7 * 86400000)
        .toISOString()
        .slice(0, 10);
      if (d > end) break;
      if (d >= from) result.push(d);
    }
    return result;
  }
  if (!step) return [];
  for (
    let m = Math.max(
      0,
      Math.floor(
        ((year - start.getUTCFullYear()) * 12 - start.getUTCMonth()) / step,
      ) * step,
    );
    m <= (year - start.getUTCFullYear()) * 12 + 12;
    m += step
  ) {
    const month = start.getUTCMonth() + m;
    const last = new Date(
      Date.UTC(start.getUTCFullYear(), month + 1, 0),
    ).getUTCDate();
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), month, Math.min(anchor, last), 12),
    )
      .toISOString()
      .slice(0, 10);
    if (d > end) break;
    if (d >= from && d >= plan.starts_on) result.push(d);
  }
  return result;
}
export function expenseSummary(
  rows: Pick<CostPayment, "amount" | "category" | "paid_on">[],
) {
  const categories: Record<string, number> = {};
  const months: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const value = cents(row.amount);
    total += value;
    categories[row.category] = (categories[row.category] || 0) + value;
    const month = row.paid_on.slice(0, 7);
    months[month] = (months[month] || 0) + value;
  }
  return {
    total: total / 100,
    categories: Object.entries(categories)
      .map(([label, value]) => ({ label, value: value / 100 }))
      .sort((a, b) => b.value - a.value),
    months: Object.entries(months)
      .map(([label, value]) => ({ label, value: value / 100 }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export const SUBSCRIPTION_STATUSES = [
  "Active",
  "Needs verification",
  "Trial",
  "Canceled",
  "Expired",
] as const;
export const SUBSCRIPTION_FREQUENCIES = [
  ...EXPENSE_FREQUENCIES.filter((f) => f !== "One time"),
  "Every 2 years",
  "Every 4 weeks",
  "Usage-based",
  "Unknown",
];
export function forecastTotal(
  plans: CostPlan[],
  year: number,
  from: string,
  to: string,
) {
  return (
    plans
      .filter(
        (p) =>
          p.include_in_forecast &&
          p.status === "Active" &&
          !p.archived_at &&
          !p.deleted_at &&
          p.amount != null,
      )
      .reduce(
        (sum, p) =>
          sum +
          cents(p.amount!) *
            planDates(p, year).filter((d) => d >= from && d <= to).length,
        0,
      ) / 100
  );
}
