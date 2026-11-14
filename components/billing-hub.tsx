"use client";
import { useCallback, useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import { Panel, Field, Stat } from "./ui";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/client-documents";
import {
  billingIssued,
  type BillingGroup,
  type BillingProfile,
} from "@/lib/billing";
export function BillingHub({
  ctx,
  profilesOnly = false,
}: {
  ctx: StudioContext;
  profilesOnly?: boolean;
}) {
  const [groups, setGroups] = useState<BillingGroup[]>([]),
    [profiles, setProfiles] = useState<BillingProfile[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [other, setOther] = useState(""),
    [account, setAccount] = useState(""),
    [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const r = await supabase.rpc("billing_workspace", { w: ctx.workspace.id });
    if (r.error) setError(r.error.message);
    else {
      setGroups(r.data.groups);
      setProfiles(r.data.profiles);
      setLoaded(true);
    }
  }, [ctx.workspace.id]);
  useEffect(() => {
    void load();
  }, [load, ctx.data.invoices, ctx.data.invoice_receipts]);
  async function act(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await supabase.rpc(fn, args);
      if (r.error) throw r.error;
      await load();
      await ctx.refresh();
      ctx.notify("Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const g = groups.find((x) => x.id === selected),
    b = groups.find((x) => x.id === other),
    issued = groups.filter(billingIssued);
  return (
    <section
      aria-label={
        profilesOnly ? "Billing profiles" : "Reconciled financial records"
      }
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loaded ? (
        <p role="status">Loading billing records…</p>
      ) : profilesOnly ? (
        <Panel
          title="Reusable billing profiles"
          subtitle="Copy defaults into new drafts. Updating a profile never changes an existing document."
        >
          <Field label="Client billing account">
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Choose client</option>
              {ctx.data.client_accounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {account && (
            <ProfileForm
              key={
                account +
                ":" +
                (profiles.find((x) => x.client_account_id === account)
                  ?.revision || 0)
              }
              profile={profiles.find((x) => x.client_account_id === account)}
              name={
                ctx.data.client_accounts.find((c) => c.id === account)?.name ||
                ""
              }
              busy={busy}
              save={(p) =>
                act("save_billing_profile", {
                  account,
                  expected_revision:
                    profiles.find((x) => x.client_account_id === account)
                      ?.revision || 0,
                  profile: p,
                })
              }
            />
          )}
        </Panel>
      ) : (
        <>
          <div className="three-stats">
            <Stat
              label="Approved commitments / invoices"
              value={money(issued.reduce((n, x) => n + x.total_cents, 0))}
              note="Linked sources counted once. USD."
            />
            <Stat
              label="Verified net receipts"
              value={money(groups.reduce((n, x) => n + x.paid_cents, 0))}
              note="Receipts and provider payments, less refunds and matched duplicates."
            />
            <Stat
              label="Unpaid commitments"
              value={money(
                issued.reduce((n, x) => n + Math.max(0, x.balance_cents), 0),
              )}
              note="Full commitment balance. Due dates remain on source records."
            />
          </div>
          <Panel
            title="One financial record, traceable sources"
            subtitle="Unlinked records are separate until you verify they represent the same full obligation. A deposit-only invoice must not be merged with the full agreement."
          >
            <button
              className="button"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh billing
            </button>
            {!groups.length && (
              <p>
                No financial records yet. Create a document or invoice to begin.
              </p>
            )}
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Billing record balances"
            >
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Project</th>
                    <th>Total</th>
                    <th>Verified paid</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelected(x.id);
                            setOther("");
                          }}
                        >
                          {x.sources.find((s) => s.primary)?.title}
                        </button>
                        <small>
                          {x.sources.length} source(s)
                          {x.unverified_paid
                            ? " · Legacy Paid status needs receipt evidence"
                            : ""}
                        </small>
                      </td>
                      <td>
                        {ctx.data.projects.find((p) => p.id === x.project_id)
                          ?.name || "No project"}
                      </td>
                      <td>{money(x.total_cents)}</td>
                      <td>{money(x.paid_cents)}</td>
                      <td>
                        {money(x.balance_cents)}
                        {x.balance_cents < 0 ? " credit / overpayment" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {g && (
            <Panel
              title={"Reconcile: " + g.sources.find((s) => s.primary)?.title}
            >
              <p>Stable billing reference: {g.id}</p>
              <h3>Source documents</h3>
              {g.sources.map((s) => (
                <div key={s.id} className="workflow-row">
                  <span>
                    {s.title} · {s.type} · {s.status} · {money(s.total_cents)}
                    {s.primary ? " · Primary amount" : ""}
                  </span>
                  <a
                    className="button"
                    href={`/?workspace=${ctx.workspace.id}&page=${s.kind === "document" ? "Documents%20%26%20payments" : "Financials"}&${s.kind === "document" ? "clientDocument=" + s.source_id : "finance=" + (s.kind === "invoice" ? "Invoices" : "Estimates")}`}
                  >
                    Open source
                  </a>
                  {!s.primary && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        const note = window.prompt(
                          "Why should this source become a separate obligation?",
                        );
                        if (note)
                          void act("separate_billing_source", {
                            source: s.id,
                            note,
                          });
                      }}
                    >
                      Separate source
                    </button>
                  )}
                </div>
              ))}
              <h3>Payment evidence</h3>
              <p>
                Match only two records of the same transaction. A match keeps
                both originals but counts the provider payment once, including
                later refunds.
              </p>
              {g.payments.map((p) => (
                <div className="workflow-row" key={p.kind + p.id}>
                  <span>
                    {p.date} · {p.reference || "No reference"} ·{" "}
                    {money(p.gross_cents)}
                    {p.refunded_cents
                      ? ` · refunded ${money(p.refunded_cents)}`
                      : ""}
                    {p.matched
                      ? " · Matched duplicate, excluded from total"
                      : ""}
                  </span>
                  {p.kind === "receipt" &&
                    (p.matched ? (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          const note = window.prompt(
                            "Reason for removing this payment match",
                          );
                          if (note)
                            void act("reconcile_billing_payment", {
                              receipt: p.id,
                              payment: p.matched_payment,
                              note,
                              remove_match: true,
                            });
                        }}
                      >
                        Remove payment match
                      </button>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act("reconcile_billing_payment", {
                            receipt: p.id,
                            payment: f.get("payment"),
                            note: f.get("note"),
                          });
                        }}
                      >
                        <Field label={"Matching payment for " + p.reference}>
                          <select name="payment" required>
                            <option value="">Choose transaction</option>
                            {g.payments
                              .filter(
                                (x) =>
                                  x.kind === "payment" &&
                                  x.gross_cents === p.gross_cents,
                              )
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.reference} · {x.date}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field label="Evidence for payment match">
                          <input
                            name="note"
                            required
                            minLength={3}
                            maxLength={2000}
                          />
                        </Field>
                        <button className="button" disabled={busy}>
                          Match duplicate payment
                        </button>
                      </form>
                    ))}
                </div>
              ))}
              <details>
                <summary>Link another record of the same obligation</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("reconcile_billing_groups", {
                      primary_group: g.id,
                      other_group: other,
                      note: f.get("note"),
                    });
                  }}
                >
                  <Field label="Record to reconcile">
                    <select
                      value={other}
                      required
                      onChange={(e) => setOther(e.target.value)}
                    >
                      <option value="">Choose record</option>
                      {groups
                        .filter(
                          (x) =>
                            x.id !== g.id &&
                            x.project_id === g.project_id &&
                            x.total_cents === g.total_cents,
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.sources[0]?.title} · {money(x.paid_cents)} paid
                          </option>
                        ))}
                    </select>
                  </Field>
                  {b && (
                    <p>
                      Preview: retain one {money(g.total_cents)} obligation with{" "}
                      {g.sources.length + b.sources.length} sources. Combined
                      payment evidence: {money(g.paid_cents + b.paid_cents)}.
                      Match any duplicate transactions separately. Historical
                      records stay intact.
                    </p>
                  )}
                  <Field label="Reason and source evidence">
                    <textarea
                      name="note"
                      required
                      minLength={3}
                      maxLength={2000}
                    />
                  </Field>
                  <label>
                    <input type="checkbox" required /> I verified these records
                    describe the same full obligation, not an additional charge
                    or a deposit-only invoice.
                  </label>
                  <button className="button" disabled={busy || !b}>
                    Link financial records
                  </button>
                </form>
              </details>
            </Panel>
          )}
        </>
      )}
    </section>
  );
}
function ProfileForm({
  profile,
  name,
  busy,
  save,
}: {
  profile?: BillingProfile;
  name: string;
  busy: boolean;
  save: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [contacts, setContacts] = useState(profile?.contacts || []);
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          billing_name: f.get("billing_name"),
          email: f.get("email"),
          address: f.get("address"),
          default_rate_cents: Math.round(Number(f.get("rate")) * 100),
          tax_rate: Number(f.get("tax_rate")),
          tax_note: f.get("tax_note"),
          contacts,
        });
      }}
    >
      <Field label="Billing name">
        <input
          name="billing_name"
          defaultValue={profile?.billing_name || name}
          required
          maxLength={200}
        />
      </Field>
      <Field label="Billing email">
        <input
          name="email"
          type="email"
          defaultValue={profile?.email || ""}
          required
          maxLength={254}
        />
      </Field>
      <Field label="Billing address">
        <textarea
          aria-label="Billing address"
          name="address"
          defaultValue={profile?.address || ""}
          maxLength={2000}
        />
      </Field>
      <Field label="Default hourly rate (USD)">
        <input
          name="rate"
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          defaultValue={(profile?.default_rate_cents || 0) / 100}
        />
      </Field>
      <Field label="Default tax rate (%)">
        <input
          name="tax_rate"
          type="number"
          min="0"
          max="20"
          step="0.01"
          defaultValue={profile?.tax_rate || 0}
        />
      </Field>
      <Field label="Tax treatment note">
        <textarea
          name="tax_note"
          defaultValue={profile?.tax_note || ""}
          maxLength={2000}
        />
      </Field>
      <h3>Client contacts</h3>
      {contacts.map((c, i) => (
        <fieldset key={i}>
          <legend>Contact {i + 1}</legend>
          <Field label="Contact name">
            <input
              value={c.name}
              required
              maxLength={200}
              onChange={(e) =>
                setContacts(
                  contacts.map((x, n) =>
                    n === i ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Contact email">
            <input
              type="email"
              required
              value={c.email}
              onChange={(e) =>
                setContacts(
                  contacts.map((x, n) =>
                    n === i ? { ...x, email: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Contact role">
            <select
              value={c.role}
              onChange={(e) =>
                setContacts(
                  contacts.map((x, n) =>
                    n === i
                      ? { ...x, role: e.target.value as typeof c.role }
                      : x,
                  ),
                )
              }
            >
              <option>Billing</option>
              <option>Approver</option>
              <option>Primary</option>
            </select>
          </Field>
          <button
            type="button"
            className="button"
            onClick={() => setContacts(contacts.filter((_, n) => n !== i))}
          >
            Remove contact {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="button"
        disabled={contacts.length >= 20}
        onClick={() =>
          setContacts([...contacts, { name: "", email: "", role: "Billing" }])
        }
      >
        Add billing contact
      </button>
      <p>Contact labels do not invite users or grant project access.</p>
      <button className="button primary" disabled={busy}>
        Save billing profile
      </button>
    </form>
  );
}
