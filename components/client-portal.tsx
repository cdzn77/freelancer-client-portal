"use client";
import { brand } from "../lib/brand";

import { useState } from "react";
import {
  ArrowRight,
  Plus,
  FileText,
  CalendarDays,
  MessageSquare,
  FolderOpen,
} from "lucide-react";
import type { StudioContext } from "./studio";
import type { Project } from "@/lib/types";
import { dateLabel } from "@/lib/types";
import { projectPeople } from "@/lib/project-people";
import { useLocationTab } from "@/lib/use-location-tab";
import { supabase } from "@/lib/supabase";
import { Avatar, Badge, Panel, statusTone } from "./ui";
import { ClientAttention } from "./client-attention";
import { ProjectFiles, ProjectDiscussion } from "./access";
import { StudioReviews } from "./studio-reviews";
import { FilePreview, ReviewPreview } from "./review-preview";
import { ProjectRegisters } from "./project-registers";
import { ClientTimeReport } from "./client-time-report";
import { ScopeChanges } from "./scope-changes";
import { ProjectShape } from "./project-shape";

function ProjectIdentity({ project }: { project: Project }) {
  return (
    <div
      className={`project-art art-${project.color || "coral"} cp-project-identity`}
      aria-hidden="true"
    >
      <ProjectShape shape={project.shape_id} className="card-shape" />
      <small>{project.client_name || project.name}</small>
    </div>
  );
}

