"use client";
import { useLocationTab } from "@/lib/use-location-tab";
import { TwoFactor } from "./account-security";
import { AddWorkspaceMember } from "./add-workspace-member";
import { StudioExpenses } from "./studio-expenses";
import { DeleteWorkspace } from "./delete-workspace";
import { Select } from "./select";
import { BillingAutomation } from "./billing-automation";
import { BillingHub } from "./billing-hub";
import { WorkInvoice } from "./work-invoice";
import { Budgets } from "./budgets";
import { DeleteAction } from "./delete-action";
import { AccountMembers } from "./access";
import { useEffect, useState } from "react";
import {
  Plus,
  Play,
  Square,
  Download,
  Check,
  Send,
  ArrowUpRight,
  Clock3,
  ReceiptText,
} from "lucide-react";
import { StudioContext } from "./studio";
import {
  Badge,
  Empty,
  Field,
  Modal,
  Panel,
  Progress,
  Stat,
  statusTone,
} from "./ui";
import { Entry, Financial, money, total, dateLabel } from "@/lib/types";
import { supabase } from "@/lib/supabase";
export function TimeView({ ctx }: { ctx: StudioContext }) {
  const [taskId, setTaskId] = useState("");
  const [entryProject, setEntryProject] = useState("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [manual, setManual] = useState(false),
    [started, setStarted] = useState<number | null>(null),
    [seconds, setSeconds] = useState(0),
    [project, setProject] = useState(ctx.data.projects[0]?.id || ""),
    [description, setDescription] = useState(""),
    [billable, setBillable] = useState(true),
    [saving, setSaving] = useState(false),
    [costRate, setCostRate] = useState(65),
    [billRate, setBillRate] = useState(150);
  useEffect(() => {
    if (manual)
      setEntryProject(editing?.project_id || ctx.data.projects[0]?.id || "");
  }, [manual, editing]);
  const key = `portal-timer:${ctx.userId}:${ctx.workspace.id}`;
  useEffect(() => {
    const raw = localStorage.getItem(key);
    if (!raw) {
      const id = new URLSearchParams(window.location.search).get("timerTask");
      const task = ctx.data.tasks.find((t) => t.id === id);
      if (task) {
        setProject(task.project_id);
        setTaskId(task.id);
        setDescription(task.title);
      }
    }
    if (raw) {
      try {
        const t = JSON.parse(raw);
        setStarted(t.started);
        setProject(t.project);
        setTaskId(t.taskId || "");
        setDescription(t.description);
        setBillable(t.billable);
        setCostRate(t.costRate ?? 65);
        setBillRate(t.billRate ?? 150);
      } catch {
        localStorage.removeItem(key);
      }
    }
    return () => setStarted(null);
  }, [key]);
  useEffect(() => {
    if (!started) return;
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [started]);
  async function toggle() {
    if (!project || !description.trim()) {
      ctx.notify("Choose a project and describe your work first.");
      return;
    }
    if (!started) {
      const now = Date.now();
      setStarted(now);
      localStorage.setItem(
        key,
        JSON.stringify({
          taskId,
          started: now,
          project,
          description,
          billable,
          costRate,
          billRate,
        }),
      );
      return;
    }
    setSaving(true);
    const ok = await ctx.mutate("time_entries", {
      task_id: taskId || null,
      project_id: project,
      description,
      minutes: Math.max(1, Math.ceil((Date.now() - started) / 60000)),
      billable,
      cost_rate: costRate,
      bill_rate: billRate,
    });
    if (ok) {
      setStarted(null);
      setSeconds(0);
      localStorage.removeItem(key);
      ctx.notify("Time saved and budget updated.");
    }
    setSaving(false);
  }
  const entries = ctx.data.time_entries,
    hours = entries.reduce((s, e) => s + e.minutes / 60, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GIVE YOUR TIME A LITTLE CREDIT</div>
          <h1>
            Time well spent<span className="coral-text">.</span>
          </h1>
          <p>
            Track the work. Understand the effort. Make room for what matters.
          </p>
        </div>
        <button className="button primary" onClick={() => setManual(true)}>
          <Plus size={16} />
          Log time
        </button>
      </div>
      <div className="timer-card">
        <div>
          <span className="eyebrow">
            {started ? "IN YOUR FLOW" : "READY WHEN YOU ARE"}
          </span>
          <div className="timer-digits">
            {String(Math.floor(seconds / 3600)).padStart(2, "0")}
            <span>:</span>
            {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}
            <span>:</span>
            {String(seconds % 60).padStart(2, "0")}
          </div>
        </div>
        <div className="timer-fields">
          <label className="sr-only" htmlFor="timer-description">
            What are you working on?
          </label>
          <input
            id="timer-description"
            placeholder="What are you working on?"
            value={description}
            disabled={!!started}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            aria-label="Timer project"
            value={project}
            disabled={!!started}
            onChange={(e) => {
              setProject(e.target.value);
              setTaskId("");
            }}
          >
            <option value="">Choose a project</option>
            {ctx.data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Timer task"
            value={taskId}
            disabled={!!started}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">Project time (no task)</option>
            {ctx.data.tasks
              .filter((t) => t.project_id === project)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </Select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={billable}
              disabled={!!started}
              onChange={(e) => setBillable(e.target.checked)}
            />
            Billable
          </label>
          <label className="field">
            <span>Cost rate ($/h)</span>
            <input
              type="number"
              min="0"
              value={costRate}
              disabled={!!started}
              onChange={(e) => setCostRate(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span>Bill rate ($/h)</span>
            <input
              type="number"
              min="0"
              value={billRate}
              disabled={!!started}
              onChange={(e) => setBillRate(Math.max(0, Number(e.target.value)))}
            />
          </label>
        </div>
        <button className="button dark" disabled={saving} onClick={toggle}>
          {started ? <Square size={15} /> : <Play size={15} />}{" "}
          {started ? "Stop and save" : "Start timer"}
        </button>
      </div>
      <div className="three-stats">
        <Stat
          label="Hours tracked"
          value={`${hours.toFixed(1)}h`}
          note="Across your workspace"
        />
        <Stat
          label="Billable value"
          value={money(
            entries
              .filter((e) => e.billable)
              .reduce((s, e) => s + (e.minutes / 60) * e.bill_rate, 0),
          )}
          note="Based on recorded bill rates"
        />
        <Stat
          label="Awaiting approval"
          value={String(entries.filter((e) => e.status === "Submitted").length)}
          note="Time entries to review"
        />
      </div>
      <Panel
        title="The work behind the work"
        subtitle="Your workspace timesheet."
      >
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable records"
        >
          <table>
            <thead>
              <tr>
                <th>Work</th>
                <th>Project</th>
                <th>Date</th>
                <th>Time</th>
                <th>Billable</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries
                .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.description}</strong>
                    </td>
                    <td>
                      {
                        ctx.data.projects.find((p) => p.id === e.project_id)
                          ?.name
                      }
                    </td>
                    <td>{dateLabel(e.entry_date)}</td>
                    <td>{(e.minutes / 60).toFixed(1)}h</td>
                    <td>{e.billable ? "Yes" : "No"}</td>
                    <td>
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    </td>
                    <td>
                      {(ctx.workspace.role === "owner" ||
                        (e.created_by === ctx.userId &&
                          e.status === "Submitted")) && (
                        <button
                          className="button small"
                          onClick={() => {
                            setEditing(e);
                            setManual(true);
                          }}
                        >
                          Edit<span className="sr-only"> {e.description}</span>
                        </button>
                      )}
                      {ctx.workspace.role === "owner" && (
                        <DeleteAction
                          ctx={ctx}
                          table="time_entries"
                          id={e.id}
                          label={e.description}
                          buttonLabel={
                            e.status === "Submitted" ? "Deny" : "Delete"
                          }
                          description="This permanently deletes the time entry and recalculates tracked hours and retainer usage. Existing invoices are not changed."
                        />
                      )}
                      {e.status === "Submitted" &&
                        ctx.workspace.role === "owner" && (
                          <button
                            className="button small"
                            onClick={() =>
                              ctx.mutate(
                                "time_entries",
                                { status: "Approved" },
                                e.id,
                              )
                            }
                          >
                            <Check size={14} />
                            Approve
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!entries.length && (
          <Empty title="Good work takes time. Start tracking yours." />
        )}
      </Panel>
      <Modal
        open={manual}
        onClose={() => {
          setManual(false);
          setEditing(null);
        }}
        title={editing ? "Edit time entry" : "Give that work some credit"}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await ctx.mutate(
                "time_entries",
                {
                  description: f.get("description"),
                  project_id: f.get("project"),
                  entry_date: f.get("date"),
                  minutes: Math.round(Number(f.get("hours")) * 60),
                  billable: f.get("billable") === "on",
                  task_id: f.get("task_id") || null,
                  billing_treatment: f.get("billing_treatment") || "review",
                  cost_rate: Number(f.get("cost")),
                  bill_rate: Number(f.get("rate")),
                },
                editing?.id,
              )
            ) {
              setManual(false);
              setEditing(null);
              ctx.notify("Time entry saved");
            }
          }}
        >
          <Field label="Description">
            <input
              name="description"
              required
              defaultValue={editing?.description}
            />
          </Field>
          <Field label="Project">
            <Select
              name="project"
              value={entryProject}
              onChange={(e) => setEntryProject(e.target.value)}
            >
              {ctx.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="form-grid">
            <Field label="Date">
              <input
                type="date"
                name="date"
                required
                defaultValue={
                  editing?.entry_date || new Date().toISOString().slice(0, 10)
                }
              />
            </Field>
            <Field label="Hours">
              <input
                name="hours"
                defaultValue={
                  editing
                    ? Number((editing.minutes / 60).toFixed(2))
                    : undefined
                }
                type="number"
                min="0.02"
                max="24"
                step="0.01"
                required
              />
            </Field>
            <Field label="Task">
              <Select
                aria-label="Time entry task"
                key={entryProject + String(editing?.id)}
                name="task_id"
                defaultValue={
                  editing?.project_id === entryProject
                    ? editing?.task_id || ""
                    : ""
                }
              >
                <option value="">Project time (no task)</option>
                {ctx.data.tasks
                  .filter((t) => t.project_id === entryProject)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Billing coverage">
              <Select
                aria-label="Billing coverage"
                name="billing_treatment"
                defaultValue={editing?.billing_treatment || "review"}
              >
                <option value="review">Needs billing review</option>
                <option value="invoice">Invoice separately</option>
                <option value="covered">
                  Covered by retainer, deposit or fixed fee
                </option>
              </Select>
            </Field>
            <Field label="Cost rate ($/hour)">
              <input
                name="cost"
                type="number"
                min="0"
                defaultValue={editing?.cost_rate ?? 65}
                required
              />
            </Field>
            <Field label="Bill rate ($/hour)">
              <input
                name="rate"
                type="number"
                min="0"
                defaultValue={editing?.bill_rate ?? 150}
                required
              />
            </Field>
          </div>
          <label className="checkbox-label">
            <input
              name="billable"
              type="checkbox"
              defaultChecked={editing?.billable ?? true}
            />
            Billable time
          </label>
          <div className="modal-actions">
            <button className="button primary">Save time</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export function FinanceView({ ctx }: { ctx: StudioContext }) {
  const [tab, setTab] = useLocationTab("finance", "Billing records", [
      "Billing records",
      "Billing profiles",
      "Billing automation",
      "Invoices",
      "Estimates",
      "Retainers",
      "Budgets",
      "Studio expenses",
    ]),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState("");
  const table = tab === "Estimates" ? "estimates" : "invoices",
    rows = ctx.data[table];
  const issued = ctx.data.invoices.filter(
    (f) => !["Draft", "Cancelled", "Void"].includes(f.status),
  );
  const collected = (f: Financial) => {
    const receipts = ctx.data.invoice_receipts.filter(
      (r) => r.invoice_id === f.id,
    );
    return receipts.length
      ? receipts.reduce((sum, r) => sum + Number(r.amount), 0)
      : f.status === "Paid"
        ? total(f)
        : 0;
  };
  const canEdit = ctx.workspace.role === "owner";
  async function pdf(f: Financial) {
    setBusy(f.id);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch(
        `/api/pdf?kind=${table}&id=${f.id}&workspace=${ctx.workspace.id}`,
        { headers: { Authorization: `Bearer ${data.session?.access_token}` } },
      );
      if (!r.ok) throw Error("Could not generate the PDF");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${f.number}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      ctx.notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {ctx.workspace.role === "owner" && tab === "Invoices" && (
        <WorkInvoice ctx={ctx} />
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">GOOD WORK, FAIRLY VALUED</div>
          <h1>
            The business of making things<span className="coral-text">.</span>
          </h1>
          <p>
            A clear view of your estimates, invoices, and ongoing partnerships.
          </p>
        </div>
        {canEdit &&
          ![
            "Studio expenses",
            "Billing records",
            "Billing profiles",
            "Billing automation",
          ].includes(tab) && (
            <button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={16} />
              New{" "}
              {tab === "Budgets"
                ? "budget"
                : tab === "Estimates"
                  ? "estimate"
                  : tab === "Retainers"
                    ? "retainer"
                    : "invoice"}
            </button>
          )}
      </div>
      {![
        "Studio expenses",
        "Billing records",
        "Billing profiles",
        "Billing automation",
      ].includes(tab) && (
        <div className="three-stats">
          <Stat
            label="Legacy invoices"
            value={money(issued.reduce((s, f) => s + total(f), 0))}
            note="Issued invoices, excluding drafts"
          />
          <Stat
            label="Collected"
            value={money(issued.reduce((s, f) => s + collected(f), 0))}
            note="Legacy ledger only. See Billing records for reconciled totals."
          />
          <Stat
            label="Outstanding"
            value={money(
              issued.reduce(
                (s, f) => s + Math.max(0, total(f) - collected(f)),
                0,
              ),
            )}
            note="A little follow-up goes a long way"
            tone="highlight"
          />
        </div>
      )}
      <div className="detail-tabs">
        {[
          "Billing records",
          "Billing profiles",
          "Billing automation",
          "Invoices",
          "Estimates",
          "Retainers",
          "Budgets",
          "Studio expenses",
        ].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => {
              setTab(t);
              setCreate(false);
            }}
            aria-pressed={tab === t}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Billing records" || tab === "Billing profiles" ? (
        <BillingHub ctx={ctx} profilesOnly={tab === "Billing profiles"} />
      ) : tab === "Studio expenses" ? (
        <StudioExpenses ctx={ctx} />
      ) : tab === "Billing automation" ? (
        <BillingAutomation ctx={ctx} />
      ) : tab === "Budgets" ? (
        <Budgets ctx={ctx} create={create} onClose={() => setCreate(false)} />
      ) : tab === "Retainers" ? (
        <div className="projects-grid">
          {ctx.data.retainers.map((r) => (
            <Panel
              key={r.id}
              title={
                ctx.data.projects.find((p) => p.id === r.project_id)?.name ||
                "Retainer"
              }
              subtitle={dateLabel(r.period)}
            >
              <div className="budget-content">
                <strong>
                  {r.hours + r.rollover - r.used}h <small>remaining</small>
                </strong>
                <Progress
                  value={
                    r.hours + r.rollover
                      ? (r.used / (r.hours + r.rollover)) * 100
                      : 0
                  }
                />
                <p>
                  {r.hours} hours + {r.rollover} carried forward
                </p>
                <p>{r.used} hours used this period</p>
                {canEdit && (
                  <DeleteAction
                    ctx={ctx}
                    table="retainers"
                    id={r.id}
                    label={`retainer for ${dateLabel(r.period)}`}
                    description="Delete this retainer period. Time entries and other periods remain unchanged."
                  />
                )}
                {canEdit && (
                  <button
                    className="button"
                    onClick={async () => {
                      const d = new Date(r.period + "T12:00:00");
                      d.setMonth(d.getMonth() + 1);
                      d.setDate(1);
                      if (
                        await ctx.mutate("retainers", {
                          project_id: r.project_id,
                          period: d.toISOString().slice(0, 10),
                          hours: r.hours,
                          rollover: Math.max(0, r.hours + r.rollover - r.used),
                          used: 0,
                        })
                      )
                        ctx.notify("Next period created with unused hours");
                    }}
                  >
                    Roll into next month
                    <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel title={tab} subtitle="Clear records. Less chasing.">
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable records"
          >
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Client</th>
                  <th>Due date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.number}</strong>
                    </td>
                    <td>{f.client_name}</td>
                    <td>{dateLabel(f.due_date)}</td>
                    <td>{money(total(f))}</td>
                    <td>
                      <Badge tone={statusTone(f.status)}>{f.status}</Badge>
                    </td>
                    <td>
                      <div className="toolbar-right">
                        <button
                          className="button small"
                          disabled={busy === f.id}
                          onClick={() => pdf(f)}
                        >
                          <Download size={14} />
                          PDF
                        </button>
                        {canEdit && (
                          <DeleteAction
                            ctx={ctx}
                            table={table}
                            id={f.id}
                            label={f.number}
                            description="Permanently delete this financial record. This does not cancel a payment, refund a charge, or remove an externally downloaded PDF."
                          />
                        )}
                        {canEdit &&
                          table === "invoices" &&
                          f.status === "Draft" && (
                            <button
                              className="button small"
                              onClick={() =>
                                ctx.mutate("invoices", { status: "Sent" }, f.id)
                              }
                            >
                              Mark issued
                            </button>
                          )}
                        {canEdit &&
                          table === "invoices" &&
                          f.status !== "Paid" && (
                            <>
                              <button
                                className="button small"
                                onClick={() =>
                                  (async () => {
                                    const paid = ctx.data.invoice_receipts
                                      .filter((r) => r.invoice_id === f.id)
                                      .reduce(
                                        (sum, r) => sum + Number(r.amount),
                                        0,
                                      );
                                    if (f.status === "Draft") {
                                      ctx.notify(
                                        "Mark this invoice issued before recording payment.",
                                      );
                                      return;
                                    }
                                    const { error } = await supabase.rpc(
                                      "record_invoice_receipt",
                                      {
                                        invoice: f.id,
                                        amount:
                                          Math.round((total(f) - paid) * 100) /
                                          100,
                                        received_on: new Date()
                                          .toISOString()
                                          .slice(0, 10),
                                        reference:
                                          "Balance recorded from Financials",
                                      },
                                    );
                                    if (error) ctx.notify(error.message);
                                    else await ctx.refresh();
                                  })()
                                }
                              >
                                Record balance paid
                              </button>
                              <button
                                className="button small"
                                onClick={async () => {
                                  const { data } =
                                    await supabase.auth.getSession();
                                  const response = await fetch(
                                    "/api/payments",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${data.session?.access_token}`,
                                      },
                                      body: JSON.stringify({
                                        id: f.id,
                                        workspace: ctx.workspace.id,
                                      }),
                                    },
                                  );
                                  const result = await response.json();
                                  if (result.url) {
                                    await navigator.clipboard.writeText(
                                      result.url,
                                    );
                                    ctx.notify("Payment link copied");
                                  } else
                                    ctx.notify(
                                      result.instructions || result.error,
                                    );
                                }}
                              >
                                Payment link
                              </button>
                            </>
                          )}
                        {canEdit && table === "estimates" && (
                          <button
                            className="button small"
                            onClick={async () => {
                              if (
                                await ctx.mutate("invoices", {
                                  project_id: f.project_id,
                                  number: `INV-${Date.now().toString().slice(-6)}`,
                                  client_name: f.client_name,
                                  lines: f.lines,
                                  due_date: f.due_date,
                                  notes: f.notes,
                                  status: "Draft",
                                })
                              )
                                ctx.notify("Invoice created from estimate");
                            }}
                          >
                            Create invoice
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <Empty title={`Your ${tab.toLowerCase()} will live here`} />
          )}
        </Panel>
      )}
      <Modal
        open={create && tab !== "Budgets" && tab !== "Studio expenses"}
        onClose={() => setCreate(false)}
        title={`New ${tab === "Retainers" ? "retainer" : table === "estimates" ? "estimate" : "invoice"}`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              p = ctx.data.projects.find((p) => p.id === f.get("project"));
            if (tab === "Retainers") {
              if (
                await ctx.mutate("retainers", {
                  project_id: p?.id,
                  period: f.get("date"),
                  hours: Number(f.get("hours")),
                  rollover: 0,
                  used: 0,
                })
              )
                setCreate(false);
            } else if (
              await ctx.mutate(table, {
                project_id: p?.id,
                client_name: p?.client_name,
                number: f.get("number"),
                due_date: f.get("date"),
                notes: f.get("notes"),
                lines: [
                  {
                    description: f.get("description"),
                    quantity: Number(f.get("quantity")),
                    rate: Number(f.get("rate")),
                  },
                ],
              })
            )
              setCreate(false);
          }}
        >
          <Field label="Project">
            <Select name="project" required>
              {ctx.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tab === "Retainers" ? "Period starts" : "Due date"}>
            <input type="date" name="date" required />
          </Field>
          {tab === "Retainers" ? (
            <Field label="Included hours">
              <input name="hours" type="number" min="1" required />
            </Field>
          ) : (
            <>
              <Field label="Reference">
                <input
                  name="number"
                  required
                  defaultValue={`${table === "estimates" ? "EST" : "INV"}-${Date.now().toString().slice(-6)}`}
                />
              </Field>
              <Field label="Line item description">
                <input name="description" required />
              </Field>
              <div className="form-grid">
                <Field label="Quantity">
                  <input
                    name="quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue="1"
                    required
                  />
                </Field>
                <Field label="Unit price ($)">
                  <input
                    name="rate"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea name="notes" rows={3} />
              </Field>
            </>
          )}
          <div className="modal-actions">
            <button className="button primary">
              Save {tab === "Retainers" ? "retainer" : "document"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export { PortalView } from "./client-portal";
export function SettingsView({
  ctx,
  onWorkspaceRefresh,
}: {
  ctx: StudioContext;
  onWorkspaceRefresh: () => Promise<void>;
}) {
  const owner = ctx.workspace.role === "owner";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>A workspace that works for you.</h1>
          <p>A few details that keep everyone moving together.</p>
        </div>
      </div>
      <div className="settings-grid">
        <Panel title="Protect your account">
          <TwoFactor />
        </Panel>
        <Panel title="Workspace details">
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                states = String(f.get("states"))
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
              if (
                new Set(states).size !== states.length ||
                !states.includes("Done") ||
                states.length < 2
              ) {
                ctx.notify(
                  "Use unique states and keep Done as the completion state.",
                );
                return;
              }
              const { error } = await supabase
                .from("workspaces")
                .update({ name: f.get("name"), workflow_states: states })
                .eq("id", ctx.workspace.id);
              if (error) ctx.notify(error.message);
              else {
                await onWorkspaceRefresh();
                ctx.notify("Workspace updated");
              }
            }}
          >
            <Field label="Workspace name">
              <input
                name="name"
                defaultValue={ctx.workspace.name}
                required
                disabled={!owner}
              />
            </Field>
            <Field label="Workflow states, separated by commas">
              <input
                name="states"
                defaultValue={ctx.workspace.workflow_states.join(", ")}
                required
                disabled={!owner}
              />
            </Field>
            {owner && (
              <button className="button primary">Save workspace</button>
            )}
          </form>
        </Panel>
        <Panel
          title="The people behind the work"
          subtitle="Workspace membership controls access."
        >
          <AccountMembers ctx={ctx} onRefresh={onWorkspaceRefresh} />
        </Panel>
        <Panel title="Reusable task template">
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (
                await ctx.mutate("templates", {
                  name: f.get("name"),
                  tasks: String(f.get("tasks"))
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              ) {
                form.reset();
                ctx.notify("Template saved");
              }
            }}
          >
            <Field label="Template name">
              <input name="name" required disabled={!owner} />
            </Field>
            <Field label="Tasks, one per line">
              <textarea name="tasks" rows={4} required disabled={!owner} />
            </Field>
            {owner && <button className="button">Save template</button>}
          </form>
        </Panel>
        <AddWorkspaceMember ctx={ctx} onRefresh={onWorkspaceRefresh} />
        <DeleteWorkspace ctx={ctx} onDeleted={onWorkspaceRefresh} />
        <Panel title="Your workspace, your data">
          <div className="settings-form">
            <p>
              Guests see only explicitly shared content in projects they have
              been invited to.
            </p>
            <p>
              Payments are recorded manually by default. Project summaries use
              the local AI connection when available.
            </p>
            <Badge tone="green">Local first</Badge>
          </div>
        </Panel>
      </div>
    </>
  );
}
