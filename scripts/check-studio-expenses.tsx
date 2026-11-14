import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import {
  planDates,
  forecastTotal,
  expenseSummary,
  CostPayment,
  CostPlan,
} from "../lib/studio-expenses";

async function main() {
  const monthly = {
    starts_on: "2024-01-31",
    ends_on: null,
    frequency: "Monthly",
  };
  const tracked = {
    ...monthly,
    id: "tracked",
    name: "Tracked",
    vendor: "",
    workspace_id: "fixture",
    category: "AI services",
    amount: 20,
    status: "Active",
    include_in_forecast: false,
    next_renewal_on: null,
    notes: "",
    archived_at: null,
    deleted_at: null,
    review_for_savings: false,
  } as CostPlan;
  assert.equal(forecastTotal([tracked], 2024, "2024-01-01", "2024-12-31"), 0);
  assert.equal(
    forecastTotal(
      [{ ...tracked, include_in_forecast: true }],
      2024,
      "2024-01-01",
      "2024-12-31",
    ),
    240,
  );
  for (const status of ["Canceled", "Needs verification", "Expired", "Trial"])
    assert.equal(
      forecastTotal(
        [{ ...tracked, status, include_in_forecast: true }],
        2024,
        "2024-01-01",
        "2024-12-31",
      ),
      0,
    );
  assert.deepEqual(planDates({ ...monthly, starts_on: null }, 2024), []);
  assert.equal(
    forecastTotal(
      [{ ...tracked, amount: null, starts_on: null }],
      2024,
      "2024-01-01",
      "2024-12-31",
    ),
    0,
  );
  const dates = planDates(monthly, 2024);
  assert.equal(dates.length, 12);
  assert.equal(dates[1], "2024-02-29");
  assert.equal(dates[2], "2024-03-31");
  assert.equal(planDates(monthly, 2025)[1], "2025-02-28");
  assert.deepEqual(
    planDates(
      { starts_on: "2024-02-29", ends_on: null, frequency: "Annually" },
      2025,
    ),
    ["2025-02-28"],
  );
  assert.deepEqual(planDates({ ...monthly, ends_on: "2024-03-15" }, 2024), [
    "2024-01-31",
    "2024-02-29",
  ]);
  assert.deepEqual(
    planDates(
      { starts_on: "2026-11-15", ends_on: null, frequency: "Quarterly" },
      2027,
    ),
    ["2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"],
  );
  assert.equal(
    planDates(
      { starts_on: "2026-01-01", ends_on: null, frequency: "Weekly" },
      2026,
    ).length,
    53,
  );
  assert.deepEqual(planDates({ ...monthly, frequency: "One time" }, 2025), []);
  const rows = [
    {
      id: "1",
      name: "AI subscription",
      vendor: "Example vendor",
      category: "AI services",
      frequency: "Monthly",
      paid_on: "2026-01-02",
      amount: 0.1,
      payment_method: "Business credit card",
      receipt_reference: "receipt-1",
      notes: "",
    },
    {
      id: "2",
      name: "Design software",
      vendor: "Example vendor",
      category: "Software & subscriptions",
      frequency: "Annually",
      paid_on: "2026-02-01",
      amount: 0.2,
      payment_method: "",
      receipt_reference: "",
      notes: "",
    },
  ] as CostPayment[];
  const summary = expenseSummary(rows);
  assert.equal(summary.total, 0.3);
  assert.equal(summary.months.length, 2);
  assert.equal(summary.categories.length, 2);
  console.log(
    "PASS: anchored month-end/leap-year schedules, quarterly/weekly/one-time schedules, stop dates, cent-safe totals, category/month grouping.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
