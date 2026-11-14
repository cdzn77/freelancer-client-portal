"use client";
import { useCallback, useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import type { Task } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Field } from "./ui";
type Choice = { id: string; title: string; status: string };
type Snapshot = {
  required: boolean;
  approved: boolean;
  manager: boolean;
  version: string | null;
  document: string | null;
  reviews: Choice[];
  documents: Choice[];
};
export function TaskCheckpoint({
  ctx,
  task,
  onClose,
}: {
  ctx: StudioContext;
  task: Task;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [required, setRequired] = useState(!!task.approval_required),
    [source, setSource] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (ctx.readOnly) return;
    const r = await supabase.rpc("task_checkpoint_snapshot", {
      p_task: task.id,
    });
    if (r.error) setError(r.error.message);
    else {
      setSnapshot(r.data);
      setRequired(r.data.required);
      setSource(
        r.data.version
          ? `review:${r.data.version}`
          : r.data.document
            ? `document:${r.data.document}`
            : "",
      );
    }
  }, [task.id, ctx.readOnly]);
  useEffect(() => {
    void load();
  }, [
    load,
    task.approval_required,
    task.approval_version_id,
    task.approval_document_id,
  ]);
  if (ctx.readOnly)
    return task.approval_required ? (
      <section aria-label="Approval checkpoint">
        <h3>Approval checkpoint</h3>
        <p>
          Completion requires a recorded approval of the linked agreement or
          review version. This preview cannot submit or change approvals.
        </p>
      </section>
    ) : null;
  if (!snapshot) return error ? <p role="alert">{error}</p> : null;
  if (!snapshot.required && !snapshot.manager) return null;
  const project = ctx.data.projects.find((p) => p.id === task.project_id),
    editable = !project?.archived_at && !project?.deleted_at;
  return (
    <section aria-label="Approval checkpoint">
      <h3>Approval checkpoint</h3>
      {snapshot.required && (
        <>
          <p>
            {snapshot.approved
              ? "Approval recorded. Complete this task when its prerequisites are done."
              : "Waiting for a recorded approval. An ordinary comment, page view or task status is not an approval."}
          </p>
          {snapshot.version && (
            <button
              className="button"
              onClick={() => {
                onClose();
                ctx.selectProject(task.project_id, "Review");
              }}
            >
              Open Review work
            </button>
          )}
          {snapshot.document && (
            <a
              className="button"
              href={`/?workspace=${ctx.workspace.id}&page=Documents%20%26%20payments&clientDocument=${snapshot.document}`}
            >
              Open approval document
            </a>
          )}
          {!snapshot.version && !snapshot.document && (
            <p>
              Your project owner will link the agreement or deliverable version
              here.
            </p>
          )}
          <button className="text-button" onClick={() => void load()}>
            Refresh approval status
          </button>
        </>
      )}
      {snapshot.manager && editable && (
        <details>
          <summary>Configure checkpoint</summary>
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const [kind, id] = source.split(":");
              const r = await supabase.rpc("configure_task_checkpoint", {
                p_task: task.id,
                p_required: required,
                p_version: required && kind === "review" ? id : null,
                p_document: required && kind === "document" ? id : null,
              });
              if (r.error) setError(r.error.message);
              else {
                await ctx.refresh();
                await load();
                ctx.notify("Approval checkpoint saved");
              }
              setBusy(false);
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Require recorded approval before completion
            </label>
            {required && (
              <Field label="Approval source">
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">Link an approval record later</option>
                  {snapshot.reviews.map((r) => (
                    <option key={r.id} value={`review:${r.id}`}>
                      {r.title} ({r.status})
                    </option>
                  ))}
                  {snapshot.documents.map((d) => (
                    <option key={d.id} value={`document:${d.id}`}>
                      {d.title} ({d.status})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p>
              Share the exact agreement or deliverable version first. A reminder
              reaches administrators after three project workdays without
              approval. No invoice or approval is generated automatically.
            </p>
            <button className="button" disabled={busy}>
              Save checkpoint
            </button>
          </form>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
