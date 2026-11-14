"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CostPlan,
  EXPENSE_CATEGORIES,
  SUBSCRIPTION_STATUSES,
} from "@/lib/studio-expenses";
import { Field } from "./ui";
import { Select } from "./select";
type Account = {
  id: string;
  email: string;
  enabled: boolean;
  last_sync: string | null;
  last_attempt: string | null;
  last_error: string | null;
};
type Item = {
  id: string;
  status: string;
  payment_id: string | null;
  subscription_id: string | null;
  subject: string;
  sender: string;
  account_email: string;
  received_on: string;
  excerpt: string;
  gmail_id: string;
  suggestion: {
    kind: string;
    amount: number | null;
    warning: string;
    status: string;
  };
};
export function ExpenseEmailSync({
  workspace,
  plans,
  onChanged,
}: {
  workspace: string;
  plans: CostPlan[];
  onChanged: () => void;
}) {
  const [data, setData] = useState<{
      total?: number;
      configured: boolean;
      mailboxes: string[];
      accounts: Account[];
      items: Item[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [queueStatus, setQueueStatus] = useState("Review"),
    [offset, setOffset] = useState(0);
  const [item, setItem] = useState<Item | null>(null),
    [action, setAction] = useState("payment"),
    [plan, setPlan] = useState(""),
    [vendor, setVendor] = useState(""),
    [amount, setAmount] = useState(""),
    [paid, setPaid] = useState(""),
    [category, setCategory] = useState("Software & subscriptions"),
    [status, setStatus] = useState("Needs verification"),
    [renewal, setRenewal] = useState("");
  async function call(body?: object) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw Error("Sign in again.");
    const r = await fetch(
      "/api/studio-expenses/email" +
        (body
          ? ""
          : "?workspace=" +
            workspace +
            "&status=" +
            queueStatus +
            "&offset=" +
            offset),
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify({ workspace, ...body }) } : {}),
      },
    );
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Could not complete email sync.");
    return result;
  }
  async function load() {
    try {
      setData(await call());
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  useEffect(() => {
    setData(null);
    setItem(null);
    void load();
  }, [workspace, queueStatus, offset]);
  async function mailbox(action: string, email?: string, account?: string) {
    setBusy(true);
    setNotice("");
    try {
      const result = await call({ action, email, account });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setNotice(
        action === "sync"
          ? `${result.processed} messages checked.${result.more ? " More history remains; the next sync continues automatically." : ""}`
          : "Mailbox settings updated.",
      );
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function review(r: Item) {
    setItem(r);
    setAction(r.suggestion.kind || "payment");
    setPlan("");
    setVendor("");
    setAmount(r.suggestion.amount == null ? "" : String(r.suggestion.amount));
    setPaid("");
    setStatus(r.suggestion.status || "Needs verification");
    setRenewal("");
    setCategory("Software & subscriptions");
  }
  async function approve(actionName = action) {
    if (!item) return;
    setBusy(true);
    setNotice("");
    try {
      const { error } = await supabase.rpc("review_expense_mail", {
        item: item.id,
        action: actionName,
        details: {
          plan_id: plan,
          vendor,
          amount: actionName === "subscription" ? "" : amount,
          paid_on: paid,
          category,
          status,
          next_renewal_on: renewal,
        },
      });
      if (error)
        throw Error(
          error.code === "P0001"
            ? error.message
            : "Could not apply this review. Check the amount, date and selected subscription.",
        );
      setItem(null);
      setNotice(
        "Review saved. Existing matching payments are linked instead of duplicated.",
      );
      await load();
      onChanged();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Email receipt sync" className="expense-panel-body">
      <h3>Email sync</h3>
      <p>
        Google grants mailbox-wide read access. PMS searches financial email
        subjects and stores limited excerpts for your review.{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          Privacy policy
        </a>{" "}
        ·{" "}
        <a href="/terms" target="_blank" rel="noreferrer">
          Terms of service
        </a>
      </p>
      <p>
        Connect each Google mailbox separately. Read-only scans find receipt,
        invoice and subscription emails from January 2026 onward. Scans run in
        small batches every 15 minutes, rotating across connected accounts.
        Initial history may take several runs.
      </p>
      <p>
        New findings need approval before changing payments or subscriptions.
        PDFs and image-only receipts need manual review. Forecasts remain off
        when a plan is updated from email.
      </p>
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>Loading email connections…</p>
      ) : (
        <>
          {!data.configured && (
            <p role="alert">
              Google connection settings are missing on the server.
            </p>
          )}
          {data.mailboxes.map((email) => {
            const a = data.accounts.find((a) => a.email === email);
            return (
              <article key={email} className="expense-heading">
                <div>
                  <strong>{email}</strong>
                  <p>
                    {a
                      ? a.enabled
                        ? "Connected · scanning enabled"
                        : "Connected · paused"
                      : "Not connected"}
                    {a?.last_sync
                      ? ` · Last completed scan ${new Date(a.last_sync).toLocaleString()}`
                      : ""}
                  </p>
                  {a?.last_attempt && !a.last_sync && !a.last_error && (
                    <p>
                      Initial history scan in progress. New batches appear
                      automatically.
                    </p>
                  )}
                  {a?.last_error && <p role="alert">{a.last_error}</p>}
                </div>
                <div className="expense-actions">
                  <button
                    className="button"
                    disabled={busy || !data.configured}
                    onClick={() => mailbox("connect", email)}
                  >
                    {a ? "Reconnect" : "Connect"} {email}
                  </button>
                  {a && (
                    <>
                      <button
                        className="button"
                        disabled={busy || !a.enabled}
                        onClick={() => mailbox("sync", undefined, a.id)}
                      >
                        Sync now
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          mailbox(
                            a.enabled ? "pause" : "resume",
                            undefined,
                            a.id,
                          )
                        }
                      >
                        {a.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => mailbox("disconnect", undefined, a.id)}
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          <Field label="Email history status">
            <Select
              value={queueStatus}
              onChange={(e) => {
                setQueueStatus(e.target.value);
                setOffset(0);
              }}
            >
              <option value="Review">Needs review</option>
              <option>Recorded</option>
              <option>Dismissed</option>
              <option>Duplicate</option>
            </Select>
          </Field>
          <h4>
            {queueStatus === "Review" ? "Needs review" : queueStatus} (
            {data.total ?? data.items.length})
          </h4>
          <p>
            Browse emails in pages of 50. Dismiss removes an item from the
            review queue; it does not delete the original email. Dismissed items
            can be restored. Disconnecting removes PMS’s stored mailbox token;
            reviewed expense records remain.
          </p>
          <button className="button" disabled={busy} onClick={load}>
            Refresh review queue
          </button>
          {!data.items.length && <p>No emails in this view.</p>}
          <div className="expense-actions">
            <button
              className="button"
              disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous emails
            </button>
            <span>Page {Math.floor(offset / 50) + 1}</span>
            <button
              className="button"
              disabled={
                busy ||
                offset + data.items.length >= (data.total ?? data.items.length)
              }
              onClick={() => setOffset(offset + 50)}
            >
              Next emails
            </button>
          </div>
          {data.items.map((r) => (
            <article key={r.id} className="expense-heading">
              <div>
                <strong>{r.subject || "(No subject)"}</strong>
                <p>
                  {r.account_email} · {r.received_on} · {r.sender}
                </p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => review(r)}
              >
                {queueStatus === "Review" ? "Review email" : "View email"}
              </button>
            </article>
          ))}
        </>
      )}
      {item && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void approve();
          }}
          className="expense-form"
        >
          <h4>{item.subject}</h4>
          <p>{item.suggestion.warning}</p>
          {!item.gmail_id.startsWith("audit:") && (
            <a
              href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(item.account_email)}#all/${encodeURIComponent(item.gmail_id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open original in Gmail
            </a>
          )}
          {item.gmail_id.startsWith("audit:") && (
            <p>
              This email was included in the original audit. Its local evidence
              reference is {item.gmail_id}.
            </p>
          )}
          {item.payment_id && (
            <p>
              This email is linked to a saved payment. View or edit it in
              Payments.
            </p>
          )}
          {item.subscription_id && (
            <p>
              Linked subscription:{" "}
              {plans.find((p) => p.id === item.subscription_id)?.name ||
                "Saved subscription"}
              . View or edit it in Subscriptions.
            </p>
          )}
          <details>
            <summary>Read email excerpt</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {item.excerpt}
            </pre>
          </details>
          {(item.status || "Review") === "Review" && (
            <>
              <div className="expense-form-grid">
                <Field label="Apply as">
                  <Select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="payment">Confirmed payment</option>
                    <option value="subscription">
                      Subscription status / renewal
                    </option>
                  </Select>
                </Field>
                <Field label="Linked subscription">
                  <Select
                    value={plan}
                    onChange={(e) => {
                      setPlan(e.target.value);
                      const p = plans.find((p) => p.id === e.target.value);
                      if (p) {
                        setVendor(p.vendor);
                        setCategory(p.category);
                      }
                    }}
                  >
                    <option value="">
                      {action === "subscription"
                        ? "Create a new subscription"
                        : "No subscription selected"}
                    </option>
                    {plans
                      .filter((p) => !p.deleted_at)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                {action === "payment" ? (
                  <>
                    <Field label="Vendor">
                      <input
                        required
                        maxLength={160}
                        value={vendor}
                        onChange={(e) => setVendor(e.target.value)}
                      />
                    </Field>
                    <Field label="Amount actually paid (USD)">
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </Field>
                    <Field label="Payment date on receipt">
                      <input
                        required
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={paid}
                        onChange={(e) => setPaid(e.target.value)}
                      />
                    </Field>
                    <Field label="Expense category">
                      <Select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                  </>
                ) : (
                  <>
                    {!plan && (
                      <Field label="Vendor for new subscription">
                        <input
                          required
                          maxLength={160}
                          value={vendor}
                          onChange={(e) => setVendor(e.target.value)}
                        />
                      </Field>
                    )}
                    <Field label="Subscription status">
                      <Select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        {SUBSCRIPTION_STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Confirmed next renewal (optional)">
                      <input
                        type="date"
                        value={renewal}
                        onChange={(e) => setRenewal(e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
              <div className="expense-actions">
                <button className="button primary" disabled={busy}>
                  Approve update
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => approve("dismiss")}
                >
                  Dismiss email
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setItem(null)}
                >
                  Close review
                </button>
              </div>
            </>
          )}
          {item.status && item.status !== "Review" && (
            <div className="expense-actions">
              {item.status === "Dismissed" && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => approve("restore")}
                >
                  Restore to review
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => setItem(null)}
              >
                Close email
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
