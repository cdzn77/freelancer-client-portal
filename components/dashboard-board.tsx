"use client";
import { useLocationTab } from "@/lib/use-location-tab";
import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderClosed,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { StudioContext } from "./studio";
import type { Task } from "@/lib/types";
import { dateLabel } from "@/lib/types";
import { Avatar, Empty, Field, Modal } from "./ui";
import { Select } from "./select";
import { ProjectShape } from "./project-shape";

export function CompletionRing({ value }: { value: number }) {
  return (
    <svg className="completion-ring" viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        stroke="var(--line)"
        strokeWidth="3"
      />
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        stroke="var(--obrack-lime)"
        strokeWidth="3"
        pathLength="100"
        strokeDasharray={`${value} 100`}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
function tone(status: string) {
  return status === "Done"
    ? "green"
    : status === "In progress" || status === "In review"
      ? "amber"
      : "neutral";
}
export function DashboardBoard({
  ctx,
  children,
}: {
  ctx: StudioContext;
  children: ReactNode;
}) {
  const [view, setView] = useLocationTab("overview", "summary", [
      "summary",
      "board",
    ]),
    [active, setActive] = useState(""),
    [projectPage, setProjectPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState("");
  const [draftStatus, setDraftStatus] = useState(""),
    [draftPriority, setDraftPriority] = useState("");
  const [detailId, setDetailId] = useState(""),
    [busy, setBusy] = useState(false),
    [limits, setLimits] = useState<Record<string, number>>({});
  const { data } = ctx;
  const projects = data.projects.filter((p) => !p.archived_at && !p.deleted_at);
  const selected = projects.some((p) => p.id === active)
    ? active
    : projects[0]?.id;
  const page = Math.min(
    projectPage,
    Math.max(0, Math.ceil(projects.length / 3) - 1),
  );
  const desktopIds = new Set(
    projects.slice(page * 3, page * 3 + 3).map((p) => p.id),
  );
  const detail = data.tasks.find((t) => t.id === detailId);
  const detailProject = projects.find((p) => p.id === detail?.project_id);
  const canEdit = ["owner", "member", "contractor"].includes(
    ctx.workspace.role,
  );
  const openFilters = () => {
    setDraftStatus(status);
    setDraftPriority(priority);
    setFilterOpen(true);
  };
  const matches = (t: Task) =>
    (!status || t.status === status) && (!priority || t.priority === priority);
  const subProgress = (t: Task) => {
    const rows = data.tasks.filter((s) => s.parent_task_id === t.id);
    return {
      count: rows.length,
      done: rows.filter((s) => s.status === "Done").length,
    };
  };
  return (
    <div className="obrack-dashboard">
      <div className="board-toolbar">
        <div
          className="board-view-switch"
          role="group"
          aria-label="Overview view"
        >
          <button
            aria-pressed={view === "summary"}
            onClick={() => setView("summary")}
          >
            Studio overview
          </button>
          <button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            Project board
          </button>
        </div>
        {view === "board" && (
          <>
            <div className="board-active-filters">
              {status && (
                <button
                  className="board-chip"
                  onClick={() => setStatus("")}
                  aria-label={`Remove status filter ${status}`}
                >
                  {status}
                  <X size={13} />
                </button>
              )}
              {priority && (
                <button
                  className="board-chip"
                  onClick={() => setPriority("")}
                  aria-label={`Remove priority filter ${priority}`}
                >
                  {priority}
                  <X size={13} />
                </button>
              )}
            </div>
            <button className="button board-filter" onClick={openFilters}>
              <SlidersHorizontal size={16} />
              Filter{status || priority ? " · On" : ""}
            </button>
            {projects.length > 3 && (
              <div className="board-pages">
                <button
                  className="icon-button"
                  aria-label="Previous projects"
                  disabled={!page}
                  onClick={() => setProjectPage(page - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {page * 3 + 1}–{Math.min(page * 3 + 3, projects.length)} of{" "}
                  {projects.length}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next projects"
                  disabled={(page + 1) * 3 >= projects.length}
                  onClick={() => setProjectPage(page + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {view === "summary" ? (
        children
      ) : (
        <>
          {!projects.length ? (
            <Empty title="Your next project starts here">
              <p>Create a project to bring its tasks onto your board.</p>
              {ctx.workspace.role === "owner" && (
                <button
                  className="button primary"
                  onClick={() => ctx.openProject()}
                >
                  Create project
                </button>
              )}
            </Empty>
          ) : (
            <>
              <div
                className="board-project-tabs"
                role="group"
                aria-label="Project columns"
              >
                {projects.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={p.id === selected}
                    onClick={() => setActive(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="project-task-board">
                {projects
                  .filter((p) => desktopIds.has(p.id) || p.id === selected)
                  .map((p) => {
                    const tasks = data.tasks.filter(
                      (t) => t.project_id === p.id && !t.parent_task_id,
                    );
                    const filtered = tasks.filter(matches);
                    const percent = tasks.length
                      ? Math.round(
                          (tasks.filter((t) => t.status === "Done").length /
                            tasks.length) *
                            100,
                        )
                      : 0;
                    const limit = limits[p.id] || 8;
                    return (
                      <section
                        key={p.id}
                        className={`project-task-column ${desktopIds.has(p.id) ? "desktop-column" : ""} ${p.id === selected ? "mobile-column" : ""}`}
                        aria-label={`${p.name} tasks`}
                      >
                        <header className="project-column-heading">
                          <button
                            className="project-column-name"
                            onClick={() => ctx.selectProject(p.id)}
                          >
                            <ProjectShape
                              shape={p.shape_id}
                              className="board-project-icon"
                            />
                            <span>{p.name}</span>
                          </button>
                          <span
                            className="column-completion"
                            title={`${percent}% of top-level tasks completed`}
                          >
                            {percent}%<CompletionRing value={percent} />
                          </span>
                          {canEdit && (
                            <button
                              className="board-add"
                              aria-label={`Add task to ${p.name}`}
                              onClick={() => ctx.openTask(undefined, p.id)}
                            >
                              <Plus size={16} />
                            </button>
                          )}
                        </header>
                        <div className="project-ticket-list">
                          {filtered.slice(0, limit).map((t) => {
                            const sub = subProgress(t);
                            const completion = sub.count
                              ? Math.round((sub.done / sub.count) * 100)
                              : t.status === "Done"
                                ? 100
                                : 0;
                            return (
                              <button
                                className="project-ticket"
                                key={t.id}
                                onClick={() => setDetailId(t.id)}
                                aria-label={`View task: ${t.title}`}
                              >
                                <span className="ticket-head">
                                  <span className="ticket-id">
                                    {t.id.slice(0, 8).toUpperCase()}
                                  </span>
                                  <span
                                    className={`ticket-tag ${tone(t.status)}`}
                                  >
                                    {t.status}
                                  </span>
                                </span>
                                <span className="ticket-copy">
                                  <strong>{t.title}</strong>
                                  <span>
                                    {t.description ||
                                      p.description ||
                                      "No description added."}
                                  </span>
                                </span>
                                <span className="ticket-meta">
                                  <span title="Subtasks">
                                    <FolderClosed size={15} />
                                    {sub.count}
                                  </span>
                                  <span title="Completion">
                                    <CompletionRing value={completion} />
                                    {completion}%
                                  </span>
                                  {t.assignee_id && (
                                    <Avatar
                                      userId={t.assignee_id}
                                      name={
                                        data.members.find(
                                          (m) => m.user_id === t.assignee_id,
                                        )?.display_name || "Assigned"
                                      }
                                    />
                                  )}
                                  <span className="ticket-due">
                                    <Clock3 size={15} />
                                    {t.due_date
                                      ? dateLabel(t.due_date)
                                      : "No date"}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {!filtered.length && (
                          <div className="board-empty">
                            <p>
                              {tasks.length
                                ? "No tasks match your filters."
                                : "No tasks yet."}
                            </p>
                            {canEdit && !tasks.length && (
                              <button
                                className="text-button"
                                onClick={() => ctx.openTask(undefined, p.id)}
                              >
                                Add a task <Plus size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {filtered.length > limit && (
                          <button
                            className="button board-load"
                            onClick={() =>
                              setLimits({ ...limits, [p.id]: limit + 8 })
                            }
                          >
                            Show more · {filtered.length - limit} remaining
                          </button>
                        )}
                      </section>
                    );
                  })}
              </div>
              {canEdit && (
                <button
                  className="board-fab"
                  aria-label="Add task to selected project"
                  onClick={() => ctx.openTask(undefined, selected)}
                >
                  <Plus size={26} />
                </button>
              )}
            </>
          )}
        </>
      )}
      <Modal
        title="Filter by"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        description="Focus your board on the work you need."
      >
        <Field label="Status">
          <Select
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {ctx.workspace.workflow_states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select
            value={draftPriority}
            onChange={(e) => setDraftPriority(e.target.value)}
          >
            <option value="">All priorities</option>
            {["Low", "Medium", "High", "Urgent"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <div className="modal-actions">
          <button
            className="button"
            onClick={() => {
              setStatus("");
              setPriority("");
              setFilterOpen(false);
            }}
          >
            Reset
          </button>
          <button
            className="button primary"
            onClick={() => {
              setStatus(draftStatus);
              setPriority(draftPriority);
              setFilterOpen(false);
            }}
          >
            Apply filters
          </button>
        </div>
      </Modal>
      <Modal
        title={detail?.title || "Task details"}
        description={detailProject?.name || "Task information"}
        variant="drawer"
        open={!!detail && !!detailProject}
        onClose={() => setDetailId("")}
      >
        {detail && (
          <>
            <div className="ticket-detail-meta">
              <span>Status</span>
              <span className={`ticket-tag ${tone(detail.status)}`}>
                {detail.status}
              </span>
              <span>Assignee</span>
              <span>
                {data.members.find((m) => m.user_id === detail.assignee_id)
                  ?.display_name || "Unassigned"}
              </span>
              <span>Due date</span>
              <span>
                {detail.due_date ? dateLabel(detail.due_date) : "No date set"}
              </span>
              <span>Priority</span>
              <span>{detail.priority}</span>
            </div>
            <p className="ticket-detail-description">
              {detail.description || "No description added."}
            </p>
            <div className="ticket-detail-subtasks">
              <h3>
                Subtasks{" "}
                <span>
                  {subProgress(detail).done} / {subProgress(detail).count}
                </span>
              </h3>
              {data.tasks
                .filter((t) => t.parent_task_id === detail.id)
                .map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={t.status === "Done"}
                      disabled={!canEdit || busy}
                      onChange={async (e) => {
                        setBusy(true);
                        try {
                          await ctx.mutate(
                            "tasks",
                            {
                              status: e.target.checked
                                ? "Done"
                                : ctx.workspace.workflow_states[0] || "To do",
                            },
                            t.id,
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    <span>{t.title}</span>
                  </label>
                ))}
            </div>
            <div className="modal-actions">
              <button
                className="button"
                onClick={() => {
                  ctx.selectProject(detail.project_id, "Discussions");
                  setDetailId("");
                }}
              >
                Project discussion
              </button>
              {canEdit && (
                <>
                  <button
                    className="button"
                    onClick={() => {
                      ctx.openTask(detail);
                      setDetailId("");
                    }}
                  >
                    Edit task
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || detail.status === "Done"}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (
                          await ctx.mutate(
                            "tasks",
                            { status: "Done" },
                            detail.id,
                          )
                        )
                          setDetailId("");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Check size={16} />
                    Mark done
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
