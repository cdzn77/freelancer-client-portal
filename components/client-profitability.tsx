"use client";
import { ConnectedOverview } from "./connected-overview";
import { Select } from "./select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Field, Panel, Modal } from "./ui";
import { money, total } from "@/lib/types";
import type { ProjectExpense } from "@/lib/studio-operations";
import { localDate } from "@/lib/work-planning";
import { supabase } from "@/lib/supabase";
export function ClientProfitability({ ctx }: { ctx: StudioContext }) {
  const [mode, setMode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expense, setExpense] = useState<ProjectExpense | null>(null);
  const [expenseProject, setExpenseProject] = useState("");
  const clients = Array.from(
    new Set(
      ctx.data.projects.map(
        (p) => p.client_account_id || p.client_name || "Unassigned client",
      ),
    ),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Client profitability.</h1>
          <p>
            USD · Invoiced revenue, recorded collections, expenses, and recorded
            labor cost.
          </p>
        </div>
        <div className="toolbar-right">
          <button
            className="button"
            onClick={() => {
              setExpense(null);
              setExpenseProject("");
              setMode("expense");
            }}
          >
            Add expense
          </button>
          <button className="button" onClick={() => setMode("receipt")}>
            Record payment
          </button>
        </div>
      </div>
      <ConnectedOverview ctx={ctx} />
      <Panel
        title="Legacy invoice reporting by client"
        bodyClassName="panel-body"
        subtitle="Invoice ledger only; document payments and reconciliation are not included. Draft and cancelled invoices are excluded. Collected margin subtracts recorded expenses and non-rejected labor cost; overhead, taxes and unrecorded costs are not included."
      >
        {clients.map((client) => {
          const ids = new Set(
            ctx.data.projects
              .filter(
                (p) =>
                  (p.client_account_id ||
                    p.client_name ||
                    "Unassigned client") === client,
              )
              .map((p) => p.id),
          );
          const invoices = ctx.data.invoices.filter(
            (i) =>
              ids.has(i.project_id) &&
              !["Draft", "Cancelled", "Void"].includes(i.status),
          );
          const invoiced = invoices.reduce((n, i) => n + total(i), 0);
          const collected = invoices.reduce((n, i) => {
            const receipts = ctx.data.invoice_receipts.filter(
              (r) => r.invoice_id === i.id,
            );
            return (
              n +
              (receipts.length
                ? receipts.reduce((x, r) => x + Number(r.amount), 0)
                : i.status === "Paid"
                  ? total(i)
                  : 0)
            );
          }, 0);
          const expenses = ctx.data.project_expenses
            .filter((e) => ids.has(e.project_id))
            .reduce((n, e) => n + Number(e.amount), 0);
          const labor = ctx.data.time_entries
            .filter((e) => ids.has(e.project_id) && e.status !== "Rejected")
            .reduce((n, e) => n + (e.minutes / 60) * e.cost_rate, 0);
          return (
            <div className="operation-section" key={client}>
              <h3>
                {ctx.data.client_accounts.find((c) => c.id === client)?.name ||
                  client}
              </h3>
              <dl className="profit-grid">
                <div>
                  <dt>Invoiced</dt>
                  <dd>{money(invoiced)}</dd>
                </div>
                <div>
                  <dt>Collected</dt>
                  <dd>{money(collected)}</dd>
                </div>
                <div>
                  <dt>Expenses</dt>
                  <dd>{money(expenses)}</dd>
                </div>
                <div>
                  <dt>Labor cost</dt>
                  <dd>{money(labor)}</dd>
                </div>
                <div>
                  <dt>Collected margin</dt>
                  <dd>{money(collected - expenses - labor)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
        <p className="muted">
          Invoices previously marked Paid without payment entries count as fully
          collected. Client groups use stable client identities. Use the
          identity controls above to link spelling variants.
        </p>
      </Panel>
      <Panel title="Expenses" bodyClassName="panel-body">
        {ctx.data.project_expenses.map((e) => (
          <div className="workflow-row" key={e.id}>
            <div>
              <strong>{e.description}</strong>
              <p>
                {ctx.data.projects.find((p) => p.id === e.project_id)?.name} ·{" "}
                {e.expense_date}
              </p>
            </div>
            <span>{money(Number(e.amount))}</span>
            <span>
              {ctx.data.tasks.find((t) => t.id === e.task_id)?.title ||
                "No linked task"}
            </span>
            {e.receipt_file_id && (
              <button
                className="text-button"
                onClick={async () => {
                  const file = ctx.data.project_files.find(
                    (f) => f.id === e.receipt_file_id,
                  );
                  if (!file) {
                    setError("Receipt is unavailable.");
                    return;
                  }
                  const {
                    data: { session },
                  } = await supabase.auth.getSession();
                  const response = await fetch(
                    `/api/storage?path=${encodeURIComponent(file.path)}`,
                    {
                      headers: {
                        Authorization: `Bearer ${session?.access_token}`,
                      },
                    },
                  );
                  const result = await response.json();
                  if (!response.ok) setError(result.error);
                  else window.open(result.url, "_blank", "noopener,noreferrer");
                }}
              >
                Open receipt
              </button>
            )}
            <button
              className="text-button"
              onClick={() => {
                setExpense(e);
                setExpenseProject(e.project_id);
                setMode("expense");
              }}
            >
              Edit expense
            </button>
            <button
              className="text-button"
              onClick={async () => {
                const { error } = await supabase
                  .from("project_expenses")
                  .delete()
                  .eq("id", e.id);
                if (error) setError(error.message);
                else await ctx.refresh();
              }}
            >
              Remove expense
            </button>
          </div>
        ))}
      </Panel>
      <Panel title="Recorded payments" bodyClassName="panel-body">
        {ctx.data.invoice_receipts.map((r) => (
          <div className="workflow-row" key={r.id}>
            <strong>
              {ctx.data.invoices.find((i) => i.id === r.invoice_id)?.number}
            </strong>
            <span>
              {r.received_on} · {money(Number(r.amount))} · {r.reference}
            </span>
            <button
              className="text-button"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Remove this payment record? This corrects the PMS ledger only and does not refund money.",
                  )
                )
                  return;
                const { error } = await supabase.rpc("remove_invoice_receipt", {
                  receipt: r.id,
                });
                if (error) setError(error.message);
                else await ctx.refresh();
              }}
            >
              Remove payment record
            </button>
          </div>
        ))}
      </Panel>
      <Modal
        open={!!mode}
        onClose={() => !busy && setMode("")}
        title={
          mode === "expense"
            ? expense
              ? "Edit project expense"
              : "Add project expense"
            : "Record invoice payment"
        }
        description="Record an amount already spent or received. This does not charge a card or transfer money."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const payload = {
                workspace_id: ctx.workspace.id,
                project_id: f.get("record"),
                description: f.get("description"),
                amount: Number(f.get("amount")),
                expense_date: f.get("date"),
                reimbursable: f.get("reimbursable") === "on",
                task_id: f.get("task_id") || null,
                receipt_file_id: f.get("receipt_file_id") || null,
              };
              const result =
                mode === "expense"
                  ? expense
                    ? await supabase
                        .from("project_expenses")
                        .update(payload)
                        .eq("id", expense.id)
                    : await supabase.from("project_expenses").insert(payload)
                  : await supabase.rpc("record_invoice_receipt", {
                      invoice: f.get("record"),
                      amount: Number(f.get("amount")),
                      received_on: f.get("date"),
                      reference: f.get("description"),
                    });
              if (result.error) throw result.error;
              await ctx.refresh();
              setMode("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "expense" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="reimbursable"
                defaultChecked={expense?.reimbursable}
              />
              Client reimbursable, outside existing fees
            </label>
          )}
          <Field label={mode === "expense" ? "Project" : "Invoice"}>
            <Select
              name="record"
              required
              defaultValue={mode === "expense" ? expense?.project_id || "" : ""}
              onChange={(e) => setExpenseProject(e.target.value)}
            >
              <option value="">Choose</option>
              {mode === "expense"
                ? ctx.data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                : ctx.data.invoices
                    .filter(
                      (i) =>
                        !["Paid", "Draft", "Cancelled", "Void"].includes(
                          i.status,
                        ),
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number} · {i.client_name}
                      </option>
                    ))}
            </Select>
          </Field>
          {mode === "expense" && (
            <div key={expenseProject}>
              <Field label="Linked task (optional)">
                <Select
                  name="task_id"
                  defaultValue={
                    expense?.project_id === expenseProject
                      ? expense.task_id || ""
                      : ""
                  }
                >
                  <option value="">No task</option>
                  {ctx.data.tasks
                    .filter((t) => t.project_id === expenseProject)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Receipt file (optional)">
                <Select
                  name="receipt_file_id"
                  defaultValue={
                    expense?.project_id === expenseProject
                      ? expense.receipt_file_id || ""
                      : ""
                  }
                >
                  <option value="">No receipt</option>
                  {ctx.data.project_files
                    .filter((f) => f.project_id === expenseProject)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.is_published ? "Shared" : "Private"})
                      </option>
                    ))}
                </Select>
              </Field>
              <p className="muted">
                Upload receipts in the project’s Files section. Linking a
                receipt does not share it with the client. Invoiced evidence is
                retained; cancel the source invoice before correcting the
                expense.
              </p>
            </div>
          )}
          <Field
            label={
              mode === "expense" ? "Expense description" : "Payment reference"
            }
          >
            <input
              name="description"
              required
              maxLength={200}
              defaultValue={
                mode === "expense" ? expense?.description || "" : ""
              }
            />
          </Field>
          <Field label="Amount (USD)">
            <input
              name="amount"
              defaultValue={mode === "expense" ? expense?.amount : undefined}
              type="number"
              step={0.01}
              min={0.01}
              required
            />
          </Field>
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              defaultValue={
                mode === "expense"
                  ? expense?.expense_date || localDate()
                  : localDate()
              }
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save record
          </button>
        </form>
      </Modal>
      {error && !mode && <p role="alert">{error}</p>}
    </>
  );
}
