"use client";
import { MentionInput } from "./mention-input";
import { projectPeople } from "@/lib/project-people";
import { Select } from "./select";
import { TrashTools } from "./trash-tools";
import { ReviewStages } from "./review-stages";
import { ReviewPreview } from "./review-preview";
import { StudioItemActions, StudioItemFilter } from "./studio-item-actions";
import { inStudioView, type StudioItemView } from "@/lib/studio-workflows";
import { useState } from "react";
import type { Project } from "@/lib/types";
import type { StudioContext } from "./studio";
import type { Deliverable, ReviewVersion } from "@/lib/studio-workflows";
import { supabase } from "@/lib/supabase";
import { Badge, Empty, Field, Modal, Panel, statusTone } from "./ui";
import { managesProject } from "./access";
import { askStudioAI } from "./studio-intake";
export function StudioReviews({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const [preview, setPreview] = useState<{
    deliverable: Deliverable;
    version: string;
  } | null>(null);
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [view, setView] = useState<StudioItemView>("Active");
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState<Deliverable | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [history, setHistory] = useState<Record<string, string>>({}),
    [answer, setAnswer] = useState("");
  const manager = managesProject(ctx, project.id),
    editable = manager && !project.archived_at && !project.deleted_at;
  const deliverables = ctx.data.deliverables.filter(
    (d) => d.project_id === project.id && inStudioView(d, view),
  );
  const files = ctx.data.project_files.filter(
    (f) => f.project_id === project.id,
  );
  async function decision(v: ReviewVersion, value: string) {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    if (
      value === "Approved" &&
      !window.confirm(
        `Approve version ${v.version_number}? This records your decision for this file version.`,
      )
    )
      return;
    setBusy(true);
    setFailure("");
    try {
      const { error } = await supabase.rpc("decide_deliverable_version", {
        version_id: v.id,
        decision: value,
      });
      if (error) throw error;
      await ctx.refresh();
      ctx.notify(value);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openFile(fileId: string) {
    setFailure("");
    try {
      const f = files.find((f) => f.id === fileId);
      if (!f) throw Error("This file is no longer shared with you.");
      const { data } = await supabase.auth.getSession();
      const r = await fetch(`/api/storage?path=${encodeURIComponent(f.path)}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      window.open(b.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setFailure((e as Error).message);
    }
  }
  return (
    <Panel
      title="Creative review"
      className="creative-review-panel"
      subtitle="Feedback and decisions stay attached to the exact file version."
      action={
        editable && (
          <button
            className="button"
            onClick={() => {
              setRevision(null);
              setFailure("");
              setOpen(true);
            }}
          >
            Start a review
          </button>
        )
      }
    >
      {preview && (
        <ReviewPreview
          ctx={ctx}
          deliverable={
            ctx.data.deliverables.find(
              (d) => d.id === preview.deliverable.id,
            ) || preview.deliverable
          }
          initialVersion={preview.version}
          onClose={() => setPreview(null)}
        />
      )}
      <StudioItemFilter value={view} onChange={setView} />
      {view === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="deliverable"
          items={ctx.data.deliverables
            .filter((d) => d.project_id === project.id && !!d.deleted_at)
            .map((d) => ({ id: d.id, label: d.title }))}
        />
      )}
      {failure && (
        <p className="workflow-error" role="alert">
          {failure}
        </p>
      )}
      {!deliverables.length && (
        <Empty
          title={
            view === "Active"
              ? "Start your first file review"
              : `No ${view === "Trash" ? "deleted" : "archived"} reviews`
          }
        >
          <p>
            {view !== "Active"
              ? "Reviews moved here can be restored to Active."
              : files.length
                ? "Your files are uploaded. Choose one to create a review, then open Review & compare to add pins, page comments, and feedback."
                : "Upload an image or PDF in Files, then return here to start a review."}
          </p>
          {view === "Active" && editable && (
            <div className="empty-actions">
              {files.length > 0 && (
                <button
                  className="button primary"
                  onClick={() => {
                    setRevision(null);
                    setFailure("");
                    setOpen(true);
                  }}
                >
                  Start a review
                </button>
              )}
              <button
                className="button"
                onClick={() => ctx.selectProject(project.id, "Files")}
              >
                {files.length ? "Manage files" : "Upload a file"}
              </button>
            </div>
          )}
        </Empty>
      )}
      {deliverables.map((d) => {
        const versions = ctx.data.deliverable_versions
          .filter((v) => v.deliverable_id === d.id)
          .sort((a, b) => b.version_number - a.version_number);
        const v = versions.find((v) => v.id === history[d.id]) || versions[0];
        if (!v) return null;
        const current = v.id === d.current_version_id;
        const comments = ctx.data.review_feedback
          .filter((f) => f.version_id === v.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        return (
          <article key={d.id} className="review-item">
            <div className="workflow-row">
              <div>
                <h3>{d.title}</h3>
                <p className="muted">
                  {v.is_published ? "Shared with client" : "Internal review"} ·{" "}
                  {current ? "Latest version" : "Previous version"}
                </p>
              </div>
              {manager && (
                <StudioItemActions
                  ctx={ctx}
                  kind="deliverable"
                  item={d}
                  title={d.title}
                />
              )}
              <Badge tone={statusTone(v.status)}>{v.status}</Badge>
              <Field label={`Version of ${d.title}`}>
                <Select
                  value={v.id}
                  onChange={(e) =>
                    setHistory({ ...history, [d.id]: e.target.value })
                  }
                >
                  {versions.map((x) => (
                    <option key={x.id} value={x.id}>
                      Version {x.version_number} · {x.status}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="workflow-copy">{v.note}</p>
            <div className="workflow-row">
              <button
                className="button"
                onClick={() => setPreview({ deliverable: d, version: v.id })}
              >
                Review & compare
              </button>
              <button className="button" onClick={() => openFile(v.file_id)}>
                Open{" "}
                {files.find((f) => f.id === v.file_id)?.name || "review file"}
              </button>
              {editable && inStudioView(d, "Active") && (
                <button
                  className="button"
                  onClick={() => {
                    setRevision(d);
                    setFailure("");
                    setOpen(true);
                  }}
                >
                  Add new version
                </button>
              )}
              {inStudioView(d, "Active") &&
                current &&
                v.status === "Pending" &&
                !ctx.data.review_stages.some((s) => s.version_id === v.id) &&
                (manager || ctx.workspace.role === "client") && (
                  <>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => decision(v, "Changes requested")}
                    >
                      Request changes
                    </button>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => decision(v, "Approved")}
                    >
                      Approve version {v.version_number}
                    </button>
                  </>
                )}
            </div>
            <ReviewStages
              ctx={ctx}
              version={v}
              active={inStudioView(d, "Active") && current}
            />
            {v.decided_at && (
              <p className="muted">
                Decision recorded {new Date(v.decided_at).toLocaleString()} by{" "}
                {ctx.data.members.find((m) => m.user_id === v.decided_by)
                  ?.display_name || "reviewer"}
                .
              </p>
            )}
            <div
              className="review-feedback"
              aria-label={`Feedback for ${d.title}`}
            >
              <h4>Version {v.version_number} feedback</h4>
              {comments.length ? (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="feedback-card feedback-card-content"
                  >
                    <strong className="feedback-author">
                      {ctx.data.members.find((m) => m.user_id === c.created_by)
                        ?.display_name || "Reviewer"}
                    </strong>
                    <p className="workflow-copy">{c.body}</p>
                    {c.annotation && (
                      <span className="muted">
                        {c.annotation.type === "pdf"
                          ? `PDF page ${c.annotation.page}`
                          : "Image pin"}{" "}
                        · {c.resolved_at ? "Resolved" : "Open"}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">No feedback on this version yet.</p>
              )}
              {inStudioView(d, "Active") && (
                <form
                  className="settings-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const body = new FormData(form).get("feedback");
                    setBusy(true);
                    try {
                      const { error } = await supabase
                        .from("review_feedback")
                        .insert({
                          workspace_id: ctx.workspace.id,
                          project_id: project.id,
                          version_id: v.id,
                          body,
                        });
                      if (error) throw error;
                      await ctx.refresh();
                      form.reset();
                      setFeedbackRevision((n) => n + 1);
                    } catch (e) {
                      setFailure((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Field
                    label={`Feedback on ${d.title} version ${v.version_number}`}
                  >
                    <MentionInput
                      key={`${v.id}-${feedbackRevision}`}
                      name="feedback"
                      required
                      maxLength={4000}
                      people={projectPeople(ctx.data, project)}
                    />
                  </Field>
                  <button className="button" disabled={busy}>
                    Add feedback
                  </button>
                </form>
              )}
            </div>
          </article>
        );
      })}
      {ctx.workspace.role === "owner" && deliverables.length > 0 && (
        <div className="workflow-ai">
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailure("");
              try {
                const r = await askStudioAI(ctx, "summarize_reviews", {
                  projectId: project.id,
                });
                setAnswer(r.text);
              } catch (e) {
                setFailure((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Summarize feedback with AI
          </button>
          <p className="muted">
            Sends this project’s review notes and feedback to your configured
            provider.
          </p>
          {answer && (
            <p className="workflow-copy" role="status">
              {answer}
            </p>
          )}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={revision ? `New version: ${revision.title}` : "Start a review"}
        description="Choose an uploaded file. Each revision needs a new file and a fresh decision."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailure("");
            const f = new FormData(e.currentTarget);
            try {
              const { error } = await supabase.rpc("add_deliverable_version", {
                p: project.id,
                file: f.get("file"),
                label: revision?.title || f.get("title"),
                deliverable: revision?.id || null,
                shared: f.get("shared") === "on",
                version_note: f.get("note"),
              });
              if (error) throw error;
              await ctx.refresh();
              setOpen(false);
              if (revision)
                setHistory((h) => {
                  const next = { ...h };
                  delete next[revision.id];
                  return next;
                });
              ctx.notify("Review version created");
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!revision && (
            <Field label="Review title">
              <input name="title" required maxLength={200} />
            </Field>
          )}
          <Field label="Uploaded file">
            <Select name="file" required defaultValue="">
              <option value="" disabled>
                Choose a project file
              </option>
              {files
                .filter(
                  (f) =>
                    !revision ||
                    !ctx.data.deliverable_versions.some(
                      (v) =>
                        v.deliverable_id === revision.id && v.file_id === f.id,
                    ),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.is_published ? " · Shared" : " · Internal"}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="What should the reviewer know?">
            <textarea name="note" maxLength={4000} />
          </Field>
          <label className="workflow-check">
            <input type="checkbox" name="shared" />
            Share this review with invited clients
          </label>
          <p className="muted">
            For client reviews, enable Files and Approvals in Access and share
            the selected file first.
          </p>
          {failure && <p role="alert">{failure}</p>}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Saving…"
              : revision
                ? "Create review version"
                : "Start review"}
          </button>
        </form>
      </Modal>
    </Panel>
  );
}
