"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Panel, Field } from "./ui";
import { supabase } from "@/lib/supabase";
export function IntakeLinks({ ctx }: { ctx: StudioContext }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Panel
      title="Public intake forms"
      bodyClassName="panel-body"
      subtitle="Share a request form with people who do not have a PMS account. Submissions appear in Requests; anyone with an enabled link can submit."
    >
      {ctx.data.intake_links.map((l) => (
        <article className="operation-section" key={l.id}>
          <strong>{l.title}</strong>
          <p>
            {l.enabled ? "Enabled" : "Disabled"}
            {l.expires_on && ` · Expires ${l.expires_on} (UTC)`}
          </p>
          <div className="toolbar">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/intake/${l.token}`,
                  );
                  ctx.notify("Form link copied");
                } catch {
                  setError(
                    "Unable to copy. Use Open form and copy its address.",
                  );
                }
              }}
            >
              Copy link
            </button>
            <a
              className="button"
              target="_blank"
              rel="noopener noreferrer"
              href={`/intake/${l.token}`}
            >
              Open form
            </a>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { error } = await supabase
                  .from("intake_links")
                  .update({ enabled: !l.enabled })
                  .eq("id", l.id);
                if (error) setError(error.message);
                else await ctx.refresh();
                setBusy(false);
              }}
            >
              {l.enabled ? "Disable link" : "Enable link"}
            </button>
          </div>
        </article>
      ))}
      <form
        className="settings-form operation-section"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget,
            f = new FormData(form);
          const { error } = await supabase
            .from("intake_links")
            .insert({
              workspace_id: ctx.workspace.id,
              title: f.get("title"),
              description: f.get("description"),
              expires_on: f.get("expires") || null,
            });
          if (error) setError(error.message);
          else {
            form.reset();
            await ctx.refresh();
          }
          setBusy(false);
        }}
      >
        <h3>Create a form</h3>
        <Field label="Form title">
          <input name="title" required maxLength={120} />
        </Field>
        <Field label="Introduction">
          <textarea name="description" maxLength={2000} />
        </Field>
        <Field label="Expiry date (optional, UTC)">
          <input name="expires" type="date" />
        </Field>
        <button className="button" disabled={busy}>
          Create form link
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </Panel>
  );
}
