"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { Field, Modal } from "./ui";
import { Select } from "./select";
import { money } from "@/lib/types";
export function WorkInvoice({ ctx }: { ctx: StudioContext }) {
  const [open, setOpen] = useState(false),
    [project, setProject] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [request, setRequest] = useState(() => crypto.randomUUID());
  const billed = new Set(
    ctx.data.invoice_sources
      .filter((s) => !s.released)
      .flatMap((s) => [s.time_entry_id, s.expense_id]),
  );
  const within = (d: string) => (!from || d >= from) && (!to || d <= to);
  const time = ctx.data.time_entries.filter(
    (e) =>
      e.project_id === project &&
      e.status === "Approved" &&
      e.billable &&
      e.billing_treatment === "invoice" &&
      e.bill_rate > 0 &&
      !billed.has(e.id) &&
      within(e.entry_date),
  );
  const expenses = ctx.data.project_expenses.filter(
    (e) =>
      e.project_id === project &&
      e.reimbursable &&
      !billed.has(e.id) &&
      within(e.expense_date),
  );
  const candidates = [
    ...time.map((e) => ({
      id: e.id,
      label: e.description,
      date: e.entry_date,
      amount: (e.minutes / 60) * e.bill_rate,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      label: e.description,
      date: e.expense_date,
      amount: Number(e.amount),
    })),
  ];
  const picked = candidates.filter((c) => selected.includes(c.id));
  return (
    <>
      <button
        className="button"
        onClick={() => {
          setOpen(true);
          setRequest(crypto.randomUUID());
          setSelected([]);
          setError("");
        }}
      >
        Draft invoice from recorded work
      </button>
      <details>
        <summary className="work-invoice-summary">Invoices prepared from work</summary>
        {ctx.data.invoices
          .filter((i) =>
            ctx.data.invoice_sources.some((s) => s.invoice_id === i.id),
          )
          .map((i) => (
            <div className="operation-section" key={i.id}>
              <strong>
                {i.number} · {i.status}
              </strong>
              <ul>
                {ctx.data.invoice_sources
                  .filter((s) => s.invoice_id === i.id)
                  .map((s) => (
                    <li key={s.id}>
                      {String(s.snapshot.description || "Source record")}
                      {s.released ? " (released for replacement billing)" : ""}
                    </li>
                  ))}
              </ul>
              {!["Paid", "Cancelled", "Void"].includes(i.status) && (
                <button
                  className="button"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Cancel this unpaid invoice and release its work for a replacement? The invoice history is preserved.",
                      )
                    )
                      return;
                    await ctx.mutate("invoices", { status: "Cancelled" }, i.id);
                  }}
                >
                  Cancel and release work
                </button>
              )}
            </div>
          ))}
      </details>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invoice approved work"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const f = new FormData(e.currentTarget);
              const { error } = await supabase.rpc("create_work_invoice", {
                p_project: project,
                p_time_ids: time
                  .filter((e) => selected.includes(e.id))
                  .map((e) => e.id),
                p_expense_ids: expenses
                  .filter((e) => selected.includes(e.id))
                  .map((e) => e.id),
                p_due: f.get("due"),
                p_request: request,
                p_acknowledge: f.get("coverage") === "on",
              });
              if (error) throw error;
              await ctx.refresh();
              setOpen(false);
              ctx.notify("Invoice draft created with source records");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Project">
            <Select
              aria-label="Project"
              required
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setSelected([]);
                setRequest(crypto.randomUUID());
              }}
            >
              <option value="">Choose project</option>
              {ctx.data.projects
                .filter((p) => !p.archived_at && !p.deleted_at)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="form-grid">
            <Field label="Work from">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setSelected([]);
                }}
              />
            </Field>
            <Field label="Work through">
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setSelected([]);
                }}
              />
            </Field>
            <Field label="Invoice due">
              <input type="date" required name="due" />
            </Field>
          </div>
          <p>
            Only approved time marked “Invoice separately” and reimbursable
            expenses appear. Set billing coverage in the time-entry editor;
            earlier records require review.
          </p>
          {candidates.map((c) => (
            <label className="workflow-row" key={c.id}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, c.id]
                      : selected.filter((id) => id !== c.id),
                  );
                  setRequest(crypto.randomUUID());
                }}
              />
              <span>
                {c.label}
                <small>{c.date}</small>
              </span>
              <strong>{money(c.amount)}</strong>
            </label>
          ))}
          {!candidates.length && <p>No eligible records in this period.</p>}
          <p>
            Draft preview: {picked.length} source lines ·{" "}
            {money(picked.reduce((n, c) => n + c.amount, 0))}
          </p>
          <label className="checkbox-label">
            <input type="checkbox" required name="coverage" />I checked retainer
            coverage, fixed fees, deposits and earlier invoices. This work is
            billed separately.
          </label>
          <p>
            Each source retains its description and rate. Cancel an unpaid
            source invoice to release its work; issued history is preserved.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy || !picked.length}>
            {busy ? "Creating draft…" : "Create invoice draft"}
          </button>
        </form>
      </Modal>
    </>
  );
}
