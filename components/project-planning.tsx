"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Project, Task } from "@/lib/types";
import type { StudioContext } from "./studio";
import { Field, Panel } from "./ui";
import { Select } from "./select";
import { dateRange, dailyAvailability } from "@/lib/team-schedule";
import { bookingInsight } from "@/lib/schedule-insights";
import { TaskCodeLinks } from "./task-code-links";
type Plan = {
  fingerprint: string;
  can_apply: boolean;
  warnings: string[];
  workday_shift: number;
  tasks: {
    id: string;
    title: string;
    old_start: string | null;
    old_due: string | null;
    start: string | null;
    due: string | null;
    fixed: boolean;
  }[];
};
export function ProjectPlanning({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const tasks = ctx.data.tasks.filter((t) => t.project_id === project.id);
  const [id, setId] = useState(tasks[0]?.id || "");
  const task = tasks.find((t) => t.id === id);
  const [start, setStart] = useState(""),
    [due, setDue] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [fingerprint, setFingerprint] = useState(""),
    [days, setDays] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [request, setRequest] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setPlan(null);
    setFingerprint("");
    setStart(task?.start_date || task?.due_date || "");
    setDue(task?.due_date || "");
    setDays(
      Object.fromEntries(
        ctx.data.task_allocations
          .filter((a) => a.task_id === id)
          .map((a) => [a.work_date, a.minutes]),
      ),
    );
    void supabase
      .rpc("get_project_planning", { p_project: project.id })
      .then((r) => {
        if (active) {
          if (r.error) setError(r.error.message);
          else setFingerprint(r.data.fingerprint);
        }
      });
    return () => {
      active = false;
    };
  }, [id, ctx.data, project.id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const r = await supabase.rpc(name, args);
    if (r.error) throw r.error;
    return r.data;
  }
  const range =
    task?.start_date && task.due_date
      ? (() => {
          try {
            return dateRange(task.start_date!, task.due_date);
          } catch {
            return [];
          }
        })()
      : [];
  const sum = Object.values(days).reduce((n, v) => n + v, 0),
    effort = task?.remaining_minutes ?? task?.estimated_minutes ?? 0;
  const logged = ctx.data.time_entries
    .filter((e) => e.task_id === id && e.status !== "Rejected")
    .reduce((n, e) => n + e.minutes, 0);
  return (
    <div className="workflow-stack">
      <Panel
        title="Task schedule and effort"
        subtitle="Preview dependency changes before applying them. Completed and pinned tasks keep their dates."
      >
        <Field label="Task">
          <Select
            aria-label="Task"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setPlan(null);
            }}
          >
            <option value="">Choose task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
        {task && (
          <>
            <p>
              Estimate: {task.estimated_minutes || 0} min · Logged: {logged} min
              {ctx.workspace.role !== "owner"
                ? " (your visible entries)"
                : ""}{" "}
              · Remaining plan: {effort} min
            </p>
            <button className="button" onClick={() => (ctx.editTask || ctx.openTask)(task)}>
              Edit task details
            </button>
            <div className="form-grid">
              <Field label="New start">
                <input
                  type="date"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPlan(null);
                  }}
                />
              </Field>
              <Field label="New due date">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => {
                    setDue(e.target.value);
                    setPlan(null);
                  }}
                />
              </Field>
            </div>
            <button
              className="button"
              disabled={busy || !start || !due}
              onClick={() =>
                run(async () => {
                  setPlan(
                    await rpc("preview_task_schedule", {
                      p_task: id,
                      p_start: start,
                      p_due: due,
                    }),
                  );
                  setRequest(crypto.randomUUID());
                })
              }
            >
              Preview dependent dates
            </button>
            {plan && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Current</th>
                        <th>Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.tasks.map((t) => (
                        <tr key={t.id}>
                          <td>
                            {t.title}
                            {t.fixed ? " (fixed)" : ""}
                          </td>
                          <td>
                            {t.old_start || "No start"} to{" "}
                            {t.old_due || "No due date"}
                          </td>
                          <td>
                            {t.start || "No start"} to {t.due || "No due date"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {plan.warnings.map((w) => (
                  <p key={w} role="status">
                    {w}
                  </p>
                ))}
                <button
                  className="button primary"
                  disabled={busy || !plan.can_apply}
                  onClick={() =>
                    run(async () => {
                      await rpc("apply_task_schedule", {
                        p_task: id,
                        p_start: start,
                        p_due: due,
                        p_fingerprint: plan.fingerprint,
                        p_request: request,
                      });
                      await ctx.refresh();
                      setPlan(null);
                      ctx.notify("Schedule updated");
                    })
                  }
                >
                  Apply this schedule
                </button>
              </>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </Panel>
      {task && (
        <Panel
          title="Daily allocation"
          subtitle="Task allocations sit inside the project's booking envelope. Only effort above that envelope adds capacity demand."
        >
          {!range.length ? (
            <p>
              Add a task start and due date within one year to allocate effort.
            </p>
          ) : (
            <>
              <p>
                {sum} of {effort} minutes allocated. Changes to task dates,
                assignment or effort require clearing allocations first.
              </p>
              <button
                className="button"
                disabled={busy || !task.assignee_id || effort <= 0}
                onClick={() => {
                  const dates = range.filter((day) => {
                    const a = dailyAvailability(
                      task.assignee_id!,
                      day,
                      ctx.data.team_capacity.find(
                        (c) => c.user_id === task.assignee_id,
                      ),
                      ctx.data.team_schedule_days,
                      ctx.data.team_time_off,
                      ctx.data.team_schedule_status,
                    );
                    return a.minutes !== null && a.minutes > 0;
                  });
                  if (!dates.length) {
                    setError("Set working hours before distributing effort");
                    return;
                  }
                  const base = Math.floor(effort / dates.length),
                    remainder = effort % dates.length;
                  setDays(
                    Object.fromEntries(
                      dates.map((d, i) => [d, base + (i < remainder ? 1 : 0)]),
                    ),
                  );
                }}
              >
                Distribute across available workdays
              </button>
              <div className="workflow-day-grid">
                {range.map((day) => {
                  const availability = dailyAvailability(
                    task.assignee_id || "",
                    day,
                    ctx.data.team_capacity.find(
                      (c) => c.user_id === task.assignee_id,
                    ),
                    ctx.data.team_schedule_days,
                    ctx.data.team_time_off,
                    ctx.data.team_schedule_status,
                  );
                  const demand = task.assignee_id
                    ? bookingInsight(task.assignee_id, day, day, ctx.data)
                        .daily[0]
                    : null;
                  return (
                    <Field key={day} label={day}>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        value={days[day] || 0}
                        onChange={(e) =>
                          setDays({ ...days, [day]: Number(e.target.value) })
                        }
                      />
                      <small>
                        {availability.minutes === null
                          ? "Availability unknown"
                          : `${availability.minutes} min available`}
                        {demand?.over
                          ? ` · ${demand.over} min currently overbooked`
                          : ""}
                        {availability.off ? " · Time off" : ""}
                      </small>
                    </Field>
                  );
                })}
              </div>
              <button
                className="button primary"
                disabled={busy || sum !== effort || !fingerprint}
                onClick={() =>
                  run(async () => {
                    await rpc("save_task_allocations", {
                      p_task: id,
                      p_days: Object.entries(days)
                        .filter(([, minutes]) => minutes > 0)
                        .map(([date, minutes]) => ({ date, minutes })),
                      p_fingerprint: fingerprint,
                    });
                    await ctx.refresh();
                    ctx.notify("Daily allocations saved");
                  })
                }
              >
                Save daily allocation
              </button>
              <button
                className="button"
                disabled={busy || !fingerprint}
                onClick={() =>
                  run(async () => {
                    await rpc("save_task_allocations", {
                      p_task: id,
                      p_days: [],
                      p_fingerprint: fingerprint,
                    });
                    await ctx.refresh();
                  })
                }
              >
                Clear allocations
              </button>
            </>
          )}
        </Panel>
      )}
      {task && <TaskCodeLinks ctx={ctx} task={task} />}
      <Panel
        title="Project work calendar"
        subtitle="Dependency shifts use this project calendar. Individual leave remains a capacity warning, not an automatic date change."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              const holidays = String(f.get("holidays") || "")
                .split(/[\s,]+/)
                .filter(Boolean);
              if (holidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))
                throw Error("Use YYYY-MM-DD dates");
              if (
                await ctx.mutate(
                  "projects",
                  { workdays: f.getAll("workdays").map(Number), holidays },
                  project.id,
                )
              ) {
                setPlan(null);
                ctx.notify("Project calendar saved");
              }
            });
          }}
        >
          <div className="toolbar">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
              <label key={d}>
                <input
                  type="checkbox"
                  name="workdays"
                  value={i}
                  defaultChecked={(
                    project.workdays || [1, 2, 3, 4, 5]
                  ).includes(i)}
                />
                {d}
              </label>
            ))}
          </div>
          <Field label="Non-working dates (YYYY-MM-DD, separated by commas)">
            <textarea
              name="holidays"
              defaultValue={project.holidays?.join(", ")}
            />
          </Field>
          <button className="button" disabled={busy}>
            Save work calendar
          </button>
        </form>
      </Panel>
    </div>
  );
}
