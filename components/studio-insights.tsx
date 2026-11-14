"use client";
import { TrashTools } from "./trash-tools";
import { StudioItemActions, StudioItemFilter } from "./studio-item-actions";
import { inStudioView, type StudioItemView } from "@/lib/studio-workflows";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/types";
import { Badge, Empty, Panel } from "./ui";
import {
  notificationDestination,
  type StudioNotification,
} from "@/lib/studio-workflows";
import { askStudioAI } from "./studio-intake";
export function InboxView({
  ctx,
  onOpenRequest,
}: {
  ctx: StudioContext;
  onOpenRequest: (id: string) => void;
}) {
  const [view, setView] = useState<StudioItemView>("Active");
  const [all, setAll] = useState(false),
    [busy, setBusy] = useState(false);
  const notifications = ctx.data.studio_notifications
    .filter(
      (n) => inStudioView(n, view) && (view !== "Active" || all || !n.read_at),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  function destination(n: StudioNotification) {
    const target = notificationDestination(n);
    if (target?.kind === "document") return target;
    if (
      target?.kind === "request" &&
      ctx.data.work_requests.some((r) => r.id === target.id)
    )
      return target;
    if (
      target?.kind === "project" &&
      ctx.data.projects.some((p) => p.id === target.id)
    )
      return target;
    return null;
  }
  async function openNotification(n: StudioNotification) {
    const target = destination(n);
    if (!target) return;
    setBusy(true);
    try {
      if (!n.read_at) {
        const { error } = await supabase
          .from("studio_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", n.id);
        if (error)
          ctx.notify("Opened, but the read status could not be saved.");
        else await ctx.refresh();
      }
      if (target.kind === "document") {
        const url = new URL(location.href);
        url.searchParams.set("workspace", ctx.workspace.id);
        url.searchParams.set("page", "Documents & payments");
        url.searchParams.set("clientDocument", target.id);
        location.assign(url.href);
      } else if (target.kind === "request") onOpenRequest(target.id);
      else {
        const url = new URL(location.href);
        if (n.discussion_id)
          url.searchParams.set("discussion", n.discussion_id);
        else url.searchParams.delete("discussion");
        history.replaceState(history.state, "", url);
        ctx.selectProject(target.id, target.section);
        const task = ctx.data.tasks.find((t) => t.id === n.task_id);
        if (task) ctx.openTask(task);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KEEP THE NEXT STEP IN SIGHT</div>
          <h1>Inbox.</h1>
          <p>Requests, review decisions, and upcoming task deadlines.</p>
        </div>
        <button
          className="button"
          aria-pressed={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show unread" : "Show all"}
        </button>
      </div>
      <StudioItemFilter value={view} onChange={setView} />
      {view === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="notification"
          items={notifications.map((n) => ({ id: n.id, label: n.title }))}
        />
      )}
      <Panel
        title={
          view !== "Active"
            ? `${view} notifications`
            : all
              ? "All notifications"
              : "Needs your attention"
        }
        subtitle="Deadline reminders are generated hourly. Review and request updates arrive when they happen."
      >
        {notifications.length ? (
          notifications.map((n) => (
            <div className="workflow-row" key={n.id}>
              <div>
                {destination(n) ? (
                  <button
                    className="text-button notification-link"
                    disabled={busy}
                    onClick={() => openNotification(n)}
                  >
                    {n.title}
                  </button>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <p className="muted">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              <StudioItemActions
                ctx={ctx}
                kind="notification"
                item={n}
                title={n.title}
              />
              {destination(n) ? (
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => openNotification(n)}
                >
                  {destination(n)?.kind === "request"
                    ? "Open request"
                    : n.event_key.startsWith("review")
                      ? "Open review"
                      : "Open project"}
                </button>
              ) : (
                <span className="muted">
                  The linked item is no longer available.
                </span>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const { error } = await supabase
                    .from("studio_notifications")
                    .update({
                      read_at: n.read_at ? null : new Date().toISOString(),
                    })
                    .eq("id", n.id);
                  if (error) ctx.notify(error.message);
                  else await ctx.refresh();
                  setBusy(false);
                }}
              >
                {n.read_at ? "Mark unread" : "Mark read"}
              </button>
            </div>
          ))
        ) : (
          <Empty title="You’re caught up">
            <p>New updates will appear here.</p>
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function InsightsView({ ctx }: { ctx: StudioContext }) {
  const [busy, setBusy] = useState(""),
    [answer, setAnswer] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE WORK, WITH PERSPECTIVE</div>
          <h1>Studio insights.</h1>
          <p>
            Planned effort, recorded time, and client decisions in one place.
          </p>
        </div>
      </div>
      <Panel
        title="Project overview"
        subtitle="Estimated hours come from task plans. Actual hours exclude rejected time. Billable value is recorded work, not collected revenue."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Planned / actual</th>
                <th>Overdue</th>
                <th>Reviews pending</th>
                <th>Billable value / labor cost</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {ctx.data.projects.map((p) => {
                const tasks = ctx.data.tasks.filter(
                    (t) => t.project_id === p.id,
                  ),
                  time = ctx.data.time_entries.filter(
                    (t) => t.project_id === p.id && t.status !== "Rejected",
                  );
                const planned =
                    tasks.reduce((n, t) => n + (t.estimated_minutes || 0), 0) /
                    60,
                  actual = time.reduce((n, t) => n + t.minutes, 0) / 60;
                const billable = time.reduce(
                    (n, t) =>
                      n + (t.billable ? (t.minutes / 60) * t.bill_rate : 0),
                    0,
                  ),
                  cost = time.reduce(
                    (n, t) => n + (t.minutes / 60) * t.cost_rate,
                    0,
                  );
                return (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => ctx.selectProject(p.id)}
                      >
                        {p.name}
                      </button>
                      <div className="muted">{p.client_name}</div>
                    </td>
                    <td>
                      {planned ? planned.toFixed(1) : "Not estimated"} /{" "}
                      {actual.toFixed(1)}h
                    </td>
                    <td>
                      {
                        tasks.filter(
                          (t) =>
                            t.status !== "Done" &&
                            t.due_date &&
                            t.due_date < today,
                        ).length
                      }
                    </td>
                    <td>
                      {
                        ctx.data.deliverable_versions.filter(
                          (v) =>
                            v.project_id === p.id &&
                            v.status === "Pending" &&
                            ctx.data.deliverables.some(
                              (d) =>
                                d.id === v.deliverable_id &&
                                inStudioView(d, "Active"),
                            ),
                        ).length
                      }
                    </td>
                    <td>
                      {money(billable)} / {money(cost)}
                    </td>
                    <td>
                      <button
                        className="button small"
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy(p.id);
                          setAnswer("");
                          try {
                            const r = await askStudioAI(ctx, "next_actions", {
                              projectId: p.id,
                            });
                            setAnswer(`${p.name}\n\n${r.text}`);
                          } catch (e) {
                            ctx.notify((e as Error).message);
                          } finally {
                            setBusy("");
                          }
                        }}
                      >
                        {busy === p.id ? "Thinking…" : "Suggest with AI"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!ctx.data.projects.length && (
          <Empty title="Your projects will appear here" />
        )}
        <p className="muted workflow-padding">
          AI suggestions send the selected project’s task plan to your
          configured provider. They do not change records.
        </p>
      </Panel>
      {answer && (
        <Panel title="Suggested next actions">
          <p className="workflow-copy workflow-padding" role="status">
            {answer}
          </p>
        </Panel>
      )}
      <Panel
        title="Assigned effort"
        subtitle="Remaining estimated hours across active projects. This is not a capacity forecast; availability and time off are not recorded yet."
      >
        {ctx.data.members
          .filter((m) => m.role !== "client")
          .map((m) => {
            const tasks = ctx.data.tasks.filter(
              (t) => t.assignee_id === m.user_id && t.status !== "Done",
            );
            return (
              <div key={m.user_id} className="workflow-row">
                <strong>{m.display_name}</strong>
                <span>{tasks.length} open tasks</span>
                <Badge>
                  {(
                    tasks.reduce((n, t) => n + (t.estimated_minutes || 0), 0) /
                    60
                  ).toFixed(1)}
                  h estimated
                </Badge>
                <span className="muted">
                  {tasks.filter((t) => !t.estimated_minutes).length} without an
                  estimate
                </span>
              </div>
            );
          })}
      </Panel>
    </>
  );
}
