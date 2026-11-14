"use client";
import { Select } from "./select";
import { ResourceBookings } from "./resource-bookings";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { bookingMinutesOn, bookingInsight } from "@/lib/schedule-insights";
import type { TeamTimeOff } from "@/lib/work-planning";
import { localDate, addDays } from "@/lib/work-planning";
import {
  dailyAvailability,
  dateRange,
  periodStart,
  periodEnd,
  shiftPeriod,
  scheduleState,
  type SchedulePeriod,
} from "@/lib/team-schedule";
import { Panel, Field, Modal } from "./ui";
import { supabase } from "@/lib/supabase";
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hours = (n: number) => `${(n / 60).toFixed(1)}h`;
const dateLabel = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
export function TeamCapacityView({ ctx }: { ctx: StudioContext }) {
  const [period, setPeriod] = useState<SchedulePeriod>("week");
  const [date, setDate] = useState(localDate);
  const [filter, setFilter] = useState("active");
  const [personFilter, setPersonFilter] = useState("all");
  const [edit, setEdit] = useState("");
  const [override, setOverride] = useState("");
  const [leave, setLeave] = useState(false);
  const [editingLeave, setEditingLeave] = useState<TeamTimeOff | null>(null);
  const [manage, setManage] = useState("");
  const [statusChoice, setStatusChoice] = useState("paused");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = ctx.workspace.role === "owner";
  const start = periodStart(date, period),
    end = periodEnd(start, period),
    days = dateRange(start, end);
  const staff = ctx.data.members.filter(
    (m) => m.role !== "client" && (owner || m.user_id === ctx.userId),
  );
  const states = ctx.data.team_schedule_status ?? [],
    overrides = ctx.data.team_schedule_days ?? [];
  const visible = staff.filter(
    (m) =>
      (personFilter === "all" || m.user_id === personFilter) &&
      (filter === "all" ||
        days.some((d) => scheduleState(m.user_id, d, states) === filter)),
  );
  const bookingSummaries = visible.map((m) =>
    bookingInsight(m.user_id, start, end, ctx.data),
  );
  const confirmedHours =
    bookingSummaries.reduce((n, i) => n + i.confirmed, 0) / 60;
  const conflictDays = bookingSummaries.reduce(
    (n, i) => n + i.conflicts.length,
    0,
  );
  const capacity = ctx.data.team_capacity.find((c) => c.user_id === edit);
  const openTasks = ctx.data.tasks.filter((t) => t.status !== "Done");
  const periodLeave = ctx.data.team_time_off.filter(
    (l) =>
      l.starts_on <= end &&
      l.ends_on >= start &&
      (personFilter === "all" || l.user_id === personFilter),
  );
  async function save(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    close?: () => void,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      await ctx.refresh();
      close?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const memberName = (id: string) =>
    staff.find((m) => m.user_id === id)?.display_name || "Team member";
  return (
    <>
      <div className="page-heading schedule-page-heading">
        <div>
          <div className="eyebrow">MAKE ROOM FOR THE WORK</div>
          <h1>{owner ? "Team schedule." : "My schedule."}</h1>
          <p>
            See working availability, planned work, and recorded time for the
            dates you choose.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setError("");
            setEditingLeave(null);
            setLeave(true);
          }}
        >
          Add time off
        </button>
      </div>
      <Panel
        title="Schedule & availability"
        className="capacity-panel"
        bodyClassName="panel-body capacity-body"
        subtitle="Hours and availability for the selected dates."
      >
        <div className="schedule-toolbar">
          <div
            className="schedule-view-switch"
            role="group"
            aria-label="Schedule view"
          >
            {(["day", "week", "month"] as SchedulePeriod[]).map((p) => (
              <button
                type="button"
                key={p}
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {p === "day" ? "Day" : p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </Field>
          <Field label="People">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
              <option value="all">Everyone</option>
            </Select>
          </Field>
          <div className="schedule-actions">
            <button
              className="button"
              aria-label={`Previous ${period}`}
              onClick={() => setDate(shiftPeriod(start, period, -1))}
            >
              Previous <span className="schedule-nav-unit"> {period}</span>
            </button>
            <button className="button" onClick={() => setDate(localDate())}>
              Today
            </button>
            <button
              className="button"
              aria-label={`Next ${period}`}
              onClick={() => setDate(shiftPeriod(start, period, 1))}
            >
              Next <span className="schedule-nav-unit"> {period}</span>
            </button>
          </div>
        </div>
        <h2 className="schedule-period" aria-live="polite">
          {dateLabel(start)}
          {end !== start ? ` to ${dateLabel(end)}` : ""}
        </h2>
        <details className="schedule-help">
          <summary>How these hours work</summary>
          <p className="muted">
            Availability is working time after days off and pauses. Planned
            hours use open task estimates due in this period. Logged hours are
            recorded time, shown separately. People are filtered by their status
            during the selected dates.
          </p>
        </details>
        {staff.length > 1 && (
          <Field label="Team member">
            <Select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
            >
              <option value="all">Everyone ({staff.length})</option>
              {staff.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <p className="muted">
          {visible.length} {visible.length === 1 ? "person" : "people"} in this
          view. Each schedule below is calculated separately.
        </p>
        {!visible.length && (
          <p role="status">
            No team members match this view. Choose Everyone to manage paused or
            archived people.
          </p>
        )}
        {visible.map((m) => {
          const c = ctx.data.team_capacity.find((c) => c.user_id === m.user_id);
          const daily = days.map((d) => ({
            day: d,
            ...dailyAvailability(
              m.user_id,
              d,
              c,
              overrides,
              ctx.data.team_time_off,
              states,
            ),
          }));
          const unknown = daily.some((d) => d.minutes === null);
          const available = daily.reduce((n, d) => n + (d.minutes ?? 0), 0);
          const planned = openTasks
            .filter(
              (t) =>
                t.assignee_id === m.user_id &&
                t.due_date >= start &&
                t.due_date <= end,
            )
            .reduce(
              (n, t) => n + (t.remaining_minutes ?? t.estimated_minutes ?? 0),
              0,
            );
          const logged = ctx.data.time_entries
            .filter(
              (t) =>
                t.created_by === m.user_id &&
                t.entry_date >= start &&
                t.entry_date <= end,
            )
            .reduce((n, t) => n + t.minutes, 0);
          const offDays = daily.filter((d) => d.off).length;
          return (
            <article className="schedule-person" key={m.user_id}>
              <div className="schedule-person-heading">
                <div>
                  <h3>{m.display_name}</h3>
                  <p className="muted">
                    {dateLabel(start)}
                    {end !== start ? ` to ${dateLabel(end)}` : ""}
                  </p>
                </div>
                <details className="schedule-person-tools">
                  <summary>Edit availability</summary>
                  <div className="schedule-actions">
                    <button
                      className="button small"
                      onClick={() => {
                        setError("");
                        setEdit(m.user_id);
                      }}
                    >
                      Regular hours
                    </button>
                    <button
                      className="button small"
                      onClick={() => {
                        setError("");
                        setOverride(m.user_id);
                      }}
                    >
                      Adjust dates
                    </button>
                    {owner && (
                      <button
                        className="button small"
                        onClick={() => {
                          setError("");
                          setManage(m.user_id);
                          setStatusChoice("paused");
                        }}
                      >
                        Manage availability
                      </button>
                    )}
                  </div>
                </details>
              </div>
              <dl className="schedule-metrics">
                <div>
                  <dt>Available</dt>
                  <dd>{unknown ? "Not fully set" : hours(available)}</dd>
                </div>
                <div>
                  <dt>Planned</dt>
                  <dd>{hours(planned)}</dd>
                </div>
                <div>
                  <dt>Logged</dt>
                  <dd>{hours(logged)}</dd>
                </div>
                <div>
                  <dt>Time off</dt>
                  <dd>
                    {offDays} {offDays === 1 ? "day" : "days"}
                  </dd>
                </div>
                <div>
                  <dt>
                    {planned > available ? "Over capacity" : "Room for work"}
                  </dt>
                  <dd>
                    {unknown
                      ? "Set hours first"
                      : hours(Math.abs(available - planned))}
                  </dd>
                </div>
              </dl>
              <details className="schedule-daily-details">
                <summary>
                  View daily schedule{" "}
                  <span>
                    {days.length} {days.length === 1 ? "day" : "days"}
                  </span>
                </summary>
                <div className="schedule-days">
                  {daily.map((d) => (
                    <button
                      type="button"
                      key={d.day}
                      className="schedule-day"
                      onClick={() => {
                        setError("");
                        setOverride(m.user_id);
                        setDate(d.day);
                        setPeriod("day");
                      }}
                      aria-label={`Adjust ${memberName(m.user_id)}, ${dateLabel(d.day)}`}
                    >
                      <span>
                        {new Date(d.day + "T12:00:00Z").toLocaleDateString(
                          "en-US",
                          {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            timeZone: "UTC",
                          },
                        )}
                      </span>
                      <strong>
                        {d.status !== "active"
                          ? d.status === "paused"
                            ? "Paused"
                            : "Archived"
                          : d.off
                            ? "Time off"
                            : d.minutes === null
                              ? "Not set"
                              : hours(d.minutes)}
                      </strong>
                      <small>
                        {d.override ? "Custom hours" : "Regular schedule"}
                      </small>
                    </button>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
        <details>
          <summary>Planning gaps</summary>
          <p className="muted">
            {openTasks.filter((t) => !t.assignee_id).length} unassigned tasks ·{" "}
            {openTasks.filter((t) => !t.due_date).length} undated tasks ·{" "}
            {
              openTasks.filter(
                (t) => t.remaining_minutes == null && !t.estimated_minutes,
              ).length
            }{" "}
            tasks without an estimate. These are not a complete forecast of the
            team's work.
          </p>
        </details>
      </Panel>
      {owner && (
        <details className="schedule-secondary">
          <summary>
            <span>
              <strong>Resource bookings</strong>
              <small>
                {confirmedHours.toFixed(1)}h confirmed · {conflictDays}{" "}
                person-days over capacity
              </small>
            </span>
            <span>
              {
                ctx.data.resource_bookings.filter(
                  (b) =>
                    b.starts_on <= end &&
                    b.ends_on >= start &&
                    visible.some((m) => m.user_id === b.user_id),
                ).length
              }{" "}
              bookings
            </span>
          </summary>
          <ResourceBookings
            ctx={{ ...ctx, data: { ...ctx.data, members: visible } }}
            start={start}
            end={end}
          />
        </details>
      )}
      <details className="schedule-secondary">
        <summary>
          <span>
            <strong>Time off</strong>
            <small>Days away in this period</small>
          </span>
          <span>
            {new Set(periodLeave.map((l) => l.user_id)).size}{" "}
            {new Set(periodLeave.map((l) => l.user_id)).size === 1
              ? "person"
              : "people"}{" "}
            · {periodLeave.length}{" "}
            {periodLeave.length === 1 ? "entry" : "entries"}
          </span>
        </summary>
        <Panel
          title="Time off for this period"
          className="capacity-panel"
          bodyClassName="panel-body capacity-body"
          subtitle="Full days away. Overlapping entries count each day once."
        >
          <button
            className="button small"
            onClick={() => {
              setEditingLeave(null);
              setError("");
              setLeave(true);
            }}
          >
            Add time off
          </button>
          {!periodLeave.length && (
            <div className="schedule-empty">
              <strong>No days away in this period</strong>
              <p>
                Add planned leave to reduce availability and reveal booking
                conflicts.
              </p>
              {ctx.data.team_time_off
                .filter((l) => l.starts_on > end)
                .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
                .slice(0, 1)
                .map((l) => (
                  <p key={l.id}>
                    Next: {memberName(l.user_id)}, {dateLabel(l.starts_on)}.{" "}
                    <button
                      className="text-button"
                      onClick={() => setDate(l.starts_on)}
                    >
                      View dates
                    </button>
                  </p>
                ))}
            </div>
          )}
          {periodLeave.map((l) => {
            const affected = dateRange(
              l.starts_on > start ? l.starts_on : start,
              l.ends_on < end ? l.ends_on : end,
            );
            const c = ctx.data.team_capacity.find(
              (c) => c.user_id === l.user_id,
            );
            const baseline = affected.map((d) =>
              dailyAvailability(l.user_id, d, c, overrides, [], states),
            );
            const unknown = baseline.some((d) => d.minutes === null);
            const lost = baseline.reduce((n, d) => n + (d.minutes ?? 0), 0);
            const impacted = ctx.data.resource_bookings.filter(
              (b) =>
                b.user_id === l.user_id &&
                affected.some((d) => bookingMinutesOn(b, d, ctx.data) > 0),
            );
            const due = openTasks.filter(
              (t) =>
                t.assignee_id === l.user_id &&
                t.due_date >= affected[0] &&
                t.due_date <= affected[affected.length - 1],
            );
            const today = localDate();
            return (
              <article className="schedule-insight" key={l.id}>
                <div className="schedule-person-heading">
                  <h3>{memberName(l.user_id)}</h3>
                  <span className="badge">
                    {l.ends_on < today
                      ? "Past leave"
                      : l.starts_on > today
                        ? "Upcoming"
                        : "Away now"}
                  </span>
                </div>
                <p>
                  {dateLabel(l.starts_on)} to {dateLabel(l.ends_on)}
                </p>
                <p>
                  <strong>
                    {unknown
                      ? "Working hours not fully set"
                      : `${hours(lost)} unavailable in this period`}
                  </strong>{" "}
                  · {affected.length} calendar{" "}
                  {affected.length === 1 ? "day" : "days"}
                </p>
                <p className="muted">
                  {unknown
                    ? "Set regular hours to calculate the capacity impact."
                    : "Non-working days and pauses add no lost capacity. Overlapping leave is counted once in the schedule totals."}
                </p>
                {impacted.length || due.length ? (
                  <details className="schedule-conflicts">
                    <summary>
                      {impacted.length}{" "}
                      {impacted.length === 1 ? "booking" : "bookings"} and{" "}
                      {due.length} due tasks need review
                    </summary>
                    {impacted.map((b) => (
                      <p key={b.id}>
                        {ctx.data.projects.find((p) => p.id === b.project_id)
                          ?.name ?? "Project"}
                        :{" "}
                        {hours(
                          affected.reduce(
                            (n, d) => n + bookingMinutesOn(b, d, ctx.data),
                            0,
                          ),
                        )}{" "}
                        {b.tentative ? "tentative" : "confirmed"} during leave.{" "}
                        <button
                          className="text-button"
                          onClick={() =>
                            ctx.selectProject(b.project_id, "Tasks")
                          }
                        >
                          View project
                        </button>
                      </p>
                    ))}
                    {due.map((t) => (
                      <p key={t.id}>
                        {t.title} · due {dateLabel(t.due_date)}{" "}
                        <button
                          className="text-button"
                          onClick={() => ctx.openTask(t)}
                        >
                          Review task
                        </button>
                      </p>
                    ))}
                  </details>
                ) : (
                  <p className="muted">
                    No visible bookings or due tasks overlap these dates.
                  </p>
                )}
                <div className="schedule-actions">
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() => {
                      setEditingLeave(l);
                      setError("");
                      setLeave(true);
                    }}
                  >
                    Edit dates
                  </button>
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() =>
                      save(() =>
                        supabase
                          .from("team_time_off")
                          .delete()
                          .eq("workspace_id", ctx.workspace.id)
                          .eq("id", l.id),
                      )
                    }
                  >
                    Remove time off
                  </button>
                </div>
              </article>
            );
          })}
        </Panel>
      </details>
      {error && <p role="alert">{error}</p>}
      <Modal
        open={!!edit}
        onClose={() => !busy && setEdit("")}
        title={`Regular hours: ${memberName(edit)}`}
        description="Set the repeating workweek. Use Adjust dates for a specific day, week, or month. Updating this default also changes past dates without custom hours."
      >
        <form
          key={edit}
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save(
              () =>
                supabase.from("team_capacity").upsert({
                  workspace_id: ctx.workspace.id,
                  user_id: edit,
                  daily_minutes: Math.round(Number(f.get("hours")) * 60),
                  weekdays: f.getAll("day").map(Number),
                }),
              () => setEdit(""),
            );
          }}
        >
          <Field label="Hours per working day">
            <input
              name="hours"
              type="number"
              min="0"
              max="24"
              step="0.25"
              required
              defaultValue={capacity ? capacity.daily_minutes / 60 : undefined}
            />
          </Field>
          <fieldset>
            <legend>Working days</legend>
            {weekdays.map((d, i) => (
              <label className="workflow-check" key={d}>
                <input
                  type="checkbox"
                  name="day"
                  value={i}
                  defaultChecked={capacity?.weekdays.includes(i) ?? false}
                />
                {d}
              </label>
            ))}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save regular hours
          </button>
        </form>
      </Modal>
      <Modal
        open={!!override}
        onClose={() => !busy && setOverride("")}
        title={`Adjust dates: ${memberName(override)}`}
        description="Set hours for selected dates. Choose one day, a week, or a whole month. These hours replace the regular schedule for those dates. Time off and pauses still apply."
      >
        <form
          key={`${override}-${start}-${end}`}
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const selected = dateRange(
                String(f.get("start")),
                String(f.get("end")),
              ).filter((d) =>
                f
                  .getAll("day")
                  .map(Number)
                  .includes(new Date(d + "T12:00:00Z").getUTCDay()),
              );
              if (!selected.length) throw new Error("Choose at least one day.");
              void save(
                () =>
                  supabase.from("team_schedule_days").upsert(
                    selected.map((d) => ({
                      workspace_id: ctx.workspace.id,
                      user_id: override,
                      work_date: d,
                      minutes: Math.round(Number(f.get("hours")) * 60),
                    })),
                  ),
                () => setOverride(""),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label="First day">
            <input name="start" type="date" required defaultValue={start} />
          </Field>
          <Field label="Last day">
            <input name="end" type="date" required defaultValue={end} />
          </Field>
          <Field label="Hours per selected day">
            <input
              name="hours"
              type="number"
              min="0"
              max="24"
              step="0.25"
              required
            />
          </Field>
          <fieldset>
            <legend>Apply to these weekdays</legend>
            {weekdays.map((d, i) => (
              <label className="workflow-check" key={d}>
                <input name="day" type="checkbox" value={i} defaultChecked />
                {d}
              </label>
            ))}
          </fieldset>
          <p className="muted">
            Use 0 for a non-working day. Other dates keep their existing hours.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="schedule-actions">
            <button className="button primary" disabled={busy}>
              Save dated hours
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                save(
                  () =>
                    supabase
                      .from("team_schedule_days")
                      .delete()
                      .eq("workspace_id", ctx.workspace.id)
                      .eq("user_id", override)
                      .gte("work_date", start)
                      .lte("work_date", end),
                  () => setOverride(""),
                )
              }
            >
              Reset displayed period to regular hours
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={leave}
        onClose={() => !busy && setLeave(false)}
        title={editingLeave ? "Edit time off" : "Add time off"}
        description="Both dates are included. No personal reason is required."
      >
        <form
          key={editingLeave?.id ?? "new"}
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              dateRange(String(f.get("start")), String(f.get("end")));
              void save(
                () =>
                  supabase.from("team_time_off").upsert({
                    ...(editingLeave ? { id: editingLeave.id } : {}),
                    workspace_id: ctx.workspace.id,
                    user_id: f.get("user"),
                    starts_on: f.get("start"),
                    ends_on: f.get("end"),
                  }),
                () => setLeave(false),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field label="Team member">
            <Select name="user" required defaultValue={editingLeave?.user_id}>
              {staff.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="First day">
            <input
              name="start"
              type="date"
              required
              defaultValue={editingLeave?.starts_on ?? start}
            />
          </Field>
          <Field label="Last day">
            <input
              name="end"
              type="date"
              required
              defaultValue={editingLeave?.ends_on ?? end}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save time off
          </button>
        </form>
      </Modal>
      <Modal
        open={!!manage}
        onClose={() => !busy && setManage("")}
        title={`Manage availability: ${memberName(manage)}`}
        description="Pause someone temporarily or archive them from future planning. This preserves their records and does not remove their PMS access."
      >
        <form
          key={manage}
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const first = String(f.get("start")),
              last = String(f.get("end") || "");
            if (last && last < first) {
              setError("The last day must be on or after the first day.");
              return;
            }
            void save(
              () =>
                supabase.from("team_schedule_status").insert({
                  workspace_id: ctx.workspace.id,
                  user_id: manage,
                  status: statusChoice,
                  starts_on: first,
                  ends_on: statusChoice === "paused" && last ? last : null,
                }),
              () => setManage(""),
            );
          }}
        >
          <Field label="Planning status">
            <Select
              value={statusChoice}
              onChange={(e) => setStatusChoice(e.target.value)}
            >
              <option value="paused">Pause availability</option>
              <option value="archived">Archive from schedule</option>
            </Select>
          </Field>
          <Field label="Effective from">
            <input
              name="start"
              type="date"
              required
              defaultValue={localDate()}
            />
          </Field>
          {statusChoice === "paused" && (
            <Field label="Last paused day (optional)">
              <input name="end" type="date" />
            </Field>
          )}
          <p className="muted">
            A dated pause ends automatically. Existing tasks and bookings stay
            assigned so you can review and reassign the work.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save availability status
          </button>
        </form>
        <div className="capacity-body">
          {states
            .filter((s) => s.user_id === manage)
            .map((s) => (
              <div className="workflow-row" key={s.id}>
                <span>
                  {s.status === "paused" ? "Paused" : "Archived"}:{" "}
                  {dateLabel(s.starts_on)} to{" "}
                  {s.ends_on ? dateLabel(s.ends_on) : "ongoing"}
                </span>
                {(!s.ends_on || s.ends_on >= localDate()) && (
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() =>
                      save(() =>
                        s.starts_on >= localDate()
                          ? supabase
                              .from("team_schedule_status")
                              .delete()
                              .eq("workspace_id", ctx.workspace.id)
                              .eq("id", s.id)
                          : supabase
                              .from("team_schedule_status")
                              .update({ ends_on: addDays(localDate(), -1) })
                              .eq("workspace_id", ctx.workspace.id)
                              .eq("id", s.id),
                      )
                    }
                  >
                    End restriction today
                  </button>
                )}
              </div>
            ))}
        </div>
      </Modal>
    </>
  );
}
