"use client";
import { useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/client-documents";
import { Field, Panel } from "./ui";
type Preview = {
  document_id: string;
  title: string;
  version: number;
  kind: string;
  project_name: string;
  scope: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  budget_id: string | null;
  budget_revision: number;
  before_cents: number;
};
type History = {
  id: string;
  document_version: number;
  project_id: string;
  service_cents: number;
  reimbursable_cents: number;
  tax_cents: number;
  before_cents: number;
  after_cents: number;
  treatment: string;
  reason: string;
  created_at: string;
  source_snapshot: { title: string };
};
export function ScopeBudget({ ctx }: { ctx: StudioContext }) {
  const [docs, setDocs] = useState<
      { id: string; title: string; version: number }[]
    >([]),
    [history, setHistory] = useState<History[]>([]),
    [doc, setDoc] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [reimbursable, setReimbursable] = useState("0"),
    [treatment, setTreatment] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [d, h] = await Promise.all([
      supabase
        .from("client_documents")
        .select("id,title,version")
        .eq("workspace_id", ctx.workspace.id)
        .eq("status", "Approved")
        .in("kind", [
          "Estimate",
          "Contract",
          "Project agreement",
          "Change order",
        ])
        .order("created_at", { ascending: false }),
      supabase
        .from("budget_scope_history")
        .select("*")
        .eq("workspace_id", ctx.workspace.id)
        .order("created_at", { ascending: false }),
    ]);
    if (d.error || h.error) setError(d.error?.message || h.error!.message);
    else {
      setDocs(d.data);
      setHistory(h.data);
    }
  }
  useEffect(() => {
    void load();
  }, [ctx.workspace.id]);
  const allocation = Math.round(Number(reimbursable) * 100),
    service = (preview?.subtotal_cents || 0) - allocation,
    after = (treatment === "add" ? preview?.before_cents || 0 : 0) + service;
  return (
    <Panel
      title="Budget from approved scope"
      subtitle="Preview the signed source. Taxes and reimbursable allowances stay separate from the service budget."
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <Field label="Approved scope source">
          <select
            value={doc}
            onChange={(e) => {
              setDoc(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">Choose approved document</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · v{d.version}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="button"
          disabled={!doc || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const r = await supabase.rpc("preview_scope_budget", { doc });
            setBusy(false);
            if (r.error) setError(r.error.message);
            else {
              setPreview(r.data);
              setTreatment(r.data.budget_id ? "" : "create");
              setReimbursable("0");
            }
          }}
        >
          Preview scope budget
        </button>
      </div>
      {preview && (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await supabase.rpc("apply_scope_budget", {
                doc,
                expected_revision: preview.budget_revision,
                treatment,
                reimbursable_cents: allocation,
                reason,
              });
              if (r.error) throw r.error;
              await load();
              await ctx.refresh();
              setPreview(null);
              setReason("");
              ctx.notify("Approved scope applied to budget");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>
            {preview.title} · version {preview.version}
          </h3>
          <p>{preview.project_name}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{preview.scope}</p>
          <dl className="profit-grid">
            <div>
              <dt>Approved total</dt>
              <dd>{money(preview.total_cents)}</dd>
            </div>
            <div>
              <dt>Before tax</dt>
              <dd>{money(preview.subtotal_cents)}</dd>
            </div>
            <div>
              <dt>Tax excluded</dt>
              <dd>{money(preview.tax_cents)}</dd>
            </div>
            <div>
              <dt>Current service budget</dt>
              <dd>{money(preview.before_cents)}</dd>
            </div>
          </dl>
          <Field label="Reimbursable allowance within approved subtotal (USD)">
            <input
              required
              type="number"
              min="0"
              max={(preview.subtotal_cents - 1) / 100}
              step="0.01"
              value={reimbursable}
              onChange={(e) => setReimbursable(e.target.value)}
            />
          </Field>
          <p>
            Identify the approved third-party cost allowance here. This
            allocation does not change the signed price or issue a reimbursement
            invoice.
          </p>
          <Field label="Budget treatment">
            <select
              required
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
            >
              {preview.budget_id ? (
                <>
                  <option value="">
                    Choose how to treat the existing budget
                  </option>
                  <option value="replace">
                    Replace with this approved service scope
                  </option>
                  {preview.kind === "Change order" && (
                    <option value="add">Add this approved change order</option>
                  )}
                </>
              ) : (
                <option value="create">Create the service budget</option>
              )}
            </select>
          </Field>
          <p>
            Service allocation: {money(service)}. Resulting budget:{" "}
            {money(after)}. Reimbursable allowance: {money(allocation)}.
          </p>
          <Field label="Budget allocation reason">
            <textarea
              aria-label="Budget allocation reason"
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            className="button primary"
            disabled={
              busy || !treatment || service <= 0 || !Number.isFinite(allocation)
            }
          >
            Apply approved scope to budget
          </button>
        </form>
      )}
      <details>
        <summary>Approved scope budget history ({history.length})</summary>
        {history.map((h) => (
          <article key={h.id} className="operation-section">
            <h3>
              {h.source_snapshot.title} · v{h.document_version}
            </h3>
            <p>
              {ctx.data.projects.find((p) => p.id === h.project_id)?.name} ·{" "}
              {new Date(h.created_at).toLocaleString()} · {h.treatment}
            </p>
            <p>
              {money(h.before_cents)} → {money(h.after_cents)} service budget.
              Tax excluded: {money(h.tax_cents)}. Reimbursable allowance:{" "}
              {money(h.reimbursable_cents)}.
            </p>
            <p>{h.reason}</p>
          </article>
        ))}
      </details>
    </Panel>
  );
}
