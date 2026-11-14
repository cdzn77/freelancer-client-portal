"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import type { Task } from "@/lib/types";
import { dateLabel } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Modal, Badge, statusTone } from "./ui";
import { DiscussionText } from "./discussion-editor";
import { TaskCheckpoint } from "./task-checkpoint";
import { Discussions } from "./discussions";
export function TaskDetail({
  ctx,
  task,
  onClose,
  onEdit,
}: {
  ctx: StudioContext;
  task: Task;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    project = ctx.data.projects.find((p) => p.id === task.project_id);
  if (!project) return null;
  const client = ctx.workspace.role === "client",
    editable = !ctx.readOnly && !project.archived_at && !project.deleted_at;
  return (
    <Modal
      open
      variant="drawer"
      title={task.title}
      description="Task details and conversation"
      onClose={onClose}
    >
      <div className="task-detail-flat">
        <div className="discussion-heading">
          <div>
            <Badge tone={statusTone(task.status)}>{task.status}</Badge>
            <Badge
              tone={
                task.priority === "High"
                  ? "rose"
                  : task.priority === "Medium"
                    ? "amber"
                    : "green"
              }
            >
              {task.priority}
            </Badge>
            <Badge>
              {task.is_published ? "Shared with clients" : "Internal"}
            </Badge>
          </div>
          {!client && editable && onEdit && (
            <button className="button" onClick={onEdit}>
              Edit task
            </button>
          )}
        </div>
        <dl className="task-detail-facts">
          <div>
            <dt>Assigned to</dt>
            <dd>
              {ctx.data.members.find((m) => m.user_id === task.assignee_id)
                ?.display_name || "Unassigned"}
            </dd>
          </div>
          <div>
            <dt>Due date</dt>
            <dd>{dateLabel(task.due_date)}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{project.name}</dd>
          </div>
        </dl>
        <section aria-label="Task description">
          <h3>Description</h3>
          {task.description ? (
            <DiscussionText text={task.description} />
          ) : (
            <p className="muted">No description yet.</p>
          )}
        </section>
        <TaskCheckpoint ctx={ctx} task={task} onClose={onClose} />
        {client && task.assignee_id === ctx.userId && (
          <label className="task-status-control">
            Your task status{" "}
            <select
              aria-label="Your task status"
              value={task.status}
              disabled={!editable || busy}
              onChange={async (e) => {
                setBusy(true);
                const r = await supabase.rpc("client_task_status", {
                  p_task: task.id,
                  p_status: e.target.value,
                });
                if (r.error) ctx.notify(r.error.message);
                else await ctx.refresh();
                setBusy(false);
              }}
            >
              {ctx.workspace.workflow_states
                .filter(
                  (s) =>
                    ["To do", "In progress", "Done"].includes(s) ||
                    s === task.status,
                )
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </label>
        )}
        {!client && editable && (
          <a
            className="button"
            href={`/?workspace=${ctx.workspace.id}&page=Time%20tracking&timerTask=${task.id}`}
          >
            Track time for this task
          </a>
        )}
        <Discussions key={task.id} ctx={ctx} project={project} task={task} />
      </div>
    </Modal>
  );
}
