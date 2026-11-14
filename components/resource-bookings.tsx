"use client";
import { Select } from "./select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Panel, Field, Modal } from "./ui";
import { supabase } from "@/lib/supabase";
import { addDays } from "@/lib/work-planning";
import { dateRange } from "@/lib/team-schedule";
import { bookingInsight, bookingMinutesOn } from "@/lib/schedule-insights";
import type { ResourceBooking } from "@/lib/studio-operations";
export function ResourceBookings({
  ctx,
  start,
  end = addDays(start, 6),
}: {
  ctx: StudioContext;
  start: string;
  end?: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<ResourceBooking | null>(null);
  const days = dateRange(start, end);
  const periodBookings = ctx.data.resource_bookings.filter(
    (b) =>
      b.starts_on <= end &&
      b.ends_on >= start &&
      ctx.data.members.some((m) => m.user_id === b.user_id),
  );
  const bookedPeople = ctx.data.members.filter((m) =>
    periodBookings.some((b) => b.user_id === m.user_id),
  );
  const teamInsights = bookedPeople.map((m) =>
    bookingInsight(m.user_id, start, end, ctx.data),
  );
  return (
    <Panel
      title="Resource bookings"
      bodyClassName="panel-body"
      className="capacity-panel"
      subtitle="Explicit daily allocations across projects. Tentative bookings are shown separately. Bookings are not added to task estimates, which would count the same work twice."
      action={
        <button
          className="button"
          onClick={() => {
            setEditing(null);
            setError("");
            setOpen(true);
          }}
        >
          Book work
        </button>
      }
    >
      <p className="muted">
        {start} to {end}. Confirmed allocations reserve capacity; tentative
        allocations remain separate from committed work and task estimates.
      </p>
      {periodBookings.length > 0 && (
        <div className="schedule-team-summary">
          <strong>
            {bookedPeople.length}{" "}
            {bookedPeople.length === 1 ? "person" : "people"} booked ·{" "}
            {new Set(periodBookings.map((b) => b.project_id)).size}{" "}
            {new Set(periodBookings.map((b) => b.project_id)).size === 1
              ? "project"
              : "projects"}
          </strong>
          <p>
            {(teamInsights.reduce((n, i) => n + i.confirmed, 0) / 60).toFixed(
              1,
            )}
            h confirmed ·{" "}
            {(teamInsights.reduce((n, i) => n + i.tentative, 0) / 60).toFixed(
              1,
            )}
            h tentative ·{" "}
            {teamInsights.reduce((n, i) => n + i.conflicts.length, 0)}{" "}
            person-days over capacity
          </p>
        </div>
      )}
      {bookedPeople.map((m) => {
        const insight = bookingInsight(m.user_id, start, end, ctx.data);
        return (
          <details
            className="schedule-insight schedule-person-bookings"
            key={m.user_id}
          >
            <summary>
              <strong>{m.display_name}</strong>
              <span>
                {(insight.confirmed / 60).toFixed(1)}h booked ·{" "}
                {insight.conflicts.length
                  ? `${insight.conflicts.length} ${insight.conflicts.length === 1 ? "day" : "days"} over capacity`
                  : insight.available === null
                    ? "Capacity not set"
                    : "Within capacity"}
              </span>
            </summary>
            <dl className="booking-metrics">
              <div>
                <dt>Confirmed</dt>
                <dd>{(insight.confirmed / 60).toFixed(1)}h</dd>
              </div>
              <div>
                <dt>Tentative</dt>
                <dd>{(insight.tentative / 60).toFixed(1)}h</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>
                  {insight.available === null
                    ? "Not set"
                    : `${(insight.available / 60).toFixed(1)}h`}
                </dd>
              </div>
            </dl>
            <p>
              {insight.available === null
                ? "Set working hours above to check capacity."
                : `${(Math.max(0, insight.available - insight.confirmed) / 60).toFixed(1)}h not yet booked in this period.`}
            </p>
            {insight.conflicts.length > 0 ? (
              <details className="schedule-conflicts">
                <summary>
                  {insight.conflicts.length} overbooked{" "}
                  {insight.conflicts.length === 1 ? "day" : "days"} to review
                </summary>
                {insight.conflicts.map((d) => (
                  <p key={d.day}>
                    {d.day}: {(d.confirmed / 60).toFixed(1)}h booked,{" "}
                    {((d.minutes ?? 0) / 60).toFixed(1)}h available
                    {d.off
                      ? " · Time off"
                      : d.status !== "active"
                        ? ` · ${d.status}`
                        : ""}
                    . Move or reassign the affected booking.
                  </p>
                ))}
              </details>
            ) : (
              <p className="muted">
                {insight.available === null
                  ? "Capacity check pending."
                  : "No confirmed daily conflicts for these dates."}
              </p>
            )}
          </details>
        );
      })}
      {!periodBookings.length && (
        <div className="schedule-empty">
          <strong>No project time reserved</strong>
          <p>
            Use Book work to assign a project, person, dates, and daily hours.
            Task estimates do not create bookings automatically.
          </p>
        </div>
      )}
      {periodBookings.length > 0 && (
        <details className="schedule-allocation-list">
          <summary>View {periodBookings.length} project allocations</summary>
          {periodBookings.map((b) => (
            <div className="workflow-row" key={b.id}>
              <div>
                <strong>
                  {ctx.data.projects.find((p) => p.id === b.project_id)?.name}
                </strong>
                <p>
                  {
                    ctx.data.members.find((m) => m.user_id === b.user_id)
                      ?.display_name
                  }{" "}
                  · {b.starts_on}–{b.ends_on} · {b.daily_minutes / 60}h/day ·{" "}
                  {b.tentative ? "Tentative" : "Confirmed"}
                </p>
                <p>
                  <strong>
                    {(
                      days.reduce(
                        (n, d) => n + bookingMinutesOn(b, d, ctx.data),
                        0,
                      ) / 60
                    ).toFixed(1)}
                    h in this period
                  </strong>{" "}
                  ·{" "}
                  {
                    days.filter((d) => bookingMinutesOn(b, d, ctx.data) > 0)
                      .length
                  }{" "}
                  allocated days
                </p>
                {b.note && <p>{b.note}</p>}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => ctx.selectProject(b.project_id, "Tasks")}
                >
                  View project
                </button>
              </div>
              <button
                className="button small"
                disabled={busy}
                onClick={() => {
                  setEditing(b);
                  setError("");
                  setOpen(true);
                }}
              >
                Edit booking
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  const { error } = await supabase
                    .from("resource_bookings")
                    .update({ tentative: !b.tentative })
                    .eq("id", b.id);
                  if (error) setError(error.message);
                  else await ctx.refresh();
                }}
              >
                {b.tentative ? "Confirm" : "Make tentative"}
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  const { error } = await supabase
                    .from("resource_bookings")
                    .delete()
                    .eq("id", b.id);
                  if (error) setError(error.message);
                  else await ctx.refresh();
                }}
              >
                Remove booking
              </button>
            </div>
          ))}
        </details>
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={editing ? "Edit project booking" : "Book project work"}
        description="Allocate daily hours across a date range. Existing tasks and estimates are unchanged."
      >
        <form
          key={editing?.id ?? "new"}
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              dateRange(String(f.get("start")), String(f.get("end")));
              const values = {
                workspace_id: ctx.workspace.id,
                project_id: f.get("project"),
                user_id: f.get("user"),
                starts_on: f.get("start"),
                ends_on: f.get("end"),
                daily_minutes: Math.round(Number(f.get("hours")) * 60),
                tentative: f.get("tentative") === "on",
                note: f.get("note"),
              };
              const { error } = await (editing
                ? supabase
                    .from("resource_bookings")
                    .update(values)
                    .eq("workspace_id", ctx.workspace.id)
                    .eq("id", editing.id)
                : supabase.from("resource_bookings").insert(values));
              if (error) throw error;
              await ctx.refresh();
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Project">
            <Select name="project" required defaultValue={editing?.project_id}>
              {ctx.data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team member">
            <Select name="user" required defaultValue={editing?.user_id}>
              {ctx.data.members
                .filter((m) => m.role !== "client")
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="First day">
            <input
              type="date"
              name="start"
              required
              defaultValue={editing?.starts_on ?? start}
            />
          </Field>
          <Field label="Last day">
            <input
              type="date"
              name="end"
              required
              defaultValue={editing?.ends_on ?? end}
            />
          </Field>
          <Field label="Hours per working day">
            <input
              type="number"
              name="hours"
              defaultValue={editing ? editing.daily_minutes / 60 : undefined}
              min={0.25}
              max={24}
              step={0.25}
              required
            />
          </Field>
          <Field label="Note">
            <input
              name="note"
              maxLength={2000}
              defaultValue={editing?.note ?? ""}
            />
          </Field>
          <label className="workflow-check">
            <input
              type="checkbox"
              name="tentative"
              defaultChecked={editing?.tentative ?? false}
            />
            Tentative allocation
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save booking
          </button>
        </form>
      </Modal>
      {error && !open && <p role="alert">{error}</p>}
    </Panel>
  );
}
