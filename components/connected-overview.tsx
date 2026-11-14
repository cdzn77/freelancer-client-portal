"use client";
import { useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import { Panel, Field } from "./ui";
import { Select } from "./select";
import { money } from "@/lib/types";
import { billingIssued, type BillingGroup } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
export function ConnectedOverview({ ctx }: { ctx: StudioContext }) {
  const [billing, setBilling] = useState<BillingGroup[]>([]);
  useEffect(() => {
    void supabase
      .rpc("billing_workspace", { w: ctx.workspace.id })
      .then((r) => {
        if (r.error) setError(r.error.message);
        else setBilling(r.data.groups);
      });
  }, [ctx.workspace.id, ctx.data.invoices, ctx.data.invoice_receipts]);
  const [client, setClient] = useState(""),
    [group, setGroup] = useState(""),
    [archived, setArchived] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const ids = ctx.data.project_groups.find((g) => g.id === group)?.project_ids;
  const projects = ctx.data.projects.filter(
    (p) =>
      !p.deleted_at &&
      (archived || !p.archived_at) &&
      (!client || p.client_account_id === client) &&
      (!ids || ids.includes(p.id)),
  );
  const inPeriod = (d: string | null | undefined) =>
    (!from && !to) || (!!d && (!from || d >= from) && (!to || d <= to));
  const billed = new Set(
    ctx.data.invoice_sources
      .filter((s) => !s.released)
      .map((s) => s.time_entry_id),
  );
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <Panel
      title="Connected project overview"
      className="connected-overview"
      subtitle="USD. Reconciled commitments use their source due dates. Net receipts use payment dates with current refund adjustments. Work and expenses use their recorded dates."
    >
      <div className="form-grid">
        <Field label="Client">
          <Select
            aria-label="Client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
          >
            <option value="">All clients</option>
            {ctx.data.client_accounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Saved project group">
          <Select
            aria-label="Saved project group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">All projects</option>
            {ctx.data.project_groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period from">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Period through">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <label>
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Include archived projects
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Delivery now</th>
              <th>Approved unbilled</th>
              <th>Commitments / net receipts</th>
              <th>Collected margin</th>
              <th>Allocated</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const tasks = ctx.data.tasks.filter((t) => t.project_id === p.id),
                entries = ctx.data.time_entries.filter(
                  (e) => e.project_id === p.id && inPeriod(e.entry_date),
                );
              const records = billing.filter((g) => g.project_id === p.id);
              const cash = records
                  .flatMap((g) => g.payments)
                  .filter((p) => inPeriod(p.date))
                  .reduce((n, p) => n + p.net_cents / 100, 0),
                cost =
                  entries
                    .filter((e) => e.status !== "Rejected")
                    .reduce((n, e) => n + (e.minutes / 60) * e.cost_rate, 0) +
                  ctx.data.project_expenses
                    .filter(
                      (e) => e.project_id === p.id && inPeriod(e.expense_date),
                    )
                    .reduce((n, e) => n + Number(e.amount), 0);
              const unbilled = entries.filter(
                (e) =>
                  e.status === "Approved" &&
                  e.billable &&
                  e.billing_treatment === "invoice" &&
                  !billed.has(e.id),
              );
              const reviews =
                ctx.data.approvals.filter(
                  (a) => a.project_id === p.id && a.status === "Pending",
                ).length +
                ctx.data.deliverables.filter(
                  (d) =>
                    d.project_id === p.id &&
                    !d.archived_at &&
                    !d.deleted_at &&
                    ctx.data.deliverable_versions.some(
                      (v) =>
                        v.id === d.current_version_id && v.status === "Pending",
                    ),
                ).length;
              return (
                <tr key={p.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => ctx.selectProject(p.id)}
                    >
                      {p.name}
                    </button>
                    <small>{p.client_name}</small>
                  </td>
                  <td>
                    {
                      tasks.filter(
                        (t) =>
                          t.status !== "Done" &&
                          t.due_date &&
                          t.due_date < today,
                      ).length
                    }{" "}
                    overdue · {reviews} reviews
                  </td>
                  <td>
                    <details>
                      <summary>
                        {money(
                          unbilled.reduce(
                            (n, e) => n + (e.minutes / 60) * e.bill_rate,
                            0,
                          ),
                        )}
                      </summary>
                      {unbilled.map((e) => (
                        <p key={e.id}>
                          {e.entry_date} · {e.description} ·{" "}
                          {money((e.minutes / 60) * e.bill_rate)}
                        </p>
                      ))}
                    </details>
                  </td>
                  <td>
                    {money(
                      records
                        .filter(billingIssued)
                        .filter((g) =>
                          inPeriod(
                            g.sources.find((s) => s.primary)?.due_date ||
                              g.sources.find(
                                (s) =>
                                  s.kind === "invoice" || s.type === "Invoice",
                              )?.due_date,
                          ),
                        )
                        .reduce((n, g) => n + g.total_cents / 100, 0),
                    )}{" "}
                    / {money(cash)}
                  </td>
                  <td>{money(cash - cost)}</td>
                  <td>
                    {ctx.data.task_allocations
                      .filter(
                        (a) => a.project_id === p.id && inPeriod(a.work_date),
                      )
                      .reduce((n, a) => n + a.minutes, 0) / 60}
                    h
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        Delivery counts are current, not historical. Collected margin excludes
        overhead and taxes. Legacy Paid statuses without receipt evidence are
        excluded. Matched transactions count once. Refunds adjust their original
        payment date; this is not a dated refund cash-flow statement. The older
        report below remains labeled as legacy invoice reporting.
      </p>
      <details>
        <summary>Save a project group</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const r = await supabase.from("project_groups").insert({
              workspace_id: ctx.workspace.id,
              name,
              project_ids: selected,
              created_by: ctx.userId,
            });
            if (r.error) setError(r.error.message);
            else {
              setName("");
              setSelected([]);
              await ctx.refresh();
            }
          }}
        >
          <Field label="Group name">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {ctx.data.projects
            .filter((p) => !p.deleted_at)
            .map((p) => (
              <label className="workflow-row" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, p.id]
                        : selected.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          <button className="button" disabled={!selected.length}>
            Save group
          </button>
        </form>
        {group && (
          <button
            className="button"
            onClick={async () => {
              const r = await supabase
                .from("project_groups")
                .delete()
                .eq("id", group);
              if (r.error) setError(r.error.message);
              else {
                setGroup("");
                await ctx.refresh();
              }
            }}
          >
            Remove selected group
          </button>
        )}
      </details>
      <details>
        <summary>Correct a project's client identity</summary>
        <p>
          Select an existing client to unite spelling variants. Historic invoice
          names stay unchanged.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await ctx.mutate(
              "projects",
              { client_account_id: f.get("client") },
              String(f.get("project")),
            );
          }}
        >
          <Field label="Project to link">
            <Select aria-label="Project to link" name="project" required>
              {ctx.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Canonical client">
            <Select aria-label="Canonical client" name="client" required>
              {ctx.data.client_accounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <button className="button">Link client</button>
        </form>
      </details>
      {error && <p role="alert">{error}</p>}
    </Panel>
  );
}
