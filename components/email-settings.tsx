"use client";
import { brand } from "../lib/brand";

import { useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { ChevronDown } from "lucide-react";
export function EmailSettings({ ctx }: { ctx: StudioContext }) {
  const [status, setStatus] = useState<{
      configured: boolean;
      sender: string;
      connection: {
        sender: string;
        reply_enabled?: boolean;
        reply_checked_at?: string;
        reply_last_error?: string;
      } | null;
      deliveryEnabled: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [replies, setReplies] = useState(false);
  const enabled =
    ctx.data.email_preferences.find((p) => p.user_id === ctx.userId)?.enabled ||
    false;
  async function api(action?: string) {
    const { data } = await supabase.auth.getSession();
    const r = await fetch(
      action
        ? "/api/email/google"
        : `/api/email/google?workspace=${ctx.workspace.id}`,
      {
        method: action ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${data.session?.access_token}`,
          "Content-Type": "application/json",
        },
        ...(action
          ? {
              body: JSON.stringify({
                workspace: ctx.workspace.id,
                action,
                replies,
              }),
            }
          : {}),
      },
    );
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  }
  useEffect(() => {
    if (ctx.workspace.role === "owner")
      api()
        .then((s) => {
          setStatus(s);
          setReplies(!!s.connection?.reply_enabled);
        })
        .catch((e) => setError(e.message));
  }, [ctx.workspace.id]);
  return (
    <details className="panel email-notifications-accordion">
      <summary>
        <h2>Email notifications</h2>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="panel-body">
        <p className="muted">
          Optional email reminders for new inbox updates. Email contains a
          sign-in link; project details stay inside the PMS.
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              setError("");
              const { error } = await supabase
                .from("email_preferences")
                .upsert({
                  workspace_id: ctx.workspace.id,
                  user_id: ctx.userId,
                  enabled: e.target.checked,
                });
              if (error) setError(error.message);
              else await ctx.refresh();
              setBusy(false);
            }}
          />
          Email me about new updates
        </label>
        {ctx.workspace.role === "owner" && (
          <div className="operation-section">
            <p>
              Sender:{" "}
              <strong>{status?.sender || (brand.email)}</strong>
            </p>
            <p className="muted">
              {!status
                ? "Loading connection…"
                : !status.configured
                  ? "Google connection needs server setup. Delivery is off."
                  : status.connection
                    ? `Google connected. Scheduled delivery is ${status.deliveryEnabled ? "enabled" : "off"}.`
                    : "Connect your Google Workspace mailbox to send notifications."}
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={replies}
                disabled={busy}
                onChange={(e) => setReplies(e.target.checked)}
              />
              Enable reply by email when connecting Google
            </label>
            <p className="muted">
              Email replies require Gmail read access. The worker checks
              notification reply references and imports matching replies from
              the verified recipient. It does not mark mail as read or delete
              it.
            </p>
            {status?.connection && (
              <p>
                Reply by email:{" "}
                {status.connection.reply_enabled
                  ? "connected"
                  : "not connected"}
                {status.connection.reply_checked_at
                  ? `. Last checked ${new Date(status.connection.reply_checked_at).toLocaleString()}`
                  : ""}
              </p>
            )}
            {status?.connection?.reply_last_error && (
              <p role="alert">{status.connection.reply_last_error}</p>
            )}
            <div className="toolbar">
              <button
                className="button"
                disabled={busy || !status?.configured}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api("connect");
                    window.location.assign(r.url);
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                {status?.connection ? "Reconnect Google" : "Connect Google"}
              </button>
              {status?.connection && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api("disconnect");
                      setStatus(await api());
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Disconnect sender
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {ctx.data.studio_email_jobs.length > 0 && (
          <div className="operation-section">
            <h3>Recent delivery activity</h3>
            {ctx.data.studio_email_jobs
              .slice(-10)
              .reverse()
              .map((j) => (
                <p key={j.id}>
                  {new Date(j.created_at).toLocaleString()} · {j.status}
                  {j.last_error && ` — ${j.last_error}`}
                </p>
              ))}
          </div>
        )}
      </div>
    </details>
  );
}
