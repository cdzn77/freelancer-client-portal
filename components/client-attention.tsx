"use client";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Clock3 } from "lucide-react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { money, type ClientDocument } from "@/lib/client-documents";

type Payment = {
  document_id: string;
  amount_cents: number;
  refunded_cents: number;
};
type Balance = {
  document_id: string;
  paid_cents: number;
  unverified_paid: boolean;
};
export function documentActions(
  documents: ClientDocument[],
  payments: Payment[],
  balances: Balance[] = [],
) {
  return documents.flatMap((d) => {
    if (d.status === "Shared")
      return [
        {
          id: d.id,
          title: d.title,
          detail: `${d.kind} · Ready to review`,
          action: "Review document",
        },
      ];
    const balance = balances.find((b) => b.document_id === d.id);
    if (d.status === "Approved" && balance?.unverified_paid)
      return [
        {
          id: d.id,
          title: d.title,
          detail: "Payment status needs studio verification",
          action: "View payment records",
        },
      ];
    const paid =
      balance?.paid_cents ??
      payments
        .filter((p) => p.document_id === d.id)
        .reduce((n, p) => n + p.amount_cents - p.refunded_cents, 0);
    if (d.status === "Approved" && d.deposit_cents > paid)
      return [
        {
          id: d.id,
          title: d.title,
          detail: `${money(d.deposit_cents - paid)} remaining toward your 50% deposit`,
          action: "View payment options",
        },
      ];
    return [];
  });
}
export function ClientAttention({
  ctx,
  onReview,
  onDocument,
}: {
  ctx: StudioContext;
  onReview: (id: string) => void;
  onDocument: (id: string) => void;
}) {
  const [remote, setRemote] = useState<{
    workspace: string;
    documents: ClientDocument[];
    payments: Payment[];
    balances: Balance[];
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (ctx.readOnly) return;
    const controller = new AbortController();
    setRemote(null);
    setError(false);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw Error("Sign in required");
        const response = await fetch(
          `/api/client-documents?workspace=${encodeURIComponent(ctx.workspace.id)}`,
          {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw Error("Documents unavailable");
        const result = await response.json();
        if (!controller.signal.aborted)
          setRemote({
            workspace: ctx.workspace.id,
            documents: result.documents,
            payments: result.payments,
            balances: result.balances || [],
          });
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [ctx.workspace.id, attempt]);
  const projects = ctx.data.projects.filter(
    (p) =>
      !p.archived_at && !p.deleted_at && p.client_tools?.includes("approvals"),
  );
  const reviews = projects.flatMap((p) => [
    ...ctx.data.approvals
      .filter(
        (a) =>
          a.project_id === p.id && a.is_published && a.status === "Pending",
      )
      .map((a) => ({ id: a.id, title: a.label, project: p })),
    ...ctx.data.deliverables
      .filter((d) => d.project_id === p.id && !d.archived_at && !d.deleted_at)
      .flatMap((d) => {
        const v = ctx.data.deliverable_versions.find(
          (v) =>
            v.id === d.current_version_id &&
            v.is_published &&
            v.status === "Pending",
        );
        return v
          ? [
              {
                id: v.id,
                title: `${d.title} · Version ${v.version_number}`,
                project: p,
              },
            ]
          : [];
      }),
  ]);
  const available = remote?.workspace === ctx.workspace.id;
  const documents = available
    ? documentActions(remote.documents, remote.payments, remote.balances)
    : [];
  const count = reviews.length + documents.length;
  return (
    <section
      className={`client-attention ${count ? "has-actions" : available ? "is-clear" : "is-loading"}`}
      aria-label="Needs your attention"
    >
      <div className="client-attention-heading">
        <h2>
          {count ? (
            <CircleAlert size={22} aria-hidden="true" />
          ) : available ? (
            <CircleCheck size={22} aria-hidden="true" />
          ) : (
            <Clock3 size={22} aria-hidden="true" />
          )}
          {count
            ? "Your turn"
            : available
              ? "You’re up to date"
              : "Your next steps"}
        </h2>
        {count > 0 && (
          <span>
            {count} {count === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      <div className="client-attention-items">
        {reviews.map((r) => (
          <button key={r.id} onClick={() => onReview(r.project.id)}>
            <span>
              <strong>{r.title}</strong>
              <small>{r.project.name} · Ready for feedback</small>
            </span>
            <span className="client-action-label">
              Review work <ArrowRight size={16} aria-hidden="true" />
            </span>
          </button>
        ))}
        {documents.map((d) => (
          <button key={d.id} onClick={() => onDocument(d.id)}>
            <span>
              <strong>{d.title}</strong>
              <small>{d.detail}</small>
            </span>
            <span className="client-action-label">
              {d.action}
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
      {!count && available && (
        <p>
          No pending work reviews or document actions. Your project details are
          below.
        </p>
      )}
      {ctx.readOnly && (
        <p>
          Document and payment actions are outside this project-only preview.
        </p>
      )}
      {!ctx.readOnly && !available && !error && (
        <p role="status">Checking documents and payments…</p>
      )}
      {error && (
        <p className="client-status-error" role="status">
          Documents and payments could not be checked.{" "}
          <button
            className="button small"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Try again
          </button>
        </p>
      )}
    </section>
  );
}
