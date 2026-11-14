"use client";
import { useLocationTab } from "@/lib/use-location-tab";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExpenseEmailSync } from "./expense-email-sync";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { Panel, Field, Modal, Empty } from "./ui";
import { Select } from "./select";
import {
  Cost,
  CostPlan,
  CostPayment,
  EXPENSE_CATEGORIES,
  EXPENSE_FREQUENCIES,
  expenseSummary,
  usd,
  forecastTotal,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_FREQUENCIES,
} from "@/lib/studio-expenses";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const months = Array.from({ length: 12 }, (_, i) =>
  new Date(2024, i, 1).toLocaleString("en-US", { month: "long" }),
);
const blank = {
  name: "",
  vendor: "",
  category: "Software & subscriptions",
  amount: "",
  frequency: "One time",
  notes: "",
  starts_on: "",
  status: "Needs verification",
  include_in_forecast: false,
  next_renewal_on: "",
  ends_on: "",
  review_for_savings: false,
  paid_on: today(),
  scheduled_for: "",
  payment_method: "",
  receipt_reference: "",
  plan_id: "",
};
type Draft = typeof blank;
export function StudioExpenses({ ctx }: { ctx: StudioContext }) {
  const [view, setView] = useLocationTab("expenses", "Payments", [
      "Payments",
      "Subscriptions",
      "Spending overview",
    ]),
    [subscriptionStatus, setSubscriptionStatus] = useState("Active"),
    [year, setYear] = useState(new Date().getFullYear()),
    [period, setPeriod] = useState("Year"),
    [customFrom, setCustomFrom] = useState(today()),
    [customTo, setCustomTo] = useState(today()),
    [category, setCategory] = useState("All"),
    [frequency, setFrequency] = useState("All"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("Newest"),
    [lifecycle, setLifecycle] = useState("Current"),
    [page, setPage] = useState(0),
    [payments, setPayments] = useState<CostPayment[]>([]),
    [plans, setPlans] = useState<CostPlan[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modal, setModal] = useState<null | {
      kind: "payment" | "plan";
      id?: string;
    }>(null),
    [draft, setDraft] = useState<Draft>(blank),
    [purge, setPurge] = useState<string[] | null>(null),
    [confirm, setConfirm] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [categoryPage, setCategoryPage] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => {
      setPageSize(query.matches ? 6 : 12);
      setPage(0);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const workspace = ctx.workspace.id,
    activeWorkspace = useRef(workspace),
    sequence = useRef(0);
  activeWorkspace.current = workspace;
  const from =
    period === "Custom"
      ? customFrom
      : period === "Year"
        ? `${year}-01-01`
        : `${year}-${period}-01`;
  const to =
    period === "Custom"
      ? customTo
      : period === "Year"
        ? `${year}-12-31`
        : `${year}-${period}-${new Date(year, Number(period), 0).getDate()}`;
  const validDates =
    from <= to && from >= `${year}-01-01` && to <= `${year}-12-31`;
  async function load() {
    if (activeWorkspace.current !== workspace) return;
    const n = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const collected: CostPayment[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("studio_cost_payments")
          .select("*")
          .eq("workspace_id", workspace)
          .gte("paid_on", `${year}-01-01`)
          .lte("paid_on", `${year}-12-31`)
          .order("paid_on", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        collected.push(...data);
        if (data.length < 500) break;
      }
      const allPlans: CostPlan[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("studio_cost_plans")
          .select("*")
          .eq("workspace_id", workspace)
          .order("name")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        allPlans.push(...data);
        if (data.length < 500) break;
      }
      if (n === sequence.current) {
        setPayments(collected);
        setPlans(allPlans);
        const validIds = new Set([...collected, ...allPlans].map((r) => r.id));
        setSelected(
          (previous) => new Set([...previous].filter((id) => validIds.has(id))),
        );
      }
    } catch {
      if (n === sequence.current)
        setError("Expenses could not load. Try Reload.");
    } finally {
      if (n === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setPayments([]);
    setPlans([]);
    void load();
    return () => {
      sequence.current++;
    };
  }, [workspace, year]);
  useEffect(() => {
    setSelected(new Set());
    setPage(0);
    setCategoryPage(0);
  }, [
    view,
    subscriptionStatus,
    year,
    period,
    customFrom,
    customTo,
    category,
    frequency,
    search,
    lifecycle,
    workspace,
  ]);
  const isVisible = (r: Cost) =>
    lifecycle === "Trash"
      ? !!r.deleted_at
      : lifecycle === "Archived"
        ? !!r.archived_at && !r.deleted_at
        : !r.deleted_at;
  const matches = (r: Cost) =>
    (category === "All" || r.category === category) &&
    (frequency === "All" || r.frequency === frequency) &&
    `${r.name} ${r.vendor}`.toLowerCase().includes(search.toLowerCase());
  const filteredPayments = useMemo(
    () =>
      payments
        .filter(
          (r) =>
            validDates &&
            r.paid_on >= from &&
            r.paid_on <= to &&
            isVisible(r) &&
            matches(r),
        )
        .sort((a, b) =>
          sort === "Amount"
            ? Number(b.amount) - Number(a.amount)
            : sort === "Name"
              ? a.name.localeCompare(b.name)
              : sort === "Oldest"
                ? a.paid_on.localeCompare(b.paid_on)
                : b.paid_on.localeCompare(a.paid_on),
        ),
    [
      payments,
      from,
      to,
      validDates,
      category,
      frequency,
      search,
      lifecycle,
      sort,
    ],
  );
  const filteredPlans = useMemo(
    () =>
      plans
        .filter(
          (r) =>
            isVisible(r) &&
            matches(r) &&
            (lifecycle !== "Current" || !r.archived_at) &&
            (subscriptionStatus === "All" || r.status === subscriptionStatus),
        )
        .sort((a, b) =>
          sort === "Amount"
            ? Number(b.amount) - Number(a.amount)
            : sort === "Name"
              ? a.name.localeCompare(b.name)
              : sort === "Oldest"
                ? (a.starts_on || "").localeCompare(b.starts_on || "")
                : (b.starts_on || "").localeCompare(a.starts_on || ""),
        ),
    [plans, subscriptionStatus, category, frequency, search, lifecycle, sort],
  );
  const list: Cost[] =
    view === "Subscriptions" ? filteredPlans : filteredPayments;
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize)),
    currentPage = Math.min(page, pageCount - 1),
    visible = list.slice(
      currentPage * pageSize,
      currentPage * pageSize + pageSize,
    );
  const summary = expenseSummary(filteredPayments.filter((r) => !r.deleted_at));
  const yearPayments = payments.filter((r) => !r.deleted_at);
  const yearTotal = expenseSummary(yearPayments).total;
  const forecast = forecastTotal(plans.filter(matches), year, from, to);
  const selectedRows = filteredPayments.filter((r) => selected.has(r.id));
  const patch = (key: keyof Draft, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function open(kind: "payment" | "plan", row?: CostPayment | CostPlan) {
    setError("");
    setModal({ kind, id: row?.id });
    setDraft(
      row
        ? ({
            ...blank,
            ...row,
            amount: row.amount == null ? "" : String(row.amount),
            starts_on: (row as CostPlan).starts_on || "",
            next_renewal_on: (row as CostPlan).next_renewal_on || "",
            ends_on: (row as CostPlan).ends_on || "",
            plan_id: (row as CostPayment).plan_id || "",
            scheduled_for: (row as CostPayment).scheduled_for || "",
          } as Draft)
        : { ...blank, frequency: kind === "plan" ? "Monthly" : "One time" },
    );
  }
  function record(plan: CostPlan) {
    setModal({ kind: "payment" });
    setDraft({
      ...blank,
      name: plan.name,
      vendor: plan.vendor,
      category: plan.category,
      amount: plan.amount == null ? "" : String(plan.amount),
      frequency: EXPENSE_FREQUENCIES.includes(plan.frequency as any)
        ? plan.frequency
        : "One time",
      plan_id: plan.id,
      scheduled_for: today(),
    });
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError("");
    try {
      const common = {
        name: draft.name.trim(),
        vendor: draft.vendor.trim(),
        category: draft.category,
        amount:
          draft.amount === "" && modal.kind === "plan"
            ? null
            : Number(draft.amount),
        frequency: draft.frequency,
        notes: draft.notes.trim(),
      };
      if (
        !common.name ||
        (common.amount !== null &&
          (!Number.isFinite(common.amount) || common.amount <= 0))
      )
        throw Error("Enter an expense name and positive amount.");
      if (
        modal.kind === "plan" &&
        draft.include_in_forecast &&
        (draft.status !== "Active" ||
          !draft.starts_on ||
          common.amount === null ||
          !EXPENSE_FREQUENCIES.includes(draft.frequency as any))
      )
        throw Error(
          "Forecasts require an active plan, a known positive price, first charge date and supported billing frequency.",
        );
      const body =
        modal.kind === "plan"
          ? {
              ...common,
              starts_on: draft.starts_on || null,
              status: draft.status,
              include_in_forecast: draft.include_in_forecast,
              next_renewal_on: draft.next_renewal_on || null,
              ends_on: draft.ends_on || null,
              review_for_savings: draft.review_for_savings,
            }
          : {
              ...common,
              paid_on: draft.paid_on,
              plan_id: draft.plan_id || null,
              scheduled_for: draft.plan_id ? draft.scheduled_for || null : null,
              payment_method: draft.payment_method,
              receipt_reference: draft.receipt_reference,
            };
      const table =
        modal.kind === "plan" ? "studio_cost_plans" : "studio_cost_payments";
      const result = modal.id
        ? await supabase
            .from(table)
            .update(body)
            .eq("workspace_id", workspace)
            .eq("id", modal.id)
            .select("id")
            .single()
        : await supabase
            .from(table)
            .insert({ ...body, workspace_id: workspace })
            .select("id")
            .single();
      if (result.error)
        throw Error(
          result.error.code === "23505"
            ? "A payment is already recorded for this subscription charge date."
            : "Could not save this expense. Check the dates and try again.",
        );
      const savedYear = Number(
        (modal.kind === "payment" ? draft.paid_on : draft.starts_on).slice(
          0,
          4,
        ),
      );
      setModal(null);
      if (modal.kind === "payment" && savedYear !== year) {
        setYear(savedYear);
        setPeriod("Year");
      } else await load();
      ctx.notify("Studio expense saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(row: Cost, action: "archive" | "trash" | "restore") {
    setBusy(true);
    const table =
      view === "Subscriptions" ? "studio_cost_plans" : "studio_cost_payments";
    const { error } = await supabase
      .from(table)
      .update(
        action === "archive"
          ? { archived_at: new Date().toISOString() }
          : action === "trash"
            ? { deleted_at: new Date().toISOString() }
            : { deleted_at: null, archived_at: null },
      )
      .eq("workspace_id", workspace)
      .eq("id", row.id);
    if (error) setError("Could not update this item.");
    else {
      setSelected(new Set());
      await load();
    }
    setBusy(false);
  }
  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function exportPDF() {
    if (!selectedRows.length) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/studio-expenses/pdf", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace,
          ids: selectedRows.map((r) => r.id),
          from,
          to,
        }),
      });
      if (!r.ok) throw Error((await r.json()).error || "PDF export failed");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `studio-expenses-${from}-to-${to}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      ctx.notify(
        "PDF downloaded. Open it to print or share with your accountant.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function emptyTrash() {
    setBusy(true);
    try {
      const ids: string[] = [];
      const table =
        view === "Subscriptions" ? "studio_cost_plans" : "studio_cost_payments";
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from(table)
          .select("id")
          .eq("workspace_id", workspace)
          .not("deleted_at", "is", null)
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        ids.push(...data.map((r) => r.id));
        if (data.length < 500) break;
      }
      setPurge(ids);
      setConfirm("");
    } catch {
      setError("Could not read Trash.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="studio-expenses" aria-label="Studio expenses">
      <div className="expense-heading">
        <div>
          <h2>Studio expenses</h2>
          <p className="muted">
            Track overhead, subscriptions and purchases. USD · Payment records
            stay separate from future plans.
          </p>
        </div>
        <div className="expense-actions">
          <button className="button" onClick={load} disabled={busy || loading}>
            Reload
          </button>
          <button
            className="button primary"
            onClick={() => open(view === "Subscriptions" ? "plan" : "payment")}
          >
            {view === "Subscriptions" ? "Add subscription" : "Record payment"}
          </button>
        </div>
      </div>
      <nav className="expense-view-switch" aria-label="Studio expense views">
        {["Payments", "Subscriptions", "Spending overview"].map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setLifecycle("Current");
            }}
          >
            {v}
          </button>
        ))}
      </nav>
      <div className="expense-filters">
        <Field label="Year">
          <Select
            value={String(year)}
            onChange={(e) => {
              const y = Number(e.target.value);
              setYear(y);
              setCustomFrom(`${y}-01-01`);
              setCustomTo(`${y}-12-31`);
            }}
          >
            {Array.from({ length: 101 }, (_, i) => 2100 - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="Year">Full year</option>
            {months.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>
                {m}
              </option>
            ))}
            <option value="Custom">Custom dates</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>All</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <details className="expense-more-filters">
          <summary>More filters</summary>
          <div>
            <Field label="Frequency">
              <Select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option>All</option>
                {(view === "Subscriptions"
                  ? SUBSCRIPTION_FREQUENCIES
                  : EXPENSE_FREQUENCIES
                ).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field label="Search expense or vendor">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Adobe, equipment, AI…"
              />
            </Field>
            <Field label="Sort">
              <Select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
              >
                {["Newest", "Oldest", "Amount", "Name"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>
        </details>
      </div>
      {view === "Subscriptions" && (
        <div className="expense-date-range">
          <Field label="Subscription status">
            <Select
              value={subscriptionStatus}
              onChange={(e) => setSubscriptionStatus(e.target.value)}
            >
              <option>All</option>
              {SUBSCRIPTION_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </Select>
          </Field>
          <button
            type="button"
            onClick={() => setSubscriptionStatus("Needs verification")}
          >
            Needs verification (
            {
              plans.filter(
                (p) =>
                  p.status === "Needs verification" &&
                  !p.deleted_at &&
                  !p.archived_at,
              ).length
            }
            )
          </button>
        </div>
      )}
      {period === "Custom" && (
        <div className="expense-date-range">
          <Field label="From">
            <input
              type="date"
              value={customFrom}
              min={`${year}-01-01`}
              max={`${year}-12-31`}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </Field>
          <Field label="Through">
            <input
              type="date"
              value={customTo}
              min={customFrom}
              max={`${year}-12-31`}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </Field>
        </div>
      )}
      <details onToggle={(e) => setEmailOpen(e.currentTarget.open)}>
        <summary>Email sync · connections and receipt review</summary>
        {emailOpen && (
          <ExpenseEmailSync
            workspace={workspace}
            plans={plans}
            onChanged={() => void load()}
          />
        )}
      </details>
      {!validDates && (
        <p role="alert">Choose a start and end date within {year}.</p>
      )}
      {error && (
        <p role="alert" className="expense-notice">
          {error}
        </p>
      )}
      <div className="expense-stats">
        <div>
          <span>Recorded payments · filtered period</span>
          <strong>{usd(summary.total)}</strong>
          <small>{summary.categories.length} categories · excludes Trash</small>
        </div>
        <div>
          <span>Recorded payments · all of {year}</span>
          <strong>{usd(yearTotal)}</strong>
          <small>Includes archived payments · all categories</small>
        </div>
        <div>
          <span>Planned charges · filtered period</span>
          <strong>{usd(forecast)}</strong>
          <small>
            Opted-in active plans only · never added to recorded spending
          </small>
        </div>
      </div>
      {view === "Spending overview" ? (
        <div className="expense-insights">
          <Panel
            title="Where the money goes"
            subtitle="Recorded payments in the filtered period."
          >
            <div className="expense-panel-body">
              {!summary.categories.length ? (
                <Empty title="Record payments to see spending" />
              ) : (
                summary.categories
                  .slice(categoryPage * 6, categoryPage * 6 + 6)
                  .map((c) => (
                    <div className="expense-category-bar" key={c.label}>
                      <div>
                        <span>{c.label}</span>
                        <strong>{usd(c.value)}</strong>
                      </div>
                      <div className="expense-bar-track">
                        <span
                          style={{
                            width: `${summary.total ? (c.value / summary.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))
              )}
              {summary.categories.length > 6 && (
                <div className="expense-pagination">
                  <button
                    className="button small"
                    disabled={categoryPage === 0}
                    onClick={() => setCategoryPage(categoryPage - 1)}
                  >
                    Previous categories
                  </button>
                  <span>
                    {categoryPage + 1} /{" "}
                    {Math.ceil(summary.categories.length / 6)}
                  </span>
                  <button
                    className="button small"
                    disabled={
                      (categoryPage + 1) * 6 >= summary.categories.length
                    }
                    onClick={() => setCategoryPage(categoryPage + 1)}
                  >
                    Next categories
                  </button>
                </div>
              )}
            </div>
          </Panel>
          <Panel
            title={`${year} by month`}
            subtitle="All recorded payments; category and period filters do not change these annual totals."
          >
            <div className="expense-panel-body expense-months">
              {months.map((m, i) => {
                const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                const value =
                  expenseSummary(yearPayments).months.find(
                    (r) => r.label === key,
                  )?.value || 0;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      setPeriod(String(i + 1).padStart(2, "0"));
                      setCategory("All");
                      setFrequency("All");
                      setSearch("");
                      setView("Payments");
                    }}
                  >
                    <span>{m}</span>
                    <strong>{usd(value)}</strong>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel
            title="Review subscriptions"
            subtitle="Flag a plan for review to track opportunities to reduce costs."
          >
            <div className="expense-panel-body">
              {plans
                .filter(
                  (p) =>
                    p.review_for_savings && !p.deleted_at && !p.archived_at,
                )
                .slice(0, 6)
                .map((p) => (
                  <button
                    className="expense-review-item"
                    key={p.id}
                    onClick={() => open("plan", p)}
                  >
                    <span>{p.name}</span>
                    <strong>
                      {p.amount == null
                        ? "Not confirmed"
                        : usd(Number(p.amount))}{" "}
                      / {p.frequency.toLowerCase()}
                    </strong>
                  </button>
                ))}
              <button
                className="button"
                onClick={() => setView("Subscriptions")}
              >
                Manage all subscriptions{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel
          title={
            view === "Subscriptions"
              ? "Subscription register"
              : "Payment records"
          }
          subtitle={
            view === "Subscriptions"
              ? "Track subscriptions independently of payments. Only plans with Include in forecast enabled contribute to estimates. Date filters apply to payments and forecasts, not this register."
              : "Record actual payments. Archived records remain in the default list and report totals."
          }
        >
          <div className="expense-panel-body">
            <div className="expense-list-toolbar">
              <div className="expense-lifecycle">
                {["Current", "Archived", "Trash"].map((s) => (
                  <button
                    key={s}
                    aria-pressed={lifecycle === s}
                    onClick={() => setLifecycle(s)}
                  >
                    {s === "Current"
                      ? view === "Payments"
                        ? "All payments"
                        : "Active"
                      : s}
                  </button>
                ))}
              </div>
              {lifecycle === "Trash" && (
                <button className="button" disabled={busy} onClick={emptyTrash}>
                  Empty trash
                </button>
              )}
            </div>
            <div className="expense-selection">
              {lifecycle !== "Trash" && selected.size > 0 && (
                <button
                  className="button small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const ids = list
                        .filter((r) => selected.has(r.id))
                        .map((r) => r.id);
                      for (let i = 0; i < ids.length; i += 200) {
                        const { error } = await supabase
                          .from(
                            view === "Subscriptions"
                              ? "studio_cost_plans"
                              : "studio_cost_payments",
                          )
                          .update({ archived_at: new Date().toISOString() })
                          .eq("workspace_id", workspace)
                          .is("deleted_at", null)
                          .in("id", ids.slice(i, i + 200));
                        if (error) throw error;
                      }
                      setSelected(new Set());
                      await load();
                    } catch {
                      setError(
                        "Some items could not be archived. Reload to see their status.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Archive selected
                </button>
              )}
              <label>
                <input
                  type="checkbox"
                  aria-label="Select all items on this page"
                  checked={
                    !!visible.length && visible.every((r) => selected.has(r.id))
                  }
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected((s) => {
                      const n = new Set(s);
                      visible.forEach((r) =>
                        checked ? n.add(r.id) : n.delete(r.id),
                      );
                      return n;
                    });
                  }}
                />
                {selected.size} selected
              </label>
              <button
                className="button small"
                disabled={!list.length}
                onClick={() => setSelected(new Set(list.map((r) => r.id)))}
              >
                Select all {list.length} matching
              </button>
              {selected.size > 0 && (
                <button
                  className="button small"
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </button>
              )}
              {view === "Payments" && lifecycle !== "Trash" && (
                <button
                  className="button"
                  disabled={
                    !selectedRows.length || busy || selectedRows.length > 2500
                  }
                  onClick={exportPDF}
                >
                  Export selected PDF
                </button>
              )}
              {lifecycle === "Trash" && (
                <button
                  className="button"
                  disabled={!selected.size || busy}
                  onClick={() => {
                    setPurge([...selected]);
                    setConfirm("");
                  }}
                >
                  Delete selected permanently
                </button>
              )}
            </div>
            {selectedRows.length > 2500 && (
              <p role="alert">
                Choose a smaller date range to export up to 2,500 payments at a
                time.
              </p>
            )}
            {loading ? (
              <p role="status">Loading studio expenses…</p>
            ) : !list.length ? (
              <Empty
                title={
                  view === "Subscriptions"
                    ? "No plans match these filters"
                    : "No payments match these filters"
                }
              />
            ) : (
              <div className="expense-list">
                <div className="expense-list-header">
                  <span></span>
                  <span>Expense / vendor</span>
                  <span>Category / frequency</span>
                  <span>
                    {view === "Subscriptions" ? "Next renewal" : "Paid on"}
                  </span>
                  <span>Amount</span>
                  <span>Actions</span>
                </div>
                {visible.map((row) => (
                  <article className="expense-row" key={row.id}>
                    <div className="expense-row-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </div>
                    <div className="expense-row-name">
                      <button
                        onClick={() =>
                          open(
                            view === "Subscriptions" ? "plan" : "payment",
                            row as CostPayment,
                          )
                        }
                      >
                        {row.name}
                      </button>
                      <small>
                        {row.vendor || "No vendor"}
                        {view === "Subscriptions"
                          ? ` · ${(row as CostPlan).status} · ${(row as CostPlan).include_in_forecast ? "Forecast on" : "Forecast off"}`
                          : ""}
                        {row.archived_at ? " · Archived" : ""}
                        {(row as CostPlan).review_for_savings
                          ? " · Review for savings"
                          : ""}
                      </small>
                    </div>
                    <div className="expense-row-category">
                      <span>{row.category}</span>
                      <small>{row.frequency}</small>
                    </div>
                    <div className="expense-row-date">
                      <span className="expense-mobile-label">
                        {view === "Subscriptions" ? "Next renewal" : "Paid"}
                      </span>
                      {view === "Subscriptions"
                        ? (row as CostPlan).next_renewal_on || "Not confirmed"
                        : (row as CostPayment).paid_on}
                    </div>
                    <strong className="expense-row-amount">
                      {row.amount == null
                        ? "Not confirmed"
                        : usd(Number(row.amount))}
                    </strong>
                    <details className="expense-row-actions">
                      <summary>Actions</summary>
                      <div>
                        {!row.deleted_at && (
                          <>
                            <button
                              onClick={() =>
                                open(
                                  view === "Subscriptions" ? "plan" : "payment",
                                  row as CostPayment,
                                )
                              }
                            >
                              Edit
                            </button>
                            {view === "Subscriptions" && (
                              <button onClick={() => record(row as CostPlan)}>
                                Record payment
                              </button>
                            )}
                          </>
                        )}
                        {row.archived_at || row.deleted_at ? (
                          <button
                            disabled={busy}
                            onClick={() => change(row, "restore")}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => change(row, "archive")}
                          >
                            Archive
                          </button>
                        )}
                        {!row.deleted_at && (
                          <button
                            disabled={busy}
                            onClick={() => change(row, "trash")}
                          >
                            Move to trash
                          </button>
                        )}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            )}
            <div className="expense-pagination">
              <span>
                {list.length
                  ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, list.length)} of ${list.length}`
                  : "0 items"}
              </span>
              <div>
                <button
                  className="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="button"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </Panel>
      )}
      <Modal
        open={!!modal}
        onClose={() => {
          if (!busy) setModal(null);
        }}
        title={`${modal?.id ? "Edit" : modal?.kind === "plan" ? "Add" : "Record"} ${modal?.kind === "plan" ? "subscription" : "payment"}`}
        description={
          modal?.kind === "plan"
            ? "Track status and known billing details. Leave unknown prices or dates blank. Payments remain separate."
            : "Enter the amount actually paid, including any tax charged. USD only."
        }
      >
        <form onSubmit={save} className="expense-form">
          {error && <p role="alert">{error}</p>}
          <div className="expense-form-grid">
            <Field label="Expense name">
              <input
                required
                maxLength={160}
                value={draft.name}
                onChange={(e) => patch("name", e.target.value)}
              />
            </Field>
            <Field label="Vendor">
              <input
                maxLength={160}
                value={draft.vendor}
                onChange={(e) => patch("vendor", e.target.value)}
              />
            </Field>
            <Field label="Category">
              <Select
                value={draft.category}
                onChange={(e) => patch("category", e.target.value)}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Frequency">
              <Select
                value={draft.frequency}
                onChange={(e) => patch("frequency", e.target.value)}
              >
                {(modal?.kind === "plan"
                  ? SUBSCRIPTION_FREQUENCIES
                  : EXPENSE_FREQUENCIES
                ).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={
                modal?.kind === "plan"
                  ? "Amount per charge (USD)"
                  : "Amount paid (USD)"
              }
            >
              <input
                required={modal?.kind !== "plan" || draft.include_in_forecast}
                type="number"
                inputMode="decimal"
                min="0.01"
                max="9999999999.99"
                step="0.01"
                value={draft.amount}
                onChange={(e) => patch("amount", e.target.value)}
              />
            </Field>
            {modal?.kind === "plan" ? (
              <>
                <Field label="Status">
                  <Select
                    value={draft.status}
                    onChange={(e) => {
                      patch("status", e.target.value);
                      if (e.target.value !== "Active")
                        patch("include_in_forecast", false);
                    }}
                  >
                    {SUBSCRIPTION_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Next renewal (optional)">
                  <input
                    type="date"
                    value={draft.next_renewal_on}
                    onChange={(e) => patch("next_renewal_on", e.target.value)}
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.include_in_forecast}
                    disabled={draft.status !== "Active"}
                    onChange={(e) =>
                      patch("include_in_forecast", e.target.checked)
                    }
                  />{" "}
                  Include in forecast
                </label>
                <Field label="First charge date (optional unless forecasting)">
                  <input
                    required={draft.include_in_forecast}
                    type="date"
                    min="2000-01-01"
                    max="2100-12-31"
                    value={draft.starts_on}
                    onChange={(e) => patch("starts_on", e.target.value)}
                  />
                </Field>
                <Field label="Last charge date (optional)">
                  <input
                    type="date"
                    min={draft.starts_on}
                    max="2100-12-31"
                    value={draft.ends_on}
                    onChange={(e) => patch("ends_on", e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Paid on">
                  <input
                    required
                    type="date"
                    min="2000-01-01"
                    max={today()}
                    value={draft.paid_on}
                    onChange={(e) => patch("paid_on", e.target.value)}
                  />
                </Field>
                <Field label="Payment method">
                  <Select
                    value={draft.payment_method}
                    onChange={(e) => patch("payment_method", e.target.value)}
                  >
                    <option value="">Not specified</option>
                    {[
                      "Business credit card",
                      "Business debit card",
                      "Bank transfer",
                      "Cash",
                      "Personal funds",
                      "Other",
                    ].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Receipt reference or link">
                  <input
                    maxLength={500}
                    value={draft.receipt_reference}
                    onChange={(e) => patch("receipt_reference", e.target.value)}
                    placeholder="Invoice number or receipt location"
                  />
                </Field>
                {draft.plan_id && (
                  <Field label="Scheduled charge date">
                    <input
                      required
                      type="date"
                      value={draft.scheduled_for}
                      onChange={(e) => patch("scheduled_for", e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
          </div>
          {modal?.kind === "plan" && (
            <label className="expense-review-check">
              <input
                type="checkbox"
                checked={draft.review_for_savings}
                onChange={(e) => patch("review_for_savings", e.target.checked)}
              />
              Review this subscription for possible savings
            </label>
          )}
          <Field label="Notes">
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.notes}
              onChange={(e) => patch("notes", e.target.value)}
            />
          </Field>
          <p className="muted">
            Categories organize your records. They do not determine tax
            deductibility. Keep the original receipts.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={purge !== null}
        onClose={() => {
          if (!busy) setPurge(null);
        }}
        title="Permanently empty trash"
        description={`Permanently delete ${purge?.length || 0} trashed ${view === "Subscriptions" ? "plans" : "payments"}. Deleting plans preserves previously recorded payments. Downloaded PDFs and external receipts are not removed.`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (confirm !== "DELETE" || !purge?.length) return;
            setBusy(true);
            try {
              for (let i = 0; i < purge.length; i += 200) {
                const { error } = await supabase
                  .from(
                    view === "Subscriptions"
                      ? "studio_cost_plans"
                      : "studio_cost_payments",
                  )
                  .delete()
                  .eq("workspace_id", workspace)
                  .not("deleted_at", "is", null)
                  .in("id", purge.slice(i, i + 200));
                if (error) throw error;
              }
              setPurge(null);
              setSelected(new Set());
              await load();
            } catch {
              setError(
                "Deletion stopped. Some items may have been removed; reload Trash before retrying.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Type DELETE to confirm">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy || confirm !== "DELETE" || !purge?.length}
            >
              Delete permanently
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