export function PortalView({
  ctx,
  onRequest,
  onNavigate,
  view: controlledView,
  onView,
}: {
  ctx: StudioContext;
  onRequest?: (id: string) => void;
  onNavigate?: (page: string) => void;
  view?: string;
  onView?: (view: string) => void;
}) {
  const projects = ctx.data.projects.filter((p) => !p.deleted_at);
  const [localView, setLocalView] = useLocationTab("clientView", "Home", [
    "Home",
    "Projects",
    "Project",
    "Messages",
  ]);
  const view = controlledView ?? localView;
  const setView = onView ?? setLocalView;
  const [projectId, setProjectId] = useLocationTab(
    "clientProject",
    "",
    projects.map((p) => p.id),
  );
  const project = projects.find((p) => p.id === projectId) || projects[0];
  const [savedSection, setSection] = useLocationTab(
    "clientSection",
    "Overview",
    [
      "Overview",
      "Tasks",
      "Files",
      "Feedback",
      "Messages",
      "Timeline",
      "People",
      "Time report",
      "Decisions",
      "Audit findings",
    ],
  );
  const [timeline, setTimeline] = useLocationTab("clientTimeline", "Dates", [
    "Dates",
    "Activity",
  ]);
  const [preview, setPreview] = useState<{
    deliverable: string;
    version: string;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const tools = project?.client_tools || [];
  const sections = [
    "Overview",
    ...(tools.includes("tasks") ? ["Tasks"] : []),
    ...(tools.includes("tasks") && project?.client_time_report_enabled
      ? ["Time report"]
      : []),
    ...(tools.includes("approvals") ? ["Feedback"] : []),
    ...(tools.includes("files") ? ["Files"] : []),
    "Timeline",
    ...(tools.includes("discussions")
      ? ["Messages", "Decisions", "Audit findings"]
      : []),
    "People",
  ];
  const section = sections.includes(savedSection) ? savedSection : "Overview";
  const sharedTasks = (p: Project) =>
    p.client_tools.includes("tasks")
      ? ctx.data.tasks.filter((t) => t.project_id === p.id && t.is_published)
      : [];
  const versions = ctx.data.deliverable_versions.filter(
    (v) =>
      v.is_published &&
      projects.some(
        (p) => p.id === v.project_id && p.client_tools.includes("approvals"),
      ),
  );
  const current = ctx.data.deliverables
    .filter((d) => !d.archived_at && !d.deleted_at)
    .flatMap((d) => {
      const v = versions.find((v) => v.id === d.current_version_id);
      return v ? [{ d, v }] : [];
    });
  const nextReview = current.find(
    ({ v }) =>
      v.status === "Pending" &&
      !projects.find((p) => p.id === v.project_id)?.archived_at,
  );
  const sharedComments = (ctx.data.discussion_threads || [])
    .filter(
      (c) =>
        !c.hidden_from_clients &&
        !c.deleted_at &&
        !c.task_id &&
        projects.some(
          (p) =>
            p.id === c.project_id && p.client_tools.includes("discussions"),
        ),
    )
    .map((c) => ({
      ...c,
      body: c.title,
      created_at: c.updated_at,
      is_published: true,
    }));
  const latestMessage = [...sharedComments].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  const openProject = (id: string, s = "Overview") => {
    setProjectId(id);
    setSection(s);
    setView("Project");
  };
  const openDocument = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("clientDocument", id);
    window.history.replaceState(window.history.state, "", url);
    onNavigate?.("Documents & payments");
  };
  const active = projects.filter(
    (p) => !p.archived_at && !["Completed", "Done"].includes(p.status),
  );
  const name = ctx.data.members
    .find((m) => m.user_id === ctx.userId)
    ?.display_name?.split(" ")[0];
  function projectCard(p: Project) {
    const task = sharedTasks(p)
      .filter((t) => t.status !== "Done" && t.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    const review = current.find(
      (x) => x.v.project_id === p.id && x.v.status === "Pending",
    );
    return (
      <article className="cp-project-card" key={p.id}>
        <ProjectIdentity project={p} />
        <span className={`cp-status ${review ? "action" : ""}`}>
          {p.archived_at ? "Archived" : p.status}
        </span>
        <h2>{p.name}</h2>
        <p>
          {p.description ||
            "Project details and shared work are available here."}
        </p>
        <div className="cp-card-next">
          <strong>
            {review
              ? "Your review is next"
              : task
                ? task.title
                : "Latest shared status"}
          </strong>
          <small>
            {review
              ? `${review.d.title} · Version ${review.v.version_number}`
              : task
                ? `Due ${dateLabel(task.due_date)}`
                : p.status}
          </small>
        </div>
        {p.due_date && <small>Target delivery · {dateLabel(p.due_date)}</small>}
        <button className="button" onClick={() => openProject(p.id)}>
          Open project <ArrowRight size={16} />
        </button>
      </article>
    );
  }
  async function decide(id: string, value: string) {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    if (
      value === "Approved" &&
      !window.confirm(
        "Approve this project item? Your decision will be recorded.",
      )
    )
      return;
    setBusy(id);
    try {
      const { error } = await supabase.rpc("decide_approval", {
        approval_id: id,
        decision: value,
      });
      if (error) throw error;
      await ctx.refresh();
      ctx.notify("Your decision is recorded.");
    } catch (e) {
      ctx.notify((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const requestButton = (
    <button className="button" onClick={() => onRequest?.("")}>
      <Plus size={18} />
      Request a service
    </button>
  );
  const previewItem = preview
    ? ctx.data.deliverables.find((d) => d.id === preview.deliverable)
    : null;
  return (
    <div className="client-experience">
      {view === "Projects" && (
        <button
          className="text-button cp-request-history"
          onClick={() => onNavigate?.("Requests")}
        >
          View your service requests
        </button>
      )}
      {previewItem && preview && (
        <ReviewPreview
          ctx={ctx}
          deliverable={previewItem}
          initialVersion={preview.version}
          onClose={() => setPreview(null)}
        />
      )}
      {view === "Home" && (
        <>
          <header className="cp-heading">
            <div>
              <span className="eyebrow">{brand.name} / CLIENT SPACE</span>
              <h1>{name ? `Welcome back, ${name}.` : "Your client space."}</h1>
              <p>Your work, your next steps, and the people behind it.</p>
            </div>
            {requestButton}
          </header>
          <div className="cp-home-grid">
            <section className="cp-lead">
              {nextReview ? (
                <>
                  <div className="cp-artifact">
                    <FilePreview ctx={ctx} version={nextReview.v} page={1} />
                  </div>
                  <div className="cp-lead-body">
                    <span className="cp-status action">
                      Your review is next
                    </span>
                    <h2>{nextReview.d.title}</h2>
                    <p>
                      {
                        projects.find((p) => p.id === nextReview.v.project_id)
                          ?.name
                      }{" "}
                      · Version {nextReview.v.version_number}
                    </p>
                    <p>
                      {nextReview.v.note ||
                        "Review the work and share your feedback with the project team."}
                    </p>
                    <button
                      className="button primary"
                      onClick={() => {
                        setProjectId(nextReview.v.project_id);
                        setPreview({
                          deliverable: nextReview.d.id,
                          version: nextReview.v.id,
                        });
                      }}
                    >
                      Review version {nextReview.v.version_number}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="cp-lead-body">
                  <span className="eyebrow">YOUR NEXT STEP</span>
                  <h2>
                    {active.length
                      ? "Your projects are moving."
                      : "Ready when you are."}
                  </h2>
                  <p>
                    {active.length
                      ? "Open a project to see shared work, upcoming dates, and the latest conversation."
                      : "Your shared projects and documents stay here when you need them. You can request new work at any time."}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setView("Projects")}
                  >
                    View your projects <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <ClientAttention
                ctx={ctx}
                onReview={(id) => openProject(id, "Feedback")}
                onDocument={openDocument}
              />
            </section>
            <aside className="cp-home-side">
              <section className="cp-active-work">
                <h2>Active work</h2>
                {active.length ? (
                  active.slice(0, 3).map((p) => (
                    <button key={p.id} onClick={() => openProject(p.id)}>
                      <ProjectIdentity project={p} />
                      <strong>{p.name}</strong>
                      <span>{p.status}</span>
                      {p.due_date && (
                        <small>Target · {dateLabel(p.due_date)}</small>
                      )}
                      <ArrowRight size={16} />
                    </button>
                  ))
                ) : (
                  <p>No active projects right now.</p>
                )}
                {active.length > 3 && (
                  <button onClick={() => setView("Projects")}>
                    View all {active.length} projects
                  </button>
                )}
              </section>
              <section className="cp-contact">
                <MessageSquare size={22} />
                <h2>Keep the conversation close.</h2>
                {latestMessage ? (
                  <>
                    <strong>
                      {ctx.data.members.find(
                        (m) => m.user_id === latestMessage.created_by,
                      )?.display_name || "Project team"}
                    </strong>
                    <p className="cp-excerpt">{latestMessage.body}</p>
                    <button
                      className="button"
                      onClick={() =>
                        openProject(latestMessage.project_id, "Messages")
                      }
                    >
                      Open conversation
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      Questions and feedback belong alongside the project they
                      relate to.
                    </p>
                    <button
                      className="button"
                      onClick={() => setView("Messages")}
                    >
                      Project conversations
                    </button>
                  </>
                )}
              </section>
            </aside>
          </div>
          <div className="cp-bottom">
            <div>
              <h2>Agreements and payments</h2>
              <p>Review documents and find your payment records.</p>
            </div>
            <button
              className="button"
              onClick={() => onNavigate?.("Documents & payments")}
            >
              Open documents <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      {(view === "Projects" || view === "Messages") && (
        <>
          <header className="cp-heading">
            <div>
              <span className="eyebrow">YOUR ENGAGEMENTS</span>
              <h1>
                {view === "Messages"
                  ? "Project conversations"
                  : "Your projects"}
              </h1>
              <p>
                {view === "Messages"
                  ? "Choose a project. Messages stay with the work they concern."
                  : "A clear next step for every project."}
              </p>
            </div>
            {requestButton}
          </header>
          {view === "Messages" ? (
            <div className="cp-conversations">
              {projects
                .filter((p) => p.client_tools.includes("discussions"))
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openProject(p.id, "Messages")}
                  >
                    <MessageSquare size={22} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {projectPeople(ctx.data, p).length} participants ·
                        Shared project conversation
                      </small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              {!projects.some((p) =>
                p.client_tools.includes("discussions"),
              ) && (
                <p>
                  No shared conversations yet. Your team will enable them for
                  your project.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="cp-project-grid">
                {projects.filter((p) => !p.archived_at).map(projectCard)}
              </div>
              {!projects.length && (
                <Panel title="Your next project starts here">
                  <p>
                    Your team will share your project here when it is ready.
                  </p>
                </Panel>
              )}
              {projects.some((p) => p.archived_at) && (
                <details className="cp-archive">
                  <summary>Past projects</summary>
                  <div className="cp-project-grid">
                    {projects.filter((p) => p.archived_at).map(projectCard)}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      {view === "Project" && project && (
        <>
          <ProjectIdentity project={project} />
          <header className="cp-heading">
            <div>
              <button
                className="text-button"
                onClick={() => setView("Projects")}
              >
                All projects
              </button>
              <h1>{project.name}</h1>
              <p>
                <span className="cp-status">{project.status}</span>
                {project.due_date &&
                  ` Target delivery · ${dateLabel(project.due_date)}`}
              </p>
            </div>
            {projects.length > 1 && (
              <label className="cp-switch">
                Switch project
                <select
                  value={project.id}
                  onChange={(e) => openProject(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          <nav className="cp-project-nav" aria-label="Project sections">
            {sections.map((s) => (
              <button
                key={s}
                aria-current={section === s ? "page" : undefined}
                onClick={() => setSection(s)}
              >
                {s === "Feedback"
                  ? "Review work"
                  : s === "Messages"
                    ? "Conversation"
                    : s}
              </button>
            ))}
          </nav>
          <div key={`${project.id}-${section}`} className="cp-project-content">
            {section === "Tasks" && (
              <section className="cp-task-list" aria-label="Shared tasks">
                <h2>Your project tasks</h2>
                <p>
                  Open a task to read the description, discuss it, or add files.
                </p>
                {sharedTasks(project).map((t) => (
                  <article
                    className="discussion-thread-card cp-task-row"
                    key={t.id}
                  >
                    <button
                      className="text-button"
                      onClick={() => ctx.openTask(t)}
                    >
                      {t.title}
                    </button>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    <span>
                      {t.assignee_id === ctx.userId
                        ? "Assigned to you"
                        : ctx.data.members.find(
                            (m) => m.user_id === t.assignee_id,
                          )?.display_name || "Unassigned"}
                    </span>
                    <span>{dateLabel(t.due_date)}</span>
                  </article>
                ))}
                {!sharedTasks(project).length && (
                  <p>No tasks have been shared yet.</p>
                )}
              </section>
            )}
            {section === "Overview" && (
              <>
                <section className="cp-overview">
                  <span className="eyebrow">WHERE THINGS STAND</span>
                  <h2>{project.status}</h2>
                  <p>
                    {project.description ||
                      "Your team will share updates as the work progresses."}
                  </p>
                  <div className="cp-overview-links">
                    {current
                      .filter(
                        (x) =>
                          x.v.project_id === project.id &&
                          x.v.status === "Pending",
                      )
                      .map(({ d, v }) => (
                        <button
                          className="button primary"
                          key={v.id}
                          onClick={() =>
                            setPreview({ deliverable: d.id, version: v.id })
                          }
                        >
                          Review {d.title} · v{v.version_number}
                          <ArrowRight size={16} />
                        </button>
                      ))}
                    <button
                      className="button"
                      onClick={() => setSection("Timeline")}
                    >
                      <CalendarDays size={18} />
                      View shared timeline
                    </button>
                  </div>
                </section>
                {tools.includes("brief") && (
                  <details className="client-brief">
                    <summary>Project brief and agreed scope</summary>
                    <p className="brief-content">
                      {project.shared_brief ||
                        "Your team has not shared a brief yet."}
                    </p>
                  </details>
                )}
                <div className="cp-bottom">
                  <div>
                    <h2>Something new in mind?</h2>
                    <p>
                      Request additional work without changing the agreed scope.
                    </p>
                  </div>
                  <button
                    className="button"
                    onClick={() => onRequest?.(project.id)}
                  >
                    Request a service
                  </button>
                </div>
              </>
            )}
            {section === "Files" && (
              <ProjectFiles ctx={ctx} project={project} />
            )}
            {section === "Messages" && (
              <>
                <div className="cp-conversation-info">
                  <strong>
                    {projectPeople(ctx.data, project).length} project
                    participants
                  </strong>
                  <p>
                    Messages here are shared with this project. Type @ to tag
                    someone.
                  </p>
                  <button
                    className="button small"
                    onClick={() => setSection("People")}
                  >
                    View people
                  </button>
                </div>
                <ProjectDiscussion ctx={ctx} project={project} />
              </>
            )}
            {section === "Time report" && (
              <ClientTimeReport key={project.id} ctx={ctx} project={project} />
            )}
            {section === "Decisions" && (
              <ProjectRegisters
                key={project.id + "decisions"}
                ctx={ctx}
                projectId={project.id}
                kind="Decision"
              />
            )}
            {section === "Audit findings" && (
              <ProjectRegisters
                key={project.id + "findings"}
                ctx={ctx}
                projectId={project.id}
                kind="Finding"
              />
            )}
            {section === "People" && (
              <>
                <h2>People on this project</h2>
                <p className="muted">
                  Project access determines who can see shared work. Internal
                  agency notes remain private.
                </p>
                <div className="cp-people">
                  {projectPeople(ctx.data, project).map((m) => (
                    <article key={m.user_id}>
                      <Avatar userId={m.user_id} name={m.display_name} />
                      <div>
                        <strong>{m.display_name}</strong>
                        <small>
                          {m.role === "client"
                            ? "Client contact"
                            : m.role === "owner"
                              ? "Studio lead"
                              : "Project team"}
                          {m.user_id === ctx.userId ? " · You" : ""}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
            {section === "Timeline" && (
              <>
                <div
                  className="cp-project-nav"
                  role="group"
                  aria-label="Timeline display"
                >
                  {["Dates", "Activity"].map((t) => (
                    <button
                      key={t}
                      aria-pressed={timeline === t}
                      onClick={() => setTimeline(t)}
                    >
                      {t === "Dates" ? "Upcoming dates" : "Shared activity"}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {timeline === "Dates"
                    ? "Published task dates and the project target. These are shared due dates, not a calculated delivery promise."
                    : "Shared review versions, decisions, and conversation. Internal notes are excluded."}
                </p>
                <div className="cp-timeline">
                  {timeline === "Dates" ? (
                    <>
                      {sharedTasks(project)
                        .filter((t) => t.due_date)
                        .sort((a, b) => a.due_date.localeCompare(b.due_date))
                        .map((t) => (
                          <article key={t.id}>
                            <time>{dateLabel(t.due_date)}</time>
                            <div>
                              <Badge tone={statusTone(t.status)}>
                                {t.status}
                              </Badge>
                              <h3>
                                <button
                                  className="text-button"
                                  onClick={() => ctx.openTask(t)}
                                >
                                  {t.title}
                                </button>
                              </h3>
                              <p>
                                {ctx.data.members.find(
                                  (m) => m.user_id === t.assignee_id,
                                )?.display_name || "Project team"}
                              </p>
                            </div>
                          </article>
                        ))}
                      {project.due_date && (
                        <article>
                          <time>{dateLabel(project.due_date)}</time>
                          <div>
                            <Badge>Target delivery</Badge>
                            <h3>{project.name}</h3>
                            <p>{brand.name}</p>
                          </div>
                        </article>
                      )}
                      {!sharedTasks(project).some((t) => t.due_date) &&
                        !project.due_date && (
                          <p>Your team has not shared dates yet.</p>
                        )}
                    </>
                  ) : (
                    <>
                      {[
                        ...versions
                          .filter((v) => v.project_id === project.id)
                          .flatMap((v) => [
                            {
                              id: v.id,
                              date: v.created_at,
                              title: `${ctx.data.deliverables.find((d) => d.id === v.deliverable_id)?.title || "Review"} · Version ${v.version_number}`,
                              body: "Shared for review",
                            },
                            ...(v.decided_at
                              ? [
                                  {
                                    id: v.id + "decision",
                                    date: v.decided_at,
                                    title: v.status,
                                    body: `Decision by ${ctx.data.members.find((m) => m.user_id === v.decided_by)?.display_name || "Reviewer"}`,
                                  },
                                ]
                              : []),
                          ]),
                        ...sharedComments
                          .filter((c) => c.project_id === project.id)
                          .map((c) => ({
                            id: c.id,
                            date: c.created_at,
                            title: `Message from ${ctx.data.members.find((m) => m.user_id === c.created_by)?.display_name || "Project team"}`,
                            body: c.body,
                          })),
                      ]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((item) => (
                          <article key={item.id}>
                            <time>{new Date(item.date).toLocaleString()}</time>
                            <div>
                              <h3>{item.title}</h3>
                              <p>{item.body}</p>
                            </div>
                          </article>
                        ))}
                      {!versions.some((v) => v.project_id === project.id) &&
                        !sharedComments.some(
                          (c) => c.project_id === project.id,
                        ) && <p>No shared activity yet.</p>}
                    </>
                  )}
                </div>
              </>
            )}
            {section === "Feedback" && (
              <>
                <StudioReviews ctx={ctx} project={project} />
                <ScopeChanges ctx={ctx} projectId={project.id} />
                {ctx.data.approvals
                  .filter((a) => a.project_id === project.id && a.is_published)
                  .map((a) => (
                    <article className="cp-approval" key={a.id}>
                      <h3>{a.label}</h3>
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      {a.status === "Pending" && !project.archived_at && (
                        <div className="form-actions">
                          <button
                            className="button"
                            disabled={!!busy}
                            onClick={() => decide(a.id, "Changes requested")}
                          >
                            Request changes
                          </button>
                          <button
                            className="button primary"
                            disabled={!!busy}
                            onClick={() => decide(a.id, "Approved")}
                          >
                            Approve
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
              </>
            )}
          </div>
        </>
      )}
      {view === "Project" && !project && (
        <Panel title="No shared project found">
          <button className="button" onClick={() => setView("Projects")}>
            Return to projects
          </button>
        </Panel>
      )}
    </div>
  );
}
