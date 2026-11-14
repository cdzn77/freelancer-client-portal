"use client";
import { Select } from "./select";
import { FilterSelect } from "./filter-select";
import { RecurringTasks } from "./recurring-tasks";
import { SavedTaskViews } from "./saved-task-views";
import { matchesTask, localDate } from "@/lib/work-planning";
import { DeleteAction } from "./delete-action";
import { useState } from "react";
import {
  Plus,
  List,
  Columns3,
  Search,
  ChevronRight,
  CornerDownRight,
  Link2,
  Check,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react";
import { StudioContext } from "./studio";
import { Badge, Avatar, Empty, Field, Modal, statusTone } from "./ui";
import { Task, dateLabel } from "@/lib/types";
import { supabase } from "@/lib/supabase";
export function WorkView({
  ctx,
  personal = false,
  projectId,
}: {
  ctx: StudioContext;
  personal?: boolean;
  projectId?: string;
}) {
  const { data, workspace, mutate, openTask } = ctx;
  const [view, setView] = useState("List"),
    [recurring, setRecurring] = useState(false),
    [priority, setPriority] = useState("All priorities"),
    [owner, setOwner] = useState("Everyone"),
    [due, setDue] = useState("Any date"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All tasks"),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [dependency, setDependency] = useState<Task | null>(null),
    [template, setTemplate] = useState(false);
  const canEdit = ["owner", "member", "contractor"].includes(workspace.role);
  const base = data.tasks.filter(
    (t) =>
      (!projectId || t.project_id === projectId) &&
      (!personal || t.assignee_id === ctx.userId),
  );
  const taskFilters = {
    query,
    status: filter,
    priority,
    owner,
    due,
    layout: view,
  };
  const tasks = base.filter((t) =>
    matchesTask(t, taskFilters, ctx.userId, localDate()),
  );
  async function applyTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      t = data.templates.find((t) => t.id === f.get("template"));
    if (!t) return;
    const { error } = await supabase.from("tasks").insert(
      t.tasks.map((title) => ({
        title,
        workspace_id: workspace.id,
        project_id: f.get("project"),
        assignee_id: ctx.userId,
        status: workspace.workflow_states[0],
      })),
    );
    if (error) ctx.notify(error.message);
    else {
      await ctx.refresh();
      setTemplate(false);
      ctx.notify("Template tasks added");
    }
  }
  function row(task: Task, depth = 0): React.ReactNode {
    const children = tasks.filter((t) => t.parent_task_id === task.id),
      isOpen = expanded.has(task.id);
    return (
      <div key={task.id}>
        <div className="work-row">
          <div
            className="work-name"
            style={{ paddingLeft: Math.min(depth, 8) * 16 }}
          >
            {children.length > 0 ? (
              <button
                className={`icon-button tree-toggle ${isOpen ? "expanded" : ""}`}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${task.title}`}
                aria-expanded={isOpen}
                onClick={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(task.id)) n.delete(task.id);
                    else n.add(task.id);
                    return n;
                  })
                }
              >
                <ChevronRight size={14} />
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <button
              className={`check-circle ${task.status === "Done" ? "checked" : ""}`}
              disabled={!canEdit}
              aria-label={`${task.status === "Done" ? "Reopen" : "Complete"} ${task.title}`}
              onClick={() =>
                mutate(
                  "tasks",
                  {
                    status:
                      task.status === "Done"
                        ? workspace.workflow_states[0]
                        : "Done",
                  },
                  task.id,
                )
              }
            >
              <Check size={12} />
            </button>
            <button
              className="task-name"
              onClick={() => openTask(task)}
              disabled={!canEdit}
            >
              <strong>{task.title}</strong>
              {!projectId && (
                <small>
                  {data.projects.find((p) => p.id === task.project_id)?.name}
                </small>
              )}
              {children.length > 0 && <small>{children.length} subtasks</small>}
            </button>
          </div>
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
          <span className="muted">{dateLabel(task.due_date)}</span>
          <Avatar
            userId={task.assignee_id}
            name={
              data.members.find((m) => m.user_id === task.assignee_id)
                ?.display_name || "Unassigned"
            }
          />
          {canEdit && (
            <div className="row-actions">
              <DeleteAction
                ctx={ctx}
                table="tasks"
                id={task.id}
                label={task.title}
                icon
                description="Delete this task and its dependency links. Subtasks are kept as separate tasks."
              />
              <button
                className="icon-button"
                aria-label={`Add subtask to ${task.title}`}
                onClick={() => openTask(undefined, task.project_id, task.id)}
              >
                <CornerDownRight size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Dependencies for ${task.title}`}
                onClick={() => setDependency(task)}
              >
                <Link2 size={16} />
              </button>
            </div>
          )}
        </div>
        {isOpen && children.map((c) => row(c, depth + 1))}
      </div>
    );
  }
  return (
    <>
      {!projectId && (
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE PROGRESS EVERY DAY</div>
            <h1>
              {personal
                ? "Your work, your rhythm."
                : "Every detail, in its place."}
            </h1>
            <p>
              {base.filter((t) => t.status !== "Done").length} open tasks. One
              good place to start.
            </p>
          </div>
          {canEdit && (
            <button className="button primary" onClick={() => openTask()}>
              <Plus size={16} />
              New task
            </button>
          )}
        </div>
      )}
      <SavedTaskViews
        key={`${workspace.id}:${projectId || personal}`}
        ctx={ctx}
        scope={
          projectId ? `project:${projectId}` : personal ? "personal" : "all"
        }
        value={taskFilters}
        onChange={(f) => {
          setQuery(f.query);
          setFilter(f.status);
          setPriority(f.priority);
          setOwner(f.owner);
          setDue(f.due);
          setView(f.layout === "Board" ? "Board" : "List");
        }}
      />
      {recurring && (
        <RecurringTasks
          ctx={ctx}
          projectId={projectId}
          onClose={() => setRecurring(false)}
        />
      )}
      <div className="panel work-panel">
        <div className="view-toolbar">
          <div className="segmented" aria-label="Task view">
            {[
              { name: "List", icon: List },
              { name: "Board", icon: Columns3 },
            ].map((v) => (
              <button
                key={v.name}
                aria-pressed={view === v.name}
                className={view === v.name ? "selected" : ""}
                onClick={() => setView(v.name)}
              >
                <v.icon size={15} />
                {v.name}
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <label className="search-box compact">
              <Search size={15} />
              <input
                aria-label="Search tasks"
                placeholder="Search tasks..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <FilterSelect
              label="Filter tasks by status"
              value={filter}
              onValueChange={setFilter}
              options={["All tasks", ...workspace.workflow_states].map(
                (value) => ({ value, label: value }),
              )}
            />
            <FilterSelect
              label="Filter tasks by priority"
              value={priority}
              onValueChange={setPriority}
              options={["All priorities", "Low", "Medium", "High"].map(
                (value) => ({ value, label: value }),
              )}
            />
            <FilterSelect
              label="Filter tasks by owner"
              value={owner}
              onValueChange={setOwner}
              options={[
                ...["Everyone", "Me", "Unassigned"].map((value) => ({
                  value,
                  label: value,
                })),
                ...data.members
                  .filter((m) => m.role !== "client")
                  .map((m) => ({ value: m.user_id, label: m.display_name })),
              ]}
            />
            <FilterSelect
              label="Filter tasks by due date"
              value={due}
              onValueChange={setDue}
              options={["Any date", "Overdue", "Next 7 days", "No date"].map(
                (value) => ({ value, label: value }),
              )}
            />
            {canEdit && (
              <button className="button" onClick={() => setRecurring(true)}>
                Recurring tasks
              </button>
            )}
            {canEdit && (
              <button className="button" onClick={() => setTemplate(true)}>
                Use template
              </button>
            )}
            {projectId && canEdit && (
              <button
                className="button primary"
                onClick={() => openTask(undefined, projectId)}
              >
                <Plus size={15} />
                Task
              </button>
            )}
          </div>
        </div>
        {view === "List" ? (
          <div className="work-table">
            <div className="work-row table-labels">
              <span>Task name</span>
              <span>Status</span>
              <span>Priority</span>
              <span>Due date</span>
              <span>Owner</span>
              <span />
            </div>
            {tasks
              .filter(
                (t) =>
                  !t.parent_task_id ||
                  !tasks.some((p) => p.id === t.parent_task_id),
              )
              .map((t) => row(t))}
          </div>
        ) : (
          <div className="kanban">
            {workspace.workflow_states.map((s) => (
              <section className="kanban-column" key={s}>
                <div className="column-heading">
                  <Badge tone={statusTone(s)}>{s}</Badge>
                  <span>{tasks.filter((t) => t.status === s).length}</span>
                </div>
                {tasks
                  .filter((t) => t.status === s)
                  .map((t) => (
                    <article className="kanban-card" key={t.id}>
                      <div>
                        <Badge tone={t.priority === "High" ? "rose" : "amber"}>
                          {t.priority}
                        </Badge>
                        <span className="muted">{dateLabel(t.due_date)}</span>
                      </div>
                      <button
                        className="task-name"
                        disabled={!canEdit}
                        onClick={() => openTask(t)}
                      >
                        <strong>{t.title}</strong>
                      </button>
                      <p>
                        {t.description ||
                          data.projects.find((p) => p.id === t.project_id)
                            ?.name}
                      </p>
                      <div className="kanban-card-footer">
                        {canEdit && (
                          <DeleteAction
                            ctx={ctx}
                            table="tasks"
                            id={t.id}
                            label={t.title}
                            icon
                            description="Delete this task and its dependency links. Subtasks are kept as separate tasks."
                          />
                        )}
                        <Avatar
                          userId={t.assignee_id}
                          name={
                            data.members.find(
                              (m) => m.user_id === t.assignee_id,
                            )?.display_name || "Unassigned"
                          }
                        />
                        <Select
                          aria-label={`Status of ${t.title}`}
                          value={t.status}
                          disabled={!canEdit}
                          onChange={(e) =>
                            mutate("tasks", { status: e.target.value }, t.id)
                          }
                        >
                          {workspace.workflow_states.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </Select>
                      </div>
                    </article>
                  ))}
                {canEdit && (
                  <button
                    className="add-task-inline"
                    onClick={() => openTask(undefined, projectId)}
                  >
                    <Plus size={15} />
                    Add task
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
        {!tasks.length && (
          <Empty
            title={
              query ? "No tasks match your search" : "A little breathing room"
            }
          >
            <p>
              {query
                ? "Try a different name or status."
                : "Add a task or start with a reusable template."}
            </p>
          </Empty>
        )}
      </div>
      <Modal
        open={template}
        onClose={() => setTemplate(false)}
        title="A head start on good work"
        description="Add a reusable checklist to a project."
      >
        <form onSubmit={applyTemplate}>
          <Field label="Template">
            <Select name="template" required>
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select name="project" defaultValue={projectId} required>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={!data.templates.length || !data.projects.length}
            >
              Add tasks
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!dependency}
        onClose={() => setDependency(null)}
        title="What needs to happen first?"
        description={dependency?.title}
      >
        <div className="dependency-list">
          {data.dependencies
            .filter((d) => d.task_id === dependency?.id)
            .map((d) => (
              <div key={d.depends_on_id}>
                <Link2 size={15} />
                {data.tasks.find((t) => t.id === d.depends_on_id)?.title}
                <button
                  className="text-button"
                  onClick={async () => {
                    const { error } = await supabase
                      .from("dependencies")
                      .delete()
                      .eq("workspace_id", workspace.id)
                      .eq("task_id", d.task_id)
                      .eq("depends_on_id", d.depends_on_id);
                    if (error) ctx.notify(error.message);
                    else await ctx.refresh();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await mutate("dependencies", {
                task_id: dependency?.id,
                depends_on_id: f.get("depends"),
              })
            )
              ctx.notify("Dependency added");
          }}
        >
          <Field label="This task depends on">
            <Select name="depends" required>
              {data.tasks
                .filter((t) => t.id !== dependency?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="modal-actions">
            <button className="button primary">Add dependency</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
