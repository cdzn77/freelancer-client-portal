"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseGitHubLink } from "@/lib/github-links";
import type { Task } from "@/lib/types";
import type { StudioContext } from "./studio";
import { Panel, Field } from "./ui";
export function TaskCodeLinks({
  ctx,
  task,
}: {
  ctx: StudioContext;
  task: Task;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const links = ctx.data.task_code_links.filter((l) => l.task_id === task.id);
  return (
    <Panel
      title="GitHub delivery"
      subtitle="Internal project links. Code status does not approve client work or complete the task."
    >
      {links.map((l) => (
        <div className="operation-section" key={l.id}>
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            {String(l.metadata.title || l.url)}
          </a>
          <p>
            {String(l.metadata.state || "Not refreshed")}
            {l.metadata.draft ? " · Draft" : ""}
          </p>
          <small>
            {l.checked_at
              ? `Last checked ${new Date(l.checked_at).toLocaleString()}`
              : "Status has not been checked"}
          </small>
          {Array.isArray(l.metadata.checks) && (
            <ul>
              {l.metadata.checks.map((c, i) => (
                <li key={i}>
                  {String(c.name)}: {String(c.conclusion || c.status)}
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(l.metadata.reviews) && (
            <ul>
              {l.metadata.reviews.map((r, i) => (
                <li key={i}>
                  {String(r.reviewer)}: {String(r.state)}
                </li>
              ))}
            </ul>
          )}
          {Boolean(
            l.metadata.checks_unavailable || l.metadata.reviews_unavailable,
          ) && <p>Some checks or reviews could not be read.</p>}
          {Boolean(
            l.metadata.checks_truncated || l.metadata.reviews_truncated,
          ) && (
            <p>
              Showing the first 100 results; open GitHub for complete history.
            </p>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const { data } = await supabase.auth.getSession();
                const r = await fetch("/api/task-code", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${data.session?.access_token}`,
                  },
                  body: JSON.stringify({ id: l.id }),
                });
                const result = await r.json();
                if (!r.ok) throw Error(result.error);
                await ctx.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh status
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              const r = await supabase
                .from("task_code_links")
                .delete()
                .eq("id", l.id);
              if (r.error) setError(r.error.message);
              else await ctx.refresh();
            }}
          >
            Unlink
          </button>
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setError("");
          setBusy(true);
          try {
            const link = parseGitHubLink(String(new FormData(form).get("url")));
            const r = await supabase
              .from("task_code_links")
              .insert({
                workspace_id: ctx.workspace.id,
                project_id: task.project_id,
                task_id: task.id,
                url: link.url,
              });
            if (r.error) throw r.error;
            form.reset();
            await ctx.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="GitHub issue or pull request URL">
          <input
            name="url"
            type="url"
            required
            placeholder="https://github.com/owner/repository/pull/123"
          />
        </Field>
        <button className="button" disabled={busy}>
          Link to task
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </Panel>
  );
}
