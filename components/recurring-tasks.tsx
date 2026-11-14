"use client";
import { Select } from "./select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { Field, Modal, Badge, Empty } from "./ui";
import { managesProject } from "./access";
import { localDate, type TaskRecurrence } from "@/lib/work-planning";
export function RecurringTasks({
  ctx,
  projectId,
  onClose,
}: {
  ctx: StudioContext;
  projectId?: string;
  onClose: () => void;
}) {
  const [edit, setEdit] = useState<TaskRecurrence | null>(null),
    [remove, setRemove] = useState<TaskRecurrence | null>(null),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const projects = ctx.data.projects.filter(
    (p) =>
      !p.archived_at &&
      !p.deleted_at &&
      managesProject(ctx, p.id) &&
      (!projectId || p.id === projectId),
  );
  const schedules = ctx.data.task_recurrences.filter(
    (r) => !projectId || r.project_id === projectId,
  );
  async function pause(r: TaskRecurrence) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("pause_task_recurrence", {
        recurrence: r.id,
        paused: r.enabled,
      });
      if (error) throw error;
      await ctx.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Recurring tasks"
      onClose={onClose}
      description="Create a fresh task on each scheduled date. Existing tasks stay independent. Schedules run every 15 minutes without this page open."
    >
      <p>
        Missed dates are skipped after a pause or outage. Monthly schedules
        return to their original day after shorter months. Archived projects do
        not generate tasks.
      </p>
      {!schedules.length && <Empty title="No recurring tasks yet" />}
      {schedules.map((r) => (
        <div key={r.id} className="workflow-row">
          <div>
            <strong>{r.title}</strong>
            <p>
              {ctx.data.projects.find((p) => p.id === r.project_id)?.name} ·{" "}
              {r.cadence} · {r.timezone}
            </p>
            <p>Next scheduled date: {r.next_on}</p>
            {r.last_error && <p role="alert">{r.last_error}</p>}
          </div>
          <Badge>{r.enabled ? "Active" : "Paused"}</Badge>
          {managesProject(ctx, r.project_id) && (
            <>
              <button
                className="button small"
                disabled={busy}
                onClick={() => pause(r)}
              >
                {r.enabled ? "Pause" : "Resume"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setEdit(r);
                  setCreating(true);
                  setError("");
                }}
              >
                Edit schedule
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setRemove(r);
                  setError("");
                }}
              >
                Delete schedule
              </button>
            </>
          )}
        </div>
      ))}
      {projects.length > 0 && !creating && (
        <button
          className="button primary"
          onClick={() => {
            setEdit(null);
            setCreating(true);
          }}
        >
          New recurring task
        </button>
      )}
      {creating && (
        <form
          key={edit?.id || "new"}
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const { error } = await supabase.rpc("save_task_recurrence", {
                project: f.get("project"),
                title: f.get("title"),
                description: f.get("description"),
                priority: f.get("priority"),
                assignee: f.get("assignee") || null,
                estimated_minutes: Number(f.get("estimate")),
                cadence: f.get("cadence"),
                timezone: f.get("timezone"),
                starts_on: f.get("start") || null,
                recurrence: edit?.id || null,
              });
              if (error) throw error;
              await ctx.refresh();
              setCreating(false);
              ctx.notify("Recurring schedule saved");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{edit ? "Edit recurring task" : "New recurring task"}</h3>
          <Field label="Project">
            <Select
              name="project"
              required
              defaultValue={edit?.project_id || projectId || ""}
            >
              <option value="" disabled>
                Choose project
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Task title">
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={edit?.title}
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              maxLength={12000}
              defaultValue={edit?.description}
            />
          </Field>
          <div className="workflow-fields">
            <Field label="Repeat">
              <Select name="cadence" defaultValue={edit?.cadence || "weekly"}>
                {["daily", "weekly", "monthly"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={edit ? "Restart from date (optional)" : "First task date"}
            >
              <input
                name="start"
                type="date"
                required={!edit}
                defaultValue={edit ? undefined : localDate()}
              />
              {edit && (
                <span className="muted">
                  Leave blank to keep the next date and original monthly day.
                </span>
              )}
            </Field>
          </div>
          <Field label="Timezone">
            <input
              name="timezone"
              required
              defaultValue={
                edit?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "UTC"
              }
            />
          </Field>
          <div className="workflow-fields">
            <Field label="Priority">
              <Select name="priority" defaultValue={edit?.priority || "Medium"}>
                {["Low", "Medium", "High"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="Estimated minutes per task">
              <input
                name="estimate"
                type="number"
                required
                min={0}
                max={60000}
                defaultValue={edit?.estimated_minutes || 0}
              />
            </Field>
          </div>
          <Field label="Assign to">
            <Select name="assignee" defaultValue={edit?.assignee_id || ""}>
              <option value="">Unassigned</option>
              {ctx.data.members
                .filter((m) => m.role !== "client")
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
            </Select>
          </Field>
          <p className="muted">
            Assignees must have project access. If access is later removed, new
            tasks are left unassigned. Editing changes future tasks only; an
            already-created occurrence is never duplicated.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </form>
      )}
      <Modal
        open={!!remove}
        onClose={() => !busy && setRemove(null)}
        title={`Delete schedule “${remove?.title || ""}”?`}
        description="Future occurrences stop. Tasks already created remain in the project. This schedule cannot be restored; use Pause if you may need it again."
      >
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setRemove(null)}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              if (!remove) return;
              setBusy(true);
              setError("");
              try {
                const { error } = await supabase.rpc("delete_task_recurrence", {
                  recurrence: remove.id,
                });
                if (error) throw error;
                await ctx.refresh();
                setRemove(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete schedule
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </Modal>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
