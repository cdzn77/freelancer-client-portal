import type { Task } from "./types";
export type TaskFilters = {
  query: string;
  status: string;
  priority: string;
  owner: string;
  due: string;
  layout: string;
};
export const defaultTaskFilters: TaskFilters = {
  query: "",
  status: "All tasks",
  priority: "All priorities",
  owner: "Everyone",
  due: "Any date",
  layout: "List",
};
export type SavedTaskView = {
  id: string;
  name: string;
  scope: string;
  filters: TaskFilters;
};
export type TaskRecurrence = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  priority: string;
  assignee_id: string | null;
  estimated_minutes: number;
  cadence: string;
  timezone: string;
  starts_on: string;
  next_on: string;
  enabled: boolean;
  last_error: string | null;
};
export type TeamCapacity = {
  user_id: string;
  daily_minutes: number;
  weekdays: number[];
};
export type TeamTimeOff = {
  id: string;
  user_id: string;
  starts_on: string;
  ends_on: string;
};
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function matchesTask(
  task: Task,
  filters: TaskFilters,
  userId: string,
  today: string,
) {
  return (
    task.title.toLowerCase().includes(filters.query.toLowerCase()) &&
    (filters.status === "All tasks" || task.status === filters.status) &&
    (filters.priority === "All priorities" ||
      task.priority === filters.priority) &&
    (filters.owner === "Everyone" ||
      (filters.owner === "Me"
        ? task.assignee_id === userId
        : filters.owner === "Unassigned"
          ? !task.assignee_id
          : task.assignee_id === filters.owner)) &&
    (filters.due === "Any date" ||
      (filters.due === "No date"
        ? !task.due_date
        : filters.due === "Overdue"
          ? !!task.due_date && task.due_date < today && task.status !== "Done"
          : !!task.due_date &&
            task.due_date >= today &&
            task.due_date <= addDays(today, 6)))
  );
}
export function availableMinutes(
  start: string,
  capacity: TeamCapacity,
  leave: TeamTimeOff[],
) {
  return Array.from({ length: 7 }, (_, n) => addDays(start, n)).reduce(
    (sum, day) =>
      sum +
      (capacity.weekdays.includes(new Date(day + "T12:00:00Z").getUTCDay()) &&
      !leave.some(
        (l) =>
          l.user_id === capacity.user_id &&
          l.starts_on <= day &&
          l.ends_on >= day,
      )
        ? capacity.daily_minutes
        : 0),
    0,
  );
}
