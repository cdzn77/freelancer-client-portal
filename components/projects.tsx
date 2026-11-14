"use client";
import { useLocationTab } from "@/lib/use-location-tab";
import { ProjectRegisters } from "./project-registers";
import { ProjectPlanning } from "./project-planning";
import { Select } from "./select";
import { TrashTools } from "./trash-tools";
import { ScopeChanges } from "./scope-changes";
import { ProjectPlan } from "./blueprint-details";
import { StudioReviews } from "./studio-reviews";
import { ProjectActions } from "./project-actions";
import { ProjectShape } from "./project-shape";
import { DeleteAction } from "./delete-action";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Grid2X2,
  List,
  CalendarDays,
  ArrowLeft,
  ArrowUpRight,
  Sparkles,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { StudioContext } from "./studio";
import {
  ProjectAccess,
  ProjectDiscussion,
  ProjectFiles,
  managesProject,
} from "./access";
import { WorkView } from "./work";
import { Badge, Empty, Modal, Panel, Progress, statusTone } from "./ui";
import { dateLabel, money } from "@/lib/types";
import { supabase } from "@/lib/supabase";
export function ProjectView({
  ctx,
  selectedId,
  calendarOnly = false,
  initialSection = "Tasks",
  onSectionChange,
}: {
  ctx: StudioContext;
  selectedId?: string;
  calendarOnly?: boolean;
  initialSection?: string;
  onSectionChange?: (section: string) => void;
}) {
  const [scope, setScope] = useLocationTab("projectScope", "Active", [
    "Active",
    "Archived",
    "Trash",
  ]);
  const data = {
    ...ctx.data,
    projects: ctx.data.projects.filter((p) =>
      scope === "Trash"
        ? !!p.deleted_at
        : !p.deleted_at &&
          (scope === "Archived" ? !!p.archived_at : !p.archived_at),
    ),
  };
  const [view, setView] = useLocationTab("projectLayout", "Board", [
      "Board",
      "List",
      "Timeline",
    ]),
    [detailTab, setDetailTab] = useState("Tasks"),
    [health, setHealth] = useState(""),
    [busy, setBusy] = useState(false);
  const project = ctx.data.projects.find((p) => p.id === selectedId);
  const canEdit = project
    ? managesProject(ctx, project.id)
    : ctx.workspace.role === "owner";
  useEffect(() => {
    setHealth("");
    setDetailTab(initialSection);
  }, [selectedId, initialSection]);
  async function summarize() {
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch("/api/health", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.session?.access_token}`,
        },
        body: JSON.stringify({
          workspaceId: ctx.workspace.id,
          projectId: project?.id,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      setHealth(body.summary);
    } catch (e) {
      ctx.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (calendarOnly)
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE PERSPECTIVE</div>
            <h1>Make space for what’s next.</h1>
            <p>Your project deadlines and tasks, together.</p>
          </div>
        </div>
        <Calendar ctx={ctx} />
      </>
    );
  if (project)
    return (
      <>
        <button
          className="text-button back-link"
          onClick={() => ctx.selectProject("")}
        >
          <ArrowLeft size={15} />
          All projects
        </button>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {project.client_name} / {project.type.replaceAll("_", " ")}
            </div>
            <h1>
              {project.name}
              <span className="coral-text">.</span>
            </h1>
            <p>{project.description}</p>
          </div>
          {canEdit && (
            <button className="button" onClick={() => ctx.openProject(project)}>
              Edit project
              <ArrowUpRight size={15} />
            </button>
          )}
        </div>
        <ProjectActions ctx={ctx} project={project} />
        {(project.archived_at || project.deleted_at) && (
          <p role="status">
            {project.deleted_at
              ? "This project is in Trash."
              : "Archived project."}{" "}
            Its history is preserved.
          </p>
        )}
        <div className="project-summary">
          <Badge tone={statusTone(project.status)}>{project.status}</Badge>
          <span>
            <CalendarDays size={15} />
            {dateLabel(project.start_date)} to {dateLabel(project.due_date)}
          </span>
          <span>
            {
              data.tasks.filter(
                (t) => t.project_id === project.id && t.status === "Done",
              ).length
            }{" "}
            of {data.tasks.filter((t) => t.project_id === project.id).length}{" "}
            tasks complete
          </span>
          {ctx.workspace.role === "owner" && (
            <button className="text-button" disabled={busy} onClick={summarize}>
              <Sparkles size={15} />
              {busy ? "Reviewing project..." : "Project health"}
            </button>
          )}
        </div>
        {health && (
          <Panel
            title="Project health"
            className="project-health-panel"
            bodyClassName="panel-body"
            subtitle="Based on this workspace’s project and time records."
          >
            <p className="health-copy">{health}</p>
          </Panel>
        )}
        {ctx.workspace.role === "owner" && (
          <a
            className="button"
            target="_blank"
            rel="noopener noreferrer"
            href={`/client-preview?workspace=${ctx.workspace.id}&project=${project.id}&clientView=Project&clientProject=${project.id}`}
          >
            View as client ↗
          </a>
        )}
        <div
          className="detail-tabs project-section-tabs"
          role="group"
          aria-label="Project sections"
        >
          {[
            "Tasks",
            "Plan",
            ...(canEdit ? ["Scheduling"] : []),
            "Timeline",
            "Calendar",
            "Brief",
            "Discussions",
            "Files",
            "Review",
            "Scope changes",
            "Decisions",
            "Audit findings",
            ...(canEdit ? ["Access"] : []),
          ].map((t) => (
            <button
              key={t}
              aria-pressed={detailTab === t}
              className={detailTab === t ? "active" : ""}
              onClick={() => {
                setDetailTab(t);
                onSectionChange?.(t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {detailTab === "Decisions" && (
          <ProjectRegisters
            key={project.id + "decisions"}
            ctx={ctx}
            projectId={project.id}
            kind="Decision"
          />
        )}
        {detailTab === "Audit findings" && (
          <ProjectRegisters
            key={project.id + "findings"}
            ctx={ctx}
            projectId={project.id}
            kind="Finding"
          />
        )}
        {detailTab === "Access" && canEdit && (
          <ProjectAccess key={project.id} ctx={ctx} project={project} />
        )}
        {detailTab === "Discussions" && (
          <ProjectDiscussion ctx={ctx} project={project} />
        )}
        {detailTab === "Plan" && (
          <ProjectPlan ctx={ctx} projectId={project.id} />
        )}
        {detailTab === "Review" && (
          <StudioReviews key={project.id} ctx={ctx} project={project} />
        )}
        {detailTab === "Files" && <ProjectFiles ctx={ctx} project={project} />}
        {detailTab === "Scope changes" && (
          <ScopeChanges ctx={ctx} projectId={project.id} />
        )}
        {detailTab === "Tasks" && (
          <WorkView key={project.id} ctx={ctx} projectId={project.id} />
        )}{" "}
        {detailTab === "Scheduling" && (
          <ProjectPlanning ctx={ctx} project={project} />
        )}
        {detailTab === "Timeline" && (
          <Timeline ctx={ctx} projectId={project.id} />
        )}{" "}
        {detailTab === "Calendar" && (
          <Calendar ctx={ctx} projectId={project.id} />
        )}{" "}
        {detailTab === "Brief" && (
          <Panel
            title="The bigger picture"
            subtitle="A shared starting point for good work."
          >
            <div className="brief-content">
              {canEdit && project.brief && (
                <DeleteAction
                  ctx={ctx}
                  label="project brief"
                  description="Clear the internal project brief. The project, tasks, and separately approved guest brief stay in place."
                  action={async () => {
                    if (
                      !(await ctx.mutate("projects", { brief: "" }, project.id))
                    )
                      throw Error("Brief could not be removed.");
                  }}
                />
              )}
              <FileText size={28} />
              <p>
                {project.brief ||
                  "Add a project brief to capture the goals, audience, and deliverables."}
              </p>
              {canEdit && (
                <button
                  className="button"
                  onClick={() => ctx.openProject(project)}
                >
                  Edit brief
                </button>
              )}
            </div>
          </Panel>
        )}
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM FIRST IDEA TO FINAL DETAIL</div>
          <h1>
            Good things in the making<span className="coral-text">.</span>
          </h1>
          <p>All your projects, with a little more perspective.</p>
        </div>
        {canEdit && (
          <button className="button primary" onClick={() => ctx.openProject()}>
            <Plus size={17} />
            New project
          </button>
        )}
      </div>
      <div className="view-toolbar standalone">
        <div className="segmented">
          {["Board", "List", "Timeline"].map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              className={view === v ? "selected" : ""}
              onClick={() => setView(v)}
            >
              {v === "Board" ? <Grid2X2 size={15} /> : <List size={15} />} {v}
            </button>
          ))}
        </div>
        <Select
          aria-label="Project archive filter"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          {[
            "Active",
            "Archived",
            ...(ctx.workspace.role === "owner" ? ["Trash"] : []),
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <span className="muted">
          {data.projects.length} projects in your workspace
        </span>
      </div>
      {scope === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="project"
          items={data.projects.map((p) => ({ id: p.id, label: p.name }))}
        />
      )}
      {view === "Timeline" ? (
        <Timeline ctx={{ ...ctx, data }} />
      ) : view === "List" ? (
        <div className="panel">
          <div className="project-table table-labels">
            <span>Project</span>
            <span>Client</span>
            <span>Status</span>
            <span>Due date</span>
            <span>Progress</span>
          </div>
          {data.projects.map((p) => {
            const ts = data.tasks.filter((t) => t.project_id === p.id);
            return (
              <button
                className="project-table"
                key={p.id}
                onClick={() => ctx.selectProject(p.id)}
              >
                <strong>{p.name}</strong>
                <span>{p.client_name}</span>
                <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                <span>{dateLabel(p.due_date)}</span>
                <Progress
                  color={p.color}
                  value={
                    ts.length
                      ? (ts.filter((t) => t.status === "Done").length /
                          ts.length) *
                        100
                      : 0
                  }
                />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="projects-grid">
          {data.projects.map((p, i) => {
            const ts = data.tasks.filter((t) => t.project_id === p.id),
              pct = ts.length
                ? (ts.filter((t) => t.status === "Done").length / ts.length) *
                  100
                : 0;
            return (
              <button
                key={p.id}
                className="project-card"
                onClick={() => ctx.selectProject(p.id)}
              >
                <div
                  className={`project-art art-${p.color}`}
                  aria-hidden="true"
                >
                  <ProjectShape shape={p.shape_id} className="card-shape" />
                  <small>{p.client_name}</small>
                </div>
                <div className="project-card-body">
                  <div className="project-card-top">
                    <small>{p.type.replaceAll("_", " ").toUpperCase()}</small>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.description}</p>
                  <div className="progress-label">
                    <span>
                      {ts.filter((t) => t.status === "Done").length}/{ts.length}{" "}
                      tasks
                    </span>
                    <strong>{Math.round(pct)}%</strong>
                  </div>
                  <Progress color={p.color} value={pct} />
                  <div className="project-card-foot">
                    <span>
                      <CalendarDays size={14} />
                      {dateLabel(p.due_date)}
                    </span>
                    <ArrowUpRight size={18} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!data.projects.length && (
        <Empty
          title={
            scope === "Trash"
              ? "Trash is empty"
              : scope === "Archived"
                ? "No archived projects"
                : "A blank canvas for your next project"
          }
        />
      )}
    </>
  );
}
export function Calendar({
  ctx,
  projectId,
}: {
  ctx: StudioContext;
  projectId?: string;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState<{
    kind: "task" | "project";
    id: string;
  } | null>(null);
  const task =
    selected?.kind === "task"
      ? ctx.data.tasks.find((t) => t.id === selected.id)
      : undefined;
  const detailProject = ctx.data.projects.find(
    (p) =>
      p.id ===
      (task?.project_id || (selected?.kind === "project" ? selected.id : "")),
  );
  const projectTasks = ctx.data.tasks.filter(
    (t) => t.project_id === detailProject?.id && !t.parent_task_id,
  );
  const subtasks = ctx.data.tasks.filter((t) => t.parent_task_id === task?.id);
  const canEditTask = ["owner", "member", "contractor"].includes(
    ctx.workspace.role,
  );
  const year = month.getFullYear(),
    m = month.getMonth(),
    start = new Date(year, m, 1).getDay(),
    count = new Date(year, m + 1, 0).getDate();
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <h2>
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div className="toolbar-right">
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="button"
            onClick={() =>
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div className="calendar-label" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: Math.ceil((start + count) / 7) * 7 }, (_, i) => {
          const day = i - start + 1,
            valid = day > 0 && day <= count,
            key = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return (
            <div key={i} className={`calendar-day ${valid ? "" : "outside"}`}>
              {valid && (
                <>
                  <span
                    className={
                      key === new Date().toISOString().slice(0, 10)
                        ? "today"
                        : ""
                    }
                  >
                    {day}
                  </span>
                  {ctx.data.tasks
                    .filter(
                      (t) =>
                        t.due_date === key &&
                        (!projectId || t.project_id === projectId),
                    )
                    .map((t) => (
                      <button
                        key={t.id}
                        className={`calendar-event ${statusTone(t.status)}`}
                        onClick={() => setSelected({ kind: "task", id: t.id })}
                        aria-haspopup="dialog"
                      >
                        {t.title}
                      </button>
                    ))}
                  {ctx.data.projects
                    .filter(
                      (p) =>
                        p.due_date === key &&
                        (!projectId || p.id === projectId),
                    )
                    .map((p) => (
                      <button
                        key={p.id}
                        className="calendar-event coral"
                        onClick={() =>
                          setSelected({ kind: "project", id: p.id })
                        }
                        aria-haspopup="dialog"
                      >
                        Due: {p.name}
                      </button>
                    ))}
                </>
              )}
            </div>
          );
        })}
      </div>
      {detailProject && (task || selected?.kind === "project") && (
        <Modal
          open
          title={task?.title || detailProject.name}
          description={
            task
              ? `Task details · ${detailProject.name}`
              : "Project deadline and progress"
          }
          onClose={() => setSelected(null)}
        >
          <div className="calendar-detail">
            <Badge tone={statusTone(task?.status || detailProject.status)}>
              {task?.status || detailProject.status}
            </Badge>
            <dl className="calendar-detail-grid">
              <div>
                <dt>Due date</dt>
                <dd>{dateLabel(task?.due_date || detailProject.due_date)}</dd>
              </div>
              {task ? (
                <>
                  <div>
                    <dt>Priority</dt>
                    <dd>{task.priority}</dd>
                  </div>
                  <div>
                    <dt>Assigned to</dt>
                    <dd>
                      {ctx.data.members.find(
                        (m) => m.user_id === task.assignee_id,
                      )?.display_name || "Unassigned"}
                    </dd>
                  </div>
                  {task.phase && (
                    <div>
                      <dt>Phase</dt>
                      <dd>{task.phase}</dd>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <dt>Start date</dt>
                    <dd>{dateLabel(detailProject.start_date)}</dd>
                  </div>
                  <div>
                    <dt>Client</dt>
                    <dd>{detailProject.client_name || "Not specified"}</dd>
                  </div>
                </>
              )}
            </dl>
            <section>
              <h3>Description</h3>
              <p className="workflow-copy">
                {(task ? task.description : detailProject.description) ||
                  "No description added yet."}
              </p>
            </section>
            {!task && (
              <section>
                <h3>Task progress</h3>
                <p>
                  {projectTasks.filter((t) => t.status === "Done").length} of{" "}
                  {projectTasks.length} tasks complete
                </p>
                <Progress
                  value={
                    projectTasks.length
                      ? (projectTasks.filter((t) => t.status === "Done")
                          .length /
                          projectTasks.length) *
                        100
                      : 0
                  }
                />
              </section>
            )}
            {!!subtasks.length && (
              <section>
                <h3>Subtasks</h3>
                <ul className="calendar-detail-subtasks">
                  {subtasks.map((t) => (
                    <li key={t.id}>
                      <span>{t.title}</span>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="calendar-detail-actions">
              <button
                className="button"
                onClick={() => {
                  setSelected(null);
                  ctx.selectProject(detailProject.id);
                }}
              >
                Open project
              </button>
              {task && canEditTask && (
                <button
                  className="button primary"
                  onClick={() => {
                    setSelected(null);
                    ctx.openTask(task);
                  }}
                >
                  Edit task
                </button>
              )}
              {!task && managesProject(ctx, detailProject.id) && (
                <button
                  className="button primary"
                  onClick={() => {
                    setSelected(null);
                    ctx.openProject(detailProject);
                  }}
                >
                  Edit project
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
function Timeline({
  ctx,
  projectId,
}: {
  ctx: StudioContext;
  projectId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = projectId
    ? ctx.data.tasks
        .filter((t) => t.project_id === projectId)
        .map((t) => ({
          id: t.id,
          name: t.title,
          start:
            t.start_date || t.due_date || new Date().toISOString().slice(0, 10),
          end: t.due_date || new Date().toISOString().slice(0, 10),
          status: t.status,
          custom_class: `timeline-${statusTone(t.status)}`,
          progress: t.status === "Done" ? 100 : 0,
          dependencies: ctx.data.dependencies
            .filter((d) => d.task_id === t.id)
            .map((d) => d.depends_on_id)
            .join(","),
        }))
    : ctx.data.projects.map((p) => ({
        id: p.id,
        name: p.name,
        start: p.start_date,
        end: p.due_date || p.start_date,
        status: p.status,
        custom_class: `timeline-${statusTone(p.status)}`,
        progress: (() => {
          const tasks = ctx.data.tasks.filter(
            (t) => t.project_id === p.id && !t.parent_task_id,
          );
          return tasks.length
            ? (tasks.filter((t) => t.status === "Done").length / tasks.length) *
                100
            : 0;
        })(),
      }));
  const signature = JSON.stringify(items);
  useEffect(() => {
    let disposed = false;
    import("frappe-gantt").then(({ default: Gantt }) => {
      if (!disposed && ref.current && items.length) {
        ref.current.innerHTML = "";
        new Gantt(
          ref.current,
          items.map((i) => ({
            ...i,
            name: i.name
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('\"', "&quot;")
              .replaceAll("'", "&#39;"),
          })),
          {
            view_mode: "Week",
            container_height: "auto",
            readonly: true,
            today_button: false,
            bar_height: 30,
            padding: 24,
            popup: false,
          },
        );
      }
    });
    return () => {
      disposed = true;
    };
  }, [signature]);
  return (
    <Panel
      title="The shape of the work"
      subtitle="A timeline of your plans. The list below gives the same dates in text."
    >
      <div className="timeline-legend" aria-label="Timeline status colors">
        <Badge tone="neutral">To do</Badge>
        <Badge tone="amber">In progress / In review</Badge>
        <Badge tone="green">Done</Badge>
      </div>
      <div ref={ref} className="timeline-chart" aria-hidden="true" />
      <div className="timeline-accessible">
        {items.map((i) => (
          <div key={i.id}>
            <strong>{i.name}</strong>
            <Badge tone={statusTone(i.status)}>{i.status}</Badge>
            <span>
              {dateLabel(i.start)} to {dateLabel(i.end)}
            </span>
          </div>
        ))}
      </div>
      {!items.length && <Empty title="Add tasks to see your timeline" />}
    </Panel>
  );
}
