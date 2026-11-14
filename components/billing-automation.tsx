"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { StudioContext } from "./studio";
import { Field, Panel } from "./ui";
import { money } from "@/lib/client-documents";
import { localDate } from "@/lib/work-planning";
type Invoice = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  total_cents: number;
  client_id: string | null;
  project_id: string | null;
};
type Schedule = {
  id: string;
  template: { title: string; total_cents: number };
  cadence: string;
  timezone: string;
  next_on: string;
  ends_on: string | null;
  status: string;
  last_error: string | null;
};
type Occurrence = {
  schedule_id: string;
  occurrence: string;
  document_id: string | null;
  status: string;
  note: string | null;
};
type Reminder = {
  group_id: string;
  document_id: string;
  timezone: string;
  first_days: number;
  repeat_days: number;
  max_reminders: number;
  enabled: boolean;
  email_enabled: boolean;
};
type Run = {
  id: string;
  group_id: string;
  reminder_on: string;
  balance_cents: number;
  notification_id: string | null;
};
type Delivery = {
  notification_id: string;
  status: string;
  last_error: string | null;
  sent_at: string | null;
};
export function BillingAutomation({ ctx }: { ctx: StudioContext }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]),
    [schedules, setSchedules] = useState<Schedule[]>([]),
    [occurrences, setOccurrences] = useState<Occurrence[]>([]),
    [rules, setRules] = useState<Reminder[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [deliveries, setDeliveries] = useState<Delivery[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  async function load() {
    const w = ctx.workspace.id;
    const results = await Promise.all([
      supabase
        .from("client_documents")
        .select("id,title,status,due_date,total_cents,client_id,project_id")
        .eq("workspace_id", w)
        .eq("kind", "Invoice")
        .order("created_at", { ascending: false }),
      supabase
        .from("billing_schedules")
        .select("*")
        .eq("workspace_id", w)
        .order("created_at", { ascending: false }),
      supabase
        .from("billing_occurrences")
        .select("*")
        .eq("workspace_id", w)
        .order("occurrence", { ascending: false }),
      supabase.from("billing_reminder_rules").select("*").eq("workspace_id", w),
      supabase
        .from("billing_reminder_runs")
        .select("*")
        .eq("workspace_id", w)
        .order("created_at", { ascending: false }),
      supabase
        .from("studio_email_jobs")
        .select("notification_id,status,last_error,sent_at")
        .eq("workspace_id", w),
    ]);
    const failure = results.find((r) => r.error);
    if (failure) {
      setError(failure.error!.message);
      return;
    }
    setInvoices(results[0].data as Invoice[]);
    setSchedules(results[1].data as Schedule[]);
    setOccurrences(results[2].data as Occurrence[]);
    setRules(results[3].data as Reminder[]);
    setRuns(results[4].data as Run[]);
    setDeliveries(results[5].data as Delivery[]);
  }
  useEffect(() => {
    void load();
  }, [ctx.workspace.id]);
  async function act(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await supabase.rpc(fn, args);
      if (r.error) throw r.error;
      await load();
      setMessage(
        fn === "process_workspace_billing"
          ? `${r.data.drafts} draft(s) created; ${r.data.reminders} in-app reminder(s) queued.`
          : "Billing settings saved",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const link = (id: string) =>
    `/?workspace=${ctx.workspace.id}&page=Documents%20%26%20payments&clientDocument=${id}`;
  return (
    <section aria-label="Billing automation">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Panel
        title="Recurring invoice drafts"
        subtitle="Schedules create private drafts for review. They never share an invoice, charge a payment method or change your agreement terms."
      >
        <details>
          <summary>Create recurring invoice schedule</summary>
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (
                await act("create_billing_schedule", {
                  doc: f.get("doc"),
                  cadence: f.get("cadence"),
                  timezone: f.get("timezone"),
                  starts_on: f.get("starts_on"),
                  ends_on: f.get("ends_on") || null,
                  due_days: Number(f.get("due_days")),
                  coverage_confirmed: f.get("coverage") === "on",
                })
              )
                form.reset();
            }}
          >
            <Field label="Invoice template">
              <select name="doc" required defaultValue="">
                <option value="">Choose a priced project invoice</option>
                {invoices
                  .filter(
                    (d) =>
                      ["Draft", "Approved"].includes(d.status) &&
                      d.client_id &&
                      d.project_id &&
                      d.total_cents > 0,
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · {money(d.total_cents)} · {d.status}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Invoice cadence">
                <select name="cadence" defaultValue="monthly">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </Field>
              <Field label="Invoice timezone">
                <input
                  name="timezone"
                  defaultValue={timezone}
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="First invoice date">
                <input
                  name="starts_on"
                  type="date"
                  defaultValue={localDate()}
                  required
                />
              </Field>
              <Field label="Last invoice date (optional)">
                <input name="ends_on" type="date" />
              </Field>
              <Field label="Days until payment due">
                <input
                  name="due_days"
                  type="number"
                  min="0"
                  max="90"
                  defaultValue="14"
                  required
                />
              </Field>
            </div>
            <p>
              Monthly schedules keep the original day: January 31 becomes
              February 28, then March 31. Pauses and outages skip missed cycles
              and record them for manual review. Resume does not back-bill.
            </p>
            <p>
              The template is copied when the schedule is created. Cancel and
              recreate the schedule to change its price or terms. Review each
              generated draft, including its copied scope and proposed service
              dates, before sharing.
            </p>
            <label>
              <input type="checkbox" name="coverage" required /> I checked the
              original invoice, deposits and retainer coverage to avoid
              duplicate billing.
            </label>
            <button className="button primary" disabled={busy}>
              Create invoice schedule
            </button>
          </form>
        </details>
        {schedules.length === 0 && <p>No recurring invoice schedules.</p>}
        {schedules.map((s) => (
          <article key={s.id} className="operation-section">
            <h3>{s.template.title}</h3>
            <p>
              {money(s.template.total_cents)} · {s.cadence} · {s.timezone} ·{" "}
              {s.status}
            </p>
            <p>
              Next cycle: {s.next_on}
              {s.ends_on ? ` · Last cycle on or before ${s.ends_on}` : ""}
            </p>
            {s.last_error && <p className="error">{s.last_error}</p>}
            <div className="toolbar-right">
              {["Active", "Paused"].includes(s.status) && (
                <>
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() =>
                      act("set_billing_schedule_state", {
                        schedule: s.id,
                        new_status: s.status === "Active" ? "Paused" : "Active",
                      })
                    }
                  >
                    {s.status === "Active" ? "Pause" : "Resume"}{" "}
                    {s.template.title}
                  </button>
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() =>
                      act("set_billing_schedule_state", {
                        schedule: s.id,
                        new_status: "Cancelled",
                      })
                    }
                  >
                    Cancel {s.template.title}
                  </button>
                </>
              )}
            </div>
            <details>
              <summary>Occurrence history</summary>
              {occurrences
                .filter((o) => o.schedule_id === s.id)
                .map((o) => (
                  <p key={o.occurrence}>
                    {o.occurrence} · {o.status}{" "}
                    {o.document_id && (
                      <a href={link(o.document_id)}>Open invoice draft</a>
                    )}
                    {o.note && ` · ${o.note}`}
                  </p>
                ))}
            </details>
          </article>
        ))}
      </Panel>
      <Panel
        title="Overdue invoice follow-up"
        subtitle="Enable reminders for a specific approved invoice. Each check uses its reconciled balance, including verified receipts and refunds."
      >
        <details>
          <summary>Configure invoice reminders</summary>
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act("save_billing_reminders", {
                doc: f.get("doc"),
                timezone: f.get("timezone"),
                first_days: Number(f.get("first_days")),
                repeat_days: Number(f.get("repeat_days")),
                max_reminders: Number(f.get("max_reminders")),
                enabled: f.get("enabled") === "on",
                email_enabled: f.get("email_enabled") === "on",
              });
            }}
          >
            <Field label="Overdue invoice">
              <select
                aria-label="Overdue invoice"
                name="doc"
                required
                defaultValue=""
              >
                <option value="">
                  Choose an approved invoice with a due date
                </option>
                {invoices
                  .filter(
                    (d) =>
                      d.status === "Approved" &&
                      d.due_date &&
                      d.client_id &&
                      d.project_id,
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · Due {d.due_date}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Reminder timezone">
                <input
                  name="timezone"
                  defaultValue={timezone}
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="Days overdue before first reminder">
                <input
                  name="first_days"
                  type="number"
                  min="1"
                  max="90"
                  defaultValue="3"
                  required
                />
              </Field>
              <Field label="Days between reminders">
                <input
                  name="repeat_days"
                  type="number"
                  min="1"
                  max="90"
                  defaultValue="7"
                  required
                />
              </Field>
              <Field label="Maximum reminders">
                <input
                  name="max_reminders"
                  type="number"
                  min="1"
                  max="12"
                  defaultValue="3"
                  required
                />
              </Field>
            </div>
            <label>
              <input type="checkbox" name="enabled" /> Enable in-app payment
              reminders for this invoice
            </label>
            <label>
              <input type="checkbox" name="email_enabled" /> Also send email
              reminders when the recipient has opted into email notifications
            </label>
            <p>
              Reminders run after 9 AM in the selected timezone. Email also
              requires the connected sender and enabled email worker. Paid
              balances, unverified legacy payments, lost project access and
              disabled rules prevent delivery. Turning reminders off also stops
              queued reminder email.
            </p>
            <button className="button primary" disabled={busy}>
              Save invoice reminders
            </button>
          </form>
        </details>
        {rules.map((r) => (
          <article key={r.group_id} className="operation-section">
            <h3>
              {invoices.find((d) => d.id === r.document_id)?.title ||
                "Invoice reminder"}
            </h3>
            <p>
              {r.enabled ? "Enabled" : "Disabled"} · Email{" "}
              {r.email_enabled ? "enabled (recipient opt-in required)" : "off"}{" "}
              · First after {r.first_days} day(s), then every {r.repeat_days}{" "}
              day(s), maximum {r.max_reminders} · {r.timezone}
            </p>
            <a href={link(r.document_id)}>Open invoice</a>
            {r.enabled && (
              <button
                className="button small"
                disabled={busy}
                onClick={() =>
                  act("disable_billing_reminders", { g: r.group_id })
                }
              >
                Turn off reminders
              </button>
            )}
            <details>
              <summary>Reminder and email history</summary>
              {runs
                .filter((x) => x.group_id === r.group_id)
                .map((x) => {
                  const email = deliveries.find(
                    (d) => d.notification_id === x.notification_id,
                  );
                  return (
                    <p key={x.id}>
                      {x.reminder_on} · Balance at check:{" "}
                      {money(x.balance_cents)} · Email:{" "}
                      {email?.status || "Not queued"}
                      {email?.last_error && ` · ${email.last_error}`}
                    </p>
                  );
                })}
            </details>
          </article>
        ))}
      </Panel>
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          act("process_workspace_billing", { w: ctx.workspace.id })
        }
      >
        Run due billing checks
      </button>
      <p>
        Scheduled checks also run hourly. This action processes only cycles and
        reminders due now.
      </p>
    </section>
  );
}
