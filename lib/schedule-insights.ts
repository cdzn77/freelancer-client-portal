import type { Data } from "./types";
import type { ResourceBooking } from "./studio-operations";
import { dailyAvailability, dateRange } from "./team-schedule";
export function bookingMinutesOn(b: ResourceBooking, day: string, data: Data) {
  if (day < b.starts_on || day > b.ends_on) return 0;
  const c = data.team_capacity.find((c) => c.user_id === b.user_id);
  const custom = data.team_schedule_days?.find(
    (d) => d.user_id === b.user_id && d.work_date === day,
  );
  // Keep allocations on regular working days even when custom hours are reduced to zero.
  return !c ||
    c.weekdays.includes(new Date(day + "T12:00:00Z").getUTCDay()) ||
    (custom?.minutes ?? 0) > 0
    ? b.daily_minutes
    : 0;
}
export function bookingInsight(
  user: string,
  start: string,
  end: string,
  data: Data,
) {
  const c = data.team_capacity.find((c) => c.user_id === user);
  const bookings = data.resource_bookings.filter((b) => b.user_id === user);
  const daily = dateRange(start, end).map((day) => {
    const availability = dailyAvailability(
      user,
      day,
      c,
      data.team_schedule_days ?? [],
      data.team_time_off,
      data.team_schedule_status ?? [],
    );

    const tentative = bookings
      .filter((b) => b.tentative)
      .reduce((n, b) => n + bookingMinutesOn(b, day, data), 0);
    const allocations = (data.task_allocations || []).filter(
      (a) =>
        a.user_id === user &&
        a.work_date === day &&
        data.tasks.some((t) => t.id === a.task_id && t.status !== "Done"),
    );
    const projects = new Set([
      ...bookings.map((b) => b.project_id),
      ...allocations.map((a) => a.project_id),
    ]);
    const confirmed = [...projects].reduce(
      (total, project) =>
        total +
        Math.max(
          bookings
            .filter((b) => b.project_id === project && !b.tentative)
            .reduce((n, b) => n + bookingMinutesOn(b, day, data), 0),
          allocations
            .filter((a) => a.project_id === project)
            .reduce((n, a) => n + a.minutes, 0),
        ),
      0,
    );
    return {
      day,
      ...availability,
      confirmed,
      tentative,
      over:
        availability.minutes === null
          ? null
          : Math.max(0, confirmed - availability.minutes),
    };
  });
  return {
    daily,
    confirmed: daily.reduce((n, d) => n + d.confirmed, 0),
    tentative: daily.reduce((n, d) => n + d.tentative, 0),
    available: daily.some((d) => d.minutes === null)
      ? null
      : daily.reduce((n, d) => n + (d.minutes ?? 0), 0),
    conflicts: daily.filter((d) => (d.over ?? 0) > 0),
  };
}
