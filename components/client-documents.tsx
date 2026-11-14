"use client";
import { brand } from "../lib/brand";

import type { BillingProfile } from "@/lib/billing";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type StudioContext } from "./studio";
import { Field, Panel } from "./ui";
import {
  documentKinds,
  money,
  totals,
  type ClientDocument,
  type DocumentContent,
} from "@/lib/client-documents";
import {
  documentTemplate,
  updateGeneratedWording,
  type DocumentWording,
} from "@/lib/document-templates";
import { DocumentTemplateChooser } from "./document-template-chooser";
import { services } from "@/lib/service-catalog";
async function headers() {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token}`,
  };
}
export function ClientDocuments({
  ctx,
  onReturn,
}: {
  ctx: StudioContext;
  onReturn: () => void;
}) {
  const owner = ctx.workspace.role === "owner";
  const [balances, setBalances] = useState<
    {
      document_id: string;
      paid_cents: number;
      balance_cents: number;
      unverified_paid: boolean;
      linked_sources: number;
    }[]
  >([]);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [initialKind, setInitialKind] =
    useState<ClientDocument["kind"]>("Estimate");
  const [docs, setDocs] = useState<ClientDocument[]>([]),
    [payments, setPayments] = useState<
      { document_id: string; amount_cents: number; refunded_cents: number }[]
    >([]),
    [selected, setSelected] = useState<ClientDocument | null>(null),
    [editing, setEditing] = useState(false),
    [source, setSource] = useState<ClientDocument | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [squareReady, setSquareReady] = useState(false),
    [settings, setSettings] = useState({ cash_app: "", venmo: "", zelle: "" });
  function selectDocument(document: ClientDocument | null) {
    setSelected(document);
    const url = new URL(window.location.href);
    if (document) url.searchParams.set("clientDocument", document.id);
    else url.searchParams.delete("clientDocument");
    window.history.replaceState(window.history.state, "", url);
  }
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "/api/client-documents?workspace=" + ctx.workspace.id,
        { headers: await headers() },
      );
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      setDocs(x.documents);
      setPayments(x.payments);
      setBalances(x.balances || []);
      setSquareReady(x.square_ready);
      if (x.settings) setSettings(x.settings);
      setSelected(
        (d) =>
          x.documents.find(
            (n: ClientDocument) =>
              n.id ===
              (d?.id ||
                new URLSearchParams(window.location.search).get(
                  "clientDocument",
                )),
          ) || null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ctx.workspace.id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/client-documents", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ workspace_id: ctx.workspace.id, ...body }),
      });
      const x = await r.json();
      if (!r.ok) throw Error(x.error);
      await load();
      ctx.notify("Saved");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function pdf(d: ClientDocument) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/client-documents/${d.id}/pdf`, {
        headers: await headers(),
      });
      if (!r.ok) throw Error("Could not download this document.");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = d.kind.replaceAll(" ", "-") + "-v" + d.version + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const returnLabel =
    ctx.workspace.role === "client"
      ? "Return to client portal"
      : "Return to overview";
  function returnToWorkspace() {
    if (busy) return;
    if (
      editing &&
      !window.confirm("Leave the editor? Any unsaved changes will be lost.")
    )
      return;
    onReturn();
  }
  const paid = (d: ClientDocument) =>
    balances.find((b) => b.document_id === d.id)?.paid_cents ??
    payments
      .filter((p) => p.document_id === d.id)
      .reduce((n, p) => n + p.amount_cents - p.refunded_cents, 0);
  return (
    <section className="documents-workspace" data-no-auto-tooltip>
      <nav className="document-return-nav" aria-label="Document navigation">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={returnToWorkspace}
        >
          <ArrowLeft size={16} aria-hidden="true" /> {returnLabel}
        </button>
      </nav>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CLEAR SCOPE. CLEAR NEXT STEPS.</div>
          <h1>Documents & payments.</h1>
          <p>
            {owner
              ? "Define the engagement. Align on the work. Move forward with confidence."
              : "Review your documents, ask questions, and see what is due."}
          </p>
        </div>
        {owner && (
          <button
            className="button primary"
            onClick={() => {
              setSource(null);
              setEditing(false);
              setChoosingTemplate(true);
              selectDocument(null);
            }}
          >
            Create document
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {choosingTemplate && owner ? (
        <Panel title="Define the next step">
          <DocumentTemplateChooser
            onSelect={(kind) => {
              setInitialKind(kind);
              setChoosingTemplate(false);
              setEditing(true);
            }}
          />
          <button className="button" onClick={() => setChoosingTemplate(false)}>
            All documents
          </button>
        </Panel>
      ) : editing && owner ? (
        <DocumentEditor
          ctx={ctx}
          source={source}
          initialKind={initialKind}
          busy={busy}
          onReturn={returnToWorkspace}
          returnLabel={returnLabel}
          cancel={() => setEditing(false)}
          save={async (body) => {
            if (await action({ action: "create", ...body })) setEditing(false);
          }}
        />
      ) : selected ? (
        <Panel title={selected.title}>
          <div className="toolbar">
            <button className="button" onClick={() => selectDocument(null)}>
              All documents
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => pdf(selected)}
            >
              Download PDF
            </button>
            {owner && (
              <button
                className="button"
                onClick={() => {
                  setSource(selected);
                  setEditing(true);
                }}
              >
                Create revised version
              </button>
            )}
            {owner && selected.status === "Draft" && (
              <button
                className="button primary"
                disabled={busy || !selected.client_id}
                onClick={() => action({ action: "share", id: selected.id })}
              >
                Share with client
              </button>
            )}
            {owner &&
              ["Draft", "Shared", "Discussion"].includes(selected.status) && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    action({ action: "withdraw", id: selected.id })
                  }
                >
                  Withdraw version
                </button>
              )}
          </div>
          <p>
            {selected.kind} · Version {selected.version} · {selected.status}
          </p>
          <h3>{selected.content.client}</h3>
          {selected.content.billing_address && (
            <p className="preserve-lines">{selected.content.billing_address}</p>
          )}
          {selected.due_date && <p>Payment due: {selected.due_date}</p>}
          <p>{selected.content.service}</p>
          <h3>Scope</h3>
          <p className="preserve-lines">{selected.content.scope}</p>
          <h3>Deliverables</h3>
          <p className="preserve-lines">{selected.content.deliverables}</p>
          <table className="document-items">
            <caption>Fees in USD</caption>
            <thead>
              <tr>
                <th>Description</th>
                <th>Quantity</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {selected.content.items.map((i, n) => (
                <tr key={n}>
                  <td>{i.description}</td>
                  <td>{i.quantity}</td>
                  <td>{money(Math.round(i.quantity * i.unit_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Tax ({selected.content.tax_rate}%):{" "}
            {money(totals(selected.content).tax)} · Total:{" "}
            <strong>{money(selected.total_cents)}</strong>
          </p>
          <p>
            50% deposit: <strong>{money(selected.deposit_cents)}</strong> ·
            Confirmed payments: {money(paid(selected))}
          </p>
          <p>
            {selected.status === "Approved" &&
            paid(selected) >= selected.deposit_cents &&
            selected.deposit_cents > 0
              ? "Deposit received. Coordinate your start date with the studio."
              : "Work starts after approval and receipt of the 50% deposit."}
          </p>
          <p>
            Reconciled balance:{" "}
            {money(
              balances.find((b) => b.document_id === selected.id)
                ?.balance_cents ?? selected.total_cents - paid(selected),
            )}
            . Linked sources share the same verified payment total.
          </p>
          {balances.find((b) => b.document_id === selected.id)
            ?.unverified_paid && (
            <p role="status">
              The studio must reconcile an older Paid status with receipt
              evidence before accepting another payment.
            </p>
          )}
          <p>{selected.content.tax_note}</p>
          <h3>Terms</h3>
          <p className="preserve-lines">{selected.content.terms}</p>
          {selected.signature_name && (
            <p>
              Approved by {selected.signature_name} · {selected.decided_at}
            </p>
          )}
          {selected.decision_note && (
            <p className="preserve-lines">
              Client response: {selected.decision_note}
            </p>
          )}
          {selected.client_id === ctx.userId &&
            selected.status === "Shared" && (
              <form
                className="settings-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setError("");
                  const { error } = await supabase.rpc(
                    "decide_client_document",
                    {
                      doc: selected.id,
                      decision: f.get("decision"),
                      signer: f.get("signer"),
                      note: f.get("note"),
                    },
                  );
                  if (error) setError(error.message);
                  else {
                    await load();
                    ctx.notify("Response received");
                  }
                  setBusy(false);
                }}
              >
                <h3>Your response</h3>
                <Field label="Response">
                  <select name="decision" required>
                    <option value="Approved">Approve this version</option>
                    <option value="Discussion">Request discussion</option>
                  </select>
                </Field>
                <Field label="Your full name">
                  <input name="signer" required minLength={2} maxLength={200} />
                </Field>
                <Field label="Comments (required for discussion)">
                  <textarea name="note" maxLength={4000} />
                </Field>
                <label>
                  <input type="checkbox" required /> I am authorized to respond
                  for this client. If approving, I agree to these terms and
                  intend my typed name as my electronic signature.
                </label>
                <button className="button primary" disabled={busy}>
                  Send response
                </button>
              </form>
            )}
          {selected.status === "Approved" &&
            paid(selected) < selected.deposit_cents &&
            selected.deposit_cents > 0 && (
              <section>
                <h3>Pay your deposit</h3>
                <button
                  className="button primary"
                  disabled={busy || !squareReady}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await fetch(
                        `/api/client-documents/${selected.id}/checkout`,
                        { method: "POST", headers: await headers() },
                      );
                      const x = await r.json();
                      if (!r.ok) throw Error(x.error);
                      window.location.assign(x.url);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {squareReady
                    ? "Pay securely with Square"
                    : "Square connection pending"}
                </button>
                {Object.entries(settings)
                  .filter(
                    ([k, v]) => ["cash_app", "venmo", "zelle"].includes(k) && v,
                  )
                  .map(([k, v]) => (
                    <p key={k}>
                      <strong>
                        {k === "cash_app"
                          ? "Cash App"
                          : k === "venmo"
                            ? "Venmo"
                            : "Zelle"}
                        :
                      </strong>{" "}
                      {v}
                    </p>
                  ))}
                <p>
                  Include document reference {selected.id}. Alternative payments
                  appear here after the studio confirms receipt.
                </p>
              </section>
            )}
          {owner && selected.status === "Approved" && (
            <form
              className="settings-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action({
                  action: "payment",
                  id: selected.id,
                  provider: f.get("provider"),
                  reference: f.get("reference"),
                  amount_cents: Math.round(Number(f.get("amount")) * 100),
                });
              }}
            >
              <h3>Confirm an external payment</h3>
              <Field label="Payment method">
                <select name="provider">
                  <option>Cash App</option>
                  <option>Venmo</option>
                  <option>Zelle</option>
                </select>
              </Field>
              <Field label="Transaction reference">
                <input
                  name="reference"
                  required
                  minLength={3}
                  maxLength={200}
                />
              </Field>
              <Field label="Received amount (USD)">
                <input
                  type="number"
                  name="amount"
                  required
                  min="0.01"
                  step="0.01"
                />
              </Field>
              <label>
                <input type="checkbox" required /> I verified this payment in
                the receiving account.
              </label>
              <button className="button" disabled={busy}>
                Record verified payment
              </button>
            </form>
          )}
        </Panel>
      ) : (
        <Panel
          title={owner ? "Document library" : "Your documents"}
          bodyClassName="panel-body document-library-body"
        >
          {loading ? (
            <p role="status">Loading documents…</p>
          ) : docs.length ? (
            docs.map((d) => (
              <button
                className="document-row"
                key={d.id}
                onClick={() => selectDocument(d)}
              >
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {d.kind} · {d.content.client} · v{d.version}
                  </small>
                </span>
                <span>
                  {d.status}
                  <small>{money(d.total_cents)}</small>
                </span>
              </button>
            ))
          ) : (
            <p>
              {owner
                ? "Create an estimate, contract, project agreement, invoice, creative brief, or change order."
                : "Your studio will share documents here when they are ready."}
            </p>
          )}
          <button className="button" onClick={() => load()}>
            Refresh
          </button>
        </Panel>
      )}
      {owner && !selected && !editing && !choosingTemplate && (
        <Panel
          title="Payment instructions"
          bodyClassName="panel-body payment-instructions-body"
        >
          <p>
            Square uses the secure server connection. Add the exact business
            payment handles clients should use for alternatives.
          </p>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action({ action: "settings", ...settings });
            }}
          >
            {(["cash_app", "venmo", "zelle"] as const).map((k) => (
              <Field
                key={k}
                label={
                  k === "cash_app"
                    ? "Cash App"
                    : k === "venmo"
                      ? "Venmo"
                      : "Zelle"
                }
              >
                <input
                  value={settings[k]}
                  maxLength={500}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [k]: e.target.value }))
                  }
                />
              </Field>
            ))}
            <button className="button" disabled={busy}>
              Save payment instructions
            </button>
          </form>
        </Panel>
      )}
    </section>
  );
}
export function DocumentEditor({
  initialKind = "Estimate",
  onReturn,
  returnLabel = "Return to client portal",
  ctx,
  source,
  busy,
  cancel,
  save,
}: {
  ctx: StudioContext;
  source: ClientDocument | null;
  initialKind?: ClientDocument["kind"];
  onReturn?: () => void;
  returnLabel?: string;
  busy: boolean;
  cancel: () => void;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<BillingProfile[]>([]),
    [profileId, setProfileId] = useState(""),
    [appliedProfile, setAppliedProfile] = useState<BillingProfile | null>(null);
  const [billingName, setBillingName] = useState(source?.content.client || ""),
    [billingEmail, setBillingEmail] = useState(source?.content.email || ""),
    [billingAddress, setBillingAddress] = useState(
      source?.content.billing_address || "",
    ),
    [taxNote, setTaxNote] = useState(
      source?.content.tax_note ||
        "Digitally delivered design services; no physical goods included. Florida sales tax is not charged on the services described. Any legally required tax for a changed scope or other jurisdiction will be separately disclosed before approval.",
    );
  useEffect(() => {
    void supabase
      .from("billing_profiles")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .then((r) => {
        if (r.data) setProfiles(r.data);
      });
  }, [ctx.workspace.id]);
  const [kind, setKind] = useState(source?.kind || initialKind);
  const [serviceName, setServiceName] = useState(
    source?.content.service || services[0].name,
  );
  const [taxRate, setTaxRate] = useState(source?.content.tax_rate || 0);
  const [templateNote, setTemplateNote] = useState("");
  const [wording, setWording] = useState<DocumentWording>(() => {
    const template = documentTemplate(
      source?.content.service || services[0].name,
      source?.kind || initialKind,
    );
    return source
      ? {
          title: source.title,
          scope: source.content.scope,
          deliverables: source.content.deliverables,
          terms: source.content.terms,
        }
      : template;
  });
  function changeSelection(
    nextService: string,
    nextKind: ClientDocument["kind"],
  ) {
    const previous = documentTemplate(serviceName, kind);
    const next = documentTemplate(nextService, nextKind);
    setWording((current) => updateGeneratedWording(current, previous, next));
    setItems((current) =>
      current.map((item) =>
        item.description === previous.line
          ? { ...item, description: next.line }
          : item,
      ),
    );
    setServiceName(nextService);
    setKind(nextKind);
    setTemplateNote(
      "Service wording updated. Your customized text, client details, and prices are preserved. Review them for the new selection.",
    );
  }
  function applyTemplate() {
    if (
      !window.confirm(
        "Restore the suggested title, scope, deliverables, and terms? This replaces your edits to those fields. Client details and fees will stay as entered.",
      )
    )
      return;
    setWording(documentTemplate(serviceName, kind));
    setTemplateNote(
      "Suggested wording restored. Complete the project-specific prompts before sharing.",
    );
  }

  const [items, setItems] = useState(
    source?.content.items || [
      {
        description: documentTemplate(serviceName, kind).line,
        quantity: 1,
        unit_cents: 0,
      },
    ],
  );
  return (
    <Panel
      title={source ? "Prepare a revised version" : "Define the engagement"}
    >
      <form
        className="settings-form document-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const content = {
            billing_address: billingAddress,
            billing_profile: appliedProfile
              ? {
                  id: appliedProfile.client_account_id,
                  revision: appliedProfile.revision,
                }
              : source?.content.billing_profile,
            business: (brand.name + " – " + brand.ownerName),
            client: String(f.get("client")),
            email: String(f.get("email")),
            service: String(f.get("service")),
            start: String(f.get("start")),
            end: String(f.get("end")),
            scope: String(f.get("scope")),
            deliverables: String(f.get("deliverables")),
            terms: String(f.get("terms")),
            tax_note: String(f.get("tax_note")),
            tax_rate: Number(f.get("tax_rate")),
            items,
          };
          await save({
            kind,
            due_date: f.get("due_date") || null,
            billing_profile_id: appliedProfile?.client_account_id,
            billing_profile_revision: appliedProfile?.revision,
            title: f.get("title"),
            client_id: source ? source.client_id : f.get("client_id") || null,
            project_id: source
              ? source.project_id
              : f.get("project_id") || null,
            previous_id: source?.id || null,
            content,
          });
        }}
      >
        <fieldset>
          <legend>Billing profile defaults</legend>
          <Field label="Billing profile">
            <select
              aria-label="Billing profile"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">Choose profile</option>
              {profiles.map((p) => (
                <option key={p.client_account_id} value={p.client_account_id}>
                  {p.billing_name} · revision {p.revision}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button"
            disabled={!profileId}
            onClick={() => {
              const p = profiles.find((x) => x.client_account_id === profileId);
              if (!p) return;
              setAppliedProfile(p);
              setBillingName(p.billing_name);
              setBillingEmail(p.email);
              setBillingAddress(p.address);
              setTaxRate(Number(p.tax_rate));
              if (p.tax_note) setTaxNote(p.tax_note);
              setItems((current) =>
                current.map((i) =>
                  i.unit_cents === 0
                    ? { ...i, unit_cents: p.default_rate_cents }
                    : i,
                ),
              );
            }}
          >
            Apply billing defaults
          </button>
          <p>
            Copies billing fields and fills zero-priced lines with the default
            rate. Review quantity, prices and tax treatment before saving.
          </p>
        </fieldset>
        {source && (
          <p>
            Revisions retain their project, recipient and document type. Create
            a new document for a different engagement.
          </p>
        )}
        <Field label="Document type">
          <select
            disabled={!!source}
            value={kind}
            onChange={(e) =>
              changeSelection(serviceName, e.target.value as typeof kind)
            }
          >
            {documentKinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Document title">
          <input
            name="title"
            value={wording.title}
            onChange={(e) =>
              setWording((current) => ({ ...current, title: e.target.value }))
            }
            required
            maxLength={200}
          />
        </Field>
        <Field label="Client company / name">
          <input
            name="client"
            value={billingName}
            onChange={(e) => setBillingName(e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Client email">
          <input
            name="email"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Billing address">
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            maxLength={2000}
          />
        </Field>
        <Field label="Payment due (optional)">
          <input
            type="date"
            name="due_date"
            defaultValue={source?.due_date || ""}
          />
        </Field>
        <Field label="Portal recipient (optional until sharing)">
          <select
            disabled={!!source}
            name="client_id"
            defaultValue={source?.client_id || ""}
          >
            <option value="">PDF only / choose later</option>
            {ctx.data.members
              .filter((m) => m.user_id !== ctx.userId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name || m.user_id}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Attach to project (optional)">
          <select
            disabled={!!source}
            name="project_id"
            defaultValue={source?.project_id || ""}
          >
            <option value="">No project yet</option>
            {ctx.data.projects
              .filter((p) => !p.deleted_at && !p.archived_at)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Service">
          <select
            name="service"
            value={serviceName}
            onChange={(e) => changeSelection(e.target.value, kind)}
          >
            {services.map((s) => (
              <option key={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <div className="document-template-callout">
          <h3>Wording tailored to your service</h3>
          <p>
            Suggested wording fills automatically for{" "}
            {serviceName.toLowerCase()}. Edit it for this client and complete
            the bracketed prompts. Amounts and dates are always yours to set.
          </p>
          <button type="button" className="button" onClick={applyTemplate}>
            Restore suggested wording
          </button>
          {templateNote && <p role="status">{templateNote}</p>}
        </div>
        <Field label="Proposed start">
          <input
            name="start"
            type="date"
            defaultValue={source?.content.start || ""}
          />
        </Field>
        <Field label="Proposed delivery">
          <input
            name="end"
            type="date"
            defaultValue={source?.content.end || ""}
          />
        </Field>
        <Field label="The challenge, desired outcome, and our approach">
          <textarea
            name="scope"
            value={wording.scope}
            onChange={(e) =>
              setWording((current) => ({ ...current, scope: e.target.value }))
            }
            required
            rows={5}
            maxLength={16000}
          />
        </Field>
        <Field label="Deliverables, milestones, and review rounds">
          <textarea
            name="deliverables"
            value={wording.deliverables}
            onChange={(e) =>
              setWording((current) => ({
                ...current,
                deliverables: e.target.value,
              }))
            }
            required
            rows={4}
            maxLength={12000}
          />
        </Field>
        <fieldset>
          <legend>Project investment (USD)</legend>
          {items.map((item, i) => (
            <div key={i} className="document-line-editor">
              <Field label="Description">
                <input
                  required
                  value={item.description}
                  onChange={(e) =>
                    setItems((a) =>
                      a.map((x, n) =>
                        n === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Quantity">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems((a) =>
                      a.map((x, n) =>
                        n === i
                          ? { ...x, quantity: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Unit price">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_cents / 100}
                  onChange={(e) =>
                    setItems((a) =>
                      a.map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              unit_cents: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </Field>
              <button
                type="button"
                className="button"
                disabled={items.length === 1}
                onClick={() => setItems((a) => a.filter((_, n) => n !== i))}
              >
                Remove line
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            disabled={items.length >= 100}
            onClick={() =>
              setItems((a) => [
                ...a,
                { description: "", quantity: 1, unit_cents: 0 },
              ])
            }
          >
            Add line
          </button>
        </fieldset>
        <Field label="Applicable sales tax (%)">
          <input
            name="tax_rate"
            type="number"
            min="0"
            max="20"
            step="0.001"
            value={taxRate}
            onChange={(e) => setTaxRate(Number(e.target.value))}
          />
        </Field>
        <DocumentTotal items={items} taxRate={taxRate} />
        <Field label="Tax treatment shown to client">
          <textarea
            name="tax_note"
            required
            maxLength={2000}
            value={taxNote}
            onChange={(e) => setTaxNote(e.target.value)}
          />
        </Field>
        <p>
          50% of the total is due before work begins. Review tax treatment for
          the actual transaction; a Florida CPA can confirm your filing
          obligations.
        </p>
        <Field label="Terms">
          <textarea
            name="terms"
            rows={12}
            required
            maxLength={20000}
            value={wording.terms}
            onChange={(e) =>
              setWording((current) => ({ ...current, terms: e.target.value }))
            }
          />
        </Field>
        <p>
          Review these starter terms for the specific engagement before sharing.
          A Florida attorney should review your reusable contract language.
        </p>
        <div className="toolbar">
          <button type="button" className="button" onClick={cancel}>
            Cancel
          </button>
          {onReturn && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={onReturn}
            >
              {returnLabel}
            </button>
          )}
          <button className="button primary" disabled={busy}>
            Save draft
          </button>
        </div>
      </form>
    </Panel>
  );
}

function DocumentTotal({
  items,
  taxRate,
}: {
  items: DocumentContent["items"];
  taxRate: number;
}) {
  try {
    const t = totals({ items, tax_rate: taxRate } as DocumentContent);
    return (
      <dl
        className="document-total"
        aria-label="Document totals"
        aria-live="polite"
      >
        <div>
          <dt>Total including tax</dt>
          <dd>{money(t.total)}</dd>
        </div>
        <div>
          <dt>50% deposit before work</dt>
          <dd>{money(t.deposit)}</dd>
        </div>
        <div>
          <dt>Remaining balance</dt>
          <dd>{money(t.total - t.deposit)}</dd>
        </div>
      </dl>
    );
  } catch {
    return (
      <p role="alert">
        Enter valid amounts within the supported document total.
      </p>
    );
  }
}
