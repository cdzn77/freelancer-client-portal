"use client";
import { MentionInput } from "./mention-input";
import { projectPeople } from "@/lib/project-people";
import { Select } from "./select";
import { PDFPreview } from "./pdf-preview";
import { useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import type {
  Deliverable,
  ReviewFeedback,
  ReviewVersion,
} from "@/lib/studio-workflows";
import { inStudioView } from "@/lib/studio-workflows";
import { supabase } from "@/lib/supabase";
import { managesProject } from "./access";
import { Field, Modal, Badge } from "./ui";
type Anchor = ReviewFeedback["annotation"];
export function FilePreview({
  ctx,
  version,
  page,
  onPin,
  pins,
  onSelect,
  draft,
  onValid,
}: {
  ctx: StudioContext;
  version: ReviewVersion;
  page: number;
  onPin?: (a: Anchor) => void;
  pins?: ReviewFeedback[];
  onSelect?: (id: string) => void;
  draft?: Anchor;
  onValid?: (valid: boolean) => void;
}) {
  const file = ctx.data.project_files.find((f) => f.id === version.file_id);
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const kind = file?.name.toLowerCase().endsWith(".pdf")
    ? "pdf"
    : /\.(png|jpe?g|gif|webp)$/i.test(file?.name || "")
      ? "image"
      : "other";
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    setUrl("");
    setError("");
    (async () => {
      try {
        if (!file) throw Error("This file is no longer shared with you.");
        if (kind === "other")
          throw Error(
            "Inline preview supports PNG, JPEG, GIF, WebP and PDF files. Use Open file for other formats.",
          );
        const { data } = await supabase.auth.getSession();
        const response = await fetch(
          `/api/storage?path=${encodeURIComponent(file.path)}`,
          {
            headers: { Authorization: `Bearer ${data.session?.access_token}` },
            signal: controller.signal,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Could not load the file.");
        const binary = await fetch(result.url, { signal: controller.signal });
        if (!binary.ok)
          throw Error(
            "The file could not be loaded. Try refreshing the preview.",
          );
        const blob = await binary.blob();
        if (blob.size > 10 * 1024 * 1024)
          throw Error("This file is too large for inline preview.");
        if (
          kind === "pdf" &&
          !(await blob.slice(0, 5).text()).startsWith("%PDF-")
        )
          throw Error("This file is not a valid PDF.");
        objectUrl = URL.createObjectURL(
          kind === "pdf" ? new Blob([blob], { type: "application/pdf" }) : blob,
        );
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id, file?.path, kind, reload]);
  if (error)
    return (
      <div role="status">
        <p>{error}</p>
        <button
          className="button small"
          onClick={() => setReload((n) => n + 1)}
        >
          Reload preview
        </button>
      </div>
    );
  if (!url) return <p role="status">Loading preview…</p>;
  return kind === "pdf" ? (
    <PDFPreview
      url={url}
      page={page}
      pins={pins}
      draft={draft}
      onPin={onPin}
      onSelect={onSelect}
      onValid={onValid}
    />
  ) : (
    <div className="review-image-canvas">
      <img
        src={url}
        alt={`${file?.name}, version ${version.version_number}`}
        onError={() => setError("This image could not be decoded.")}
      />
      {onPin && (
        <button
          type="button"
          className="review-image-target"
          aria-label="Place a feedback pin on this image; keyboard activation selects the center"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onPin({
              type: "image",
              x:
                e.detail === 0
                  ? 0.5
                  : Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width),
                    ),
              y:
                e.detail === 0
                  ? 0.5
                  : Math.max(
                      0,
                      Math.min(1, (e.clientY - rect.top) / rect.height),
                    ),
            });
          }}
        />
      )}
      {draft?.type === "image" && (
        <span
          className="review-pin"
          aria-label="New feedback pin"
          style={{
            pointerEvents: "none",
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            background: "#222222",
            display: "grid",
            placeItems: "center",
          }}
        >
          +
        </span>
      )}
      {pins?.map(
        (f, i) =>
          f.annotation?.type === "image" && (
            <button
              key={f.id}
              type="button"
              className={`review-pin ${f.resolved_at ? "resolved" : ""}`}
              style={{
                left: `${f.annotation.x * 100}%`,
                top: `${f.annotation.y * 100}%`,
              }}
              aria-label={`Feedback ${i + 1}: ${f.body}`}
              onClick={() => onSelect?.(f.id)}
            >
              {i + 1}
            </button>
          ),
      )}
    </div>
  );
}
export function ReviewPreview({
  ctx,
  deliverable,
  initialVersion,
  onClose,
}: {
  ctx: StudioContext;
  deliverable: Deliverable;
  initialVersion: string;
  onClose: () => void;
}) {
  const versions = ctx.data.deliverable_versions
    .filter((v) => v.deliverable_id === deliverable.id)
    .sort((a, b) => b.version_number - a.version_number);
  const [versionId, setVersionId] = useState(initialVersion),
    [compare, setCompare] = useState(""),
    [page, setPage] = useState(1),
    [validPage, setValidPage] = useState(false),
    [anchor, setAnchor] = useState<Anchor>(null),
    [selected, setSelected] = useState(""),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [unresolved, setUnresolved] = useState(false);
  const version = versions.find((v) => v.id === versionId),
    other = versions.find((v) => v.id === compare && v.id !== versionId);
  const file = ctx.data.project_files.find((f) => f.id === version?.file_id),
    pdf = file?.name.toLowerCase().endsWith(".pdf");
  const feedback = ctx.data.review_feedback.filter(
      (f) => f.version_id === versionId,
    ),
    shown = feedback.filter((f) => !unresolved || !f.resolved_at),
    active = inStudioView(deliverable, "Active"),
    manager = managesProject(ctx, deliverable.project_id);
  async function decideCurrent(value: "Approved" | "Changes requested") {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    if (!version || busy) return;
    if (
      value === "Approved" &&
      !window.confirm(
        `Approve ${deliverable.title}, version ${version.version_number}? This records your decision for this version.`,
      )
    )
      return;
    if (value === "Changes requested" && !body.trim() && !feedback.length) {
      setError("Add feedback so your team knows what to adjust.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (body.trim()) {
        const result = await supabase.from("review_feedback").insert({
          workspace_id: ctx.workspace.id,
          project_id: deliverable.project_id,
          version_id: version.id,
          body: body.trim(),
        });
        if (result.error) throw result.error;
        setBody("");
      }
      const { error } = await supabase.rpc("decide_deliverable_version", {
        version_id: version.id,
        decision: value,
      });
      if (error) throw error;
      await ctx.refresh();
      ctx.notify(
        value === "Approved"
          ? "Version approved. Your project team has the next step."
          : "Changes requested. Your feedback stays with this version.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(f: ReviewFeedback) {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("resolve_review_feedback", {
        feedback: f.id,
        resolved: !f.resolved_at,
      });
      if (error) throw error;
      await ctx.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`Review: ${deliverable.title}`}
      onClose={() => !busy && onClose()}
      description="Feedback stays on the exact version. Image pins use relative positions; PDF feedback refers to a page. Comparison does not move comments between versions."
    >
      <div className="workflow-fields">
        <Field label="Version to review">
          <Select
            disabled={busy}
            value={versionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setValidPage(false);
              setAnchor(null);
              setSelected("");
              setPage(1);
              setBody("");
            }}
          >
            {versions.map((v) => (
              <option value={v.id} key={v.id}>
                Version {v.version_number} · {v.status}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Compare alongside">
          <Select
            value={compare === versionId ? "" : compare}
            onChange={(e) => setCompare(e.target.value)}
          >
            <option value="">No comparison</option>
            {versions
              .filter((v) => v.id !== versionId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version_number}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      {pdf && (
        <Field label="PDF page (applies to both previews)">
          <input
            type="number"
            min={1}
            max={10000}
            value={page}
            onChange={(e) => {
              const n = Math.max(
                1,
                Math.min(10000, Math.floor(Number(e.target.value) || 1)),
              );
              setValidPage(false);
              setPage(n);
              setAnchor({ type: "pdf", page: n });
            }}
          />
        </Field>
      )}
      <div className={other ? "review-comparison" : ""}>
        <div>
          <h3>Version {version?.version_number}</h3>
          {version && (
            <FilePreview
              key={versionId}
              ctx={ctx}
              version={version}
              page={page}
              pins={feedback}
              draft={anchor}
              onPin={active ? setAnchor : undefined}
              onSelect={setSelected}
              onValid={setValidPage}
            />
          )}
        </div>
        {other && (
          <div>
            <h3>Version {other.version_number} · comparison only</h3>
            <FilePreview key={other.id} ctx={ctx} version={other} page={page} />
          </div>
        )}
      </div>
      {active && (
        <form
          className="settings-form review-feedback-composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pdf && !validPage) {
              setError("Choose a valid PDF page before adding feedback.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              const { error } = await supabase.from("review_feedback").insert({
                workspace_id: ctx.workspace.id,
                project_id: deliverable.project_id,
                version_id: versionId,
                body: body.trim(),
                annotation: pdf
                  ? anchor?.type === "pdf" && anchor.page === page
                    ? anchor
                    : { type: "pdf", page }
                  : anchor,
              });
              if (error) throw error;
              await ctx.refresh();
              setBody("");
              setAnchor(null);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p role="status">
            {pdf
              ? `Feedback for PDF page ${page}${anchor?.type === "pdf" && anchor.rect ? " · selected area" : ""}.`
              : anchor?.type === "image"
                ? `Pin at ${Math.round(anchor.x * 100)}% across, ${Math.round(anchor.y * 100)}% down.`
                : "Click the image to place a pin, or add general version feedback."}
          </p>
          {anchor?.type === "image" && (
            <div className="workflow-fields">
              <Field label="Pin horizontal position (%)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(anchor.x * 100)}
                  onChange={(e) =>
                    setAnchor({
                      ...anchor,
                      x:
                        Math.max(0, Math.min(100, Number(e.target.value))) /
                        100,
                    })
                  }
                />
              </Field>
              <Field label="Pin vertical position (%)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(anchor.y * 100)}
                  onChange={(e) =>
                    setAnchor({
                      ...anchor,
                      y:
                        Math.max(0, Math.min(100, Number(e.target.value))) /
                        100,
                    })
                  }
                />
              </Field>
              <button
                type="button"
                className="text-button"
                onClick={() => setAnchor(null)}
              >
                Clear pin
              </button>
            </div>
          )}
          {pdf && validPage && (
            <div className="operation-section">
              <div className="toolbar">
                <button
                  type="button"
                  className="button small"
                  onClick={() =>
                    setAnchor({
                      type: "pdf",
                      page,
                      rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                    })
                  }
                >
                  Select center area
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setAnchor({ type: "pdf", page })}
                >
                  Page feedback only
                </button>
              </div>
              {anchor?.type === "pdf" && anchor.rect && (
                <div className="form-grid">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <Field
                      key={key}
                      label={`${key === "x" ? "Left" : key === "y" ? "Top" : key} (%)`}
                    >
                      <input
                        type="number"
                        min={key === "width" || key === "height" ? 1 : 0}
                        max={100}
                        step={1}
                        value={Math.round(anchor.rect![key] * 100)}
                        onChange={(e) => {
                          const rect = { ...anchor.rect! };
                          rect[key] = Math.max(
                            key === "width" || key === "height" ? 0.01 : 0,
                            Math.min(1, Number(e.target.value) / 100),
                          );
                          rect.x = Math.min(rect.x, 1 - rect.width);
                          rect.y = Math.min(rect.y, 1 - rect.height);
                          setAnchor({ ...anchor, rect });
                        }}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          )}
          <Field label="Feedback">
            <MentionInput
              required
              maxLength={4000}
              value={body}
              onValue={setBody}
              people={
                ctx.data.projects.find((p) => p.id === deliverable.project_id)
                  ? projectPeople(
                      ctx.data,
                      ctx.data.projects.find(
                        (p) => p.id === deliverable.project_id,
                      )!,
                    )
                  : []
              }
            />
          </Field>
          <button
            className="button primary"
            disabled={busy || !body.trim() || (pdf && !validPage)}
          >
            Add feedback
          </button>
        </form>
      )}
      {version &&
        active &&
        version.id === deliverable.current_version_id &&
        version.status === "Pending" &&
        !ctx.data.review_stages.some((s) => s.version_id === version.id) &&
        (manager || ctx.workspace.role === "client") && (
          <div className="cp-review-decision">
            <h3>Your decision for version {version.version_number}</h3>
            <p>Feedback and approval apply to this version only.</p>
            <div className="form-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => decideCurrent("Changes requested")}
              >
                Request changes
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => decideCurrent("Approved")}
              >
                Approve this version
              </button>
            </div>
          </div>
        )}
      {version && version.status !== "Pending" && (
        <p role="status">
          Version {version.version_number}: {version.status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="review-feedback-heading">
        <h3>Version feedback</h3>
        <button
          className="button small"
          aria-pressed={unresolved}
          onClick={() => setUnresolved(!unresolved)}
        >
          {unresolved ? "Show all feedback" : "Show unresolved only"}
        </button>
      </div>
      {!shown.length && (
        <p className="feedback-empty">
          {unresolved
            ? "No unresolved feedback on this version."
            : "No feedback yet. Add a comment above to start the conversation."}
        </p>
      )}
      {shown.map((f) => (
        <article
          key={f.id}
          className={`feedback-card ${selected === f.id ? "is-selected" : ""}`}
          aria-label={`Feedback from ${ctx.data.members.find((m) => m.user_id === f.created_by)?.display_name || "Reviewer"}`}
        >
          <div className="feedback-card-meta">
            <Badge tone={f.resolved_at ? "review-resolved" : "review-open"}>
              {f.resolved_at ? "Resolved" : "Open"}
            </Badge>
            {f.annotation?.type === "pdf" ? (
              <button
                className="text-button"
                onClick={() => {
                  setPage((f.annotation as { page: number }).page);
                  setSelected(f.id);
                }}
              >
                Page {f.annotation.page}
              </button>
            ) : f.annotation?.type === "image" ? (
              <span>Pin {feedback.indexOf(f) + 1}</span>
            ) : (
              <span>General feedback</span>
            )}
            {manager && active && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => resolve(f)}
              >
                {f.resolved_at ? "Reopen feedback" : "Mark resolved"}
              </button>
            )}
          </div>
          <div className="feedback-card-content">
            <p className="feedback-author">
              {ctx.data.members.find((m) => m.user_id === f.created_by)
                ?.display_name || "Reviewer"}
              <span> · {new Date(f.created_at).toLocaleString()}</span>
            </p>
            <p className="workflow-copy">{f.body}</p>
          </div>
        </article>
      ))}
    </Modal>
  );
}
