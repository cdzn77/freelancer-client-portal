import { addDays, type TeamCapacity, type TeamTimeOff } from "./work-planning";
export type ScheduleDay = {
  user_id: string;
  work_date: string;
  minutes: number;
};
export type ScheduleStatus = {
  id: string;
  user_id: string;
  status: "paused" | "archived";
  starts_on: string;
  ends_on: string | null;
};
export type SchedulePeriod = "day" | "week" | "month";
export function periodStart(date: string, period: SchedulePeriod) {
  if (period === "month") return date.slice(0, 7) + "-01";
  if (period === "week")
    return addDays(
      date,
      -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7),
    );
  return date;
}
export function periodEnd(start: string, period: SchedulePeriod) {
  if (period !== "month") return addDays(start, period === "week" ? 6 : 0);
  const d = new Date(start + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
export function shiftPeriod(
  start: string,
  period: SchedulePeriod,
  direction: number,
) {
  if (period !== "month")
    return addDays(start, direction * (period === "week" ? 7 : 1));
  const d = new Date(start + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + direction, 1);
  return d.toISOString().slice(0, 10);
}
export function dateRange(start: string, end: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    end < start
  )
    throw new Error("Choose a valid date range.");
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (days.length >= 367)
      throw new Error("Choose a range of one year or less.");
    days.push(d);
  }
  return days;
}
export function scheduleState(
  user: string,
  date: string,
  states: ScheduleStatus[],
) {
  const matches = states.filter(
    (s) =>
      s.user_id === user &&
      s.starts_on <= date &&
      (!s.ends_on || s.ends_on >= date),
  );
  return matches.some((s) => s.status === "archived")
    ? "archived"
    : matches.length
      ? "paused"
      : "active";
}
export function dailyAvailability(
  user: string,
  day: string,
  capacity: TeamCapacity | undefined,
  overrides: ScheduleDay[],
  leave: TeamTimeOff[],
  states: ScheduleStatus[],
) {
  const override = overrides.find(
    (d) => d.user_id === user && d.work_date === day,
  );
  const scheduled =
    override?.minutes ??
    (capacity
      ? capacity.weekdays.includes(new Date(day + "T12:00:00Z").getUTCDay())
        ? capacity.daily_minutes
        : 0
      : null);
  const status = scheduleState(user, day, states);
  const off = leave.some(
    (l) => l.user_id === user && l.starts_on <= day && l.ends_on >= day,
  );
  return {
    scheduled,
    minutes: status !== "active" || off ? 0 : scheduled,
    status,
    off,
    override: !!override,
  };
}
