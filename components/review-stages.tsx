"use client";
import { Select } from "./select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import type { ReviewVersion } from "@/lib/studio-workflows";
import { supabase } from "@/lib/supabase";
import { Field, Badge } from "./ui";
import { managesProject } from "./access";
export function ReviewStages({
  ctx,
  version,
  active,
}: {
  ctx: StudioContext;
  version: ReviewVersion;
  active: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [reviewers, setReviewers] = useState<string[]>([""]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stages = ctx.data.review_stages
      .filter((s) => s.version_id === version.id)
      .sort((a, b) => a.position - b.position),
    next = stages.find((s) => s.status !== "Approved");
  const manager = managesProject(ctx, version.project_id);
  async function decide(id: string, decision: string) {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("decide_review_stage", {
        stage: id,
        decision,
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
    <section className="operation-section">
      <h4>Approval route</h4>
      {!stages.length && (
        <p className="muted">
          Single-review approval. Add reviewers for an ordered approval route.
        </p>
      )}
      {stages.map((s) => (
        <div className="workflow-row" key={s.id}>
          <span>
            {s.position}.{" "}
            {ctx.data.members.find((m) => m.user_id === s.reviewer_id)
              ?.display_name || "Reviewer"}
          </span>
          <Badge>{s.status}</Badge>
          {active &&
            version.status === "Pending" &&
            s.id === next?.id &&
            s.status === "Pending" &&
            s.reviewer_id === ctx.userId && (
              <>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => decide(s.id, "Changes requested")}
                >
                  Request changes
                </button>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => decide(s.id, "Approved")}
                >
                  Approve my stage
                </button>
              </>
            )}
        </div>
      ))}
      {manager &&
        active &&
        version.status === "Pending" &&
        !stages.some((s) => s.status !== "Pending") && (
          <button
            className="text-button"
            onClick={() => {
              setEditing(!editing);
              setReviewers(
                stages.length ? stages.map((s) => s.reviewer_id) : [""],
              );
            }}
          >
            Set approval route
          </button>
        )}
      {editing && (
        <form
          className="settings-form operation-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const { error } = await supabase.rpc("configure_review_stages", {
                version: version.id,
                reviewers,
              });
              if (error) throw error;
              await ctx.refresh();
              setEditing(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {reviewers.map((v, i) => (
            <Field key={i} label={`Reviewer ${i + 1}`}>
              <Select
                required
                value={v}
                onChange={(e) =>
                  setReviewers(
                    reviewers.map((x, n) => (n === i ? e.target.value : x)),
                  )
                }
              >
                <option value="">Choose reviewer</option>
                {ctx.data.members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <p className="muted">
            Reviewers must have access to this version. Decisions happen in
            order. Once a decision is recorded, use a new version to change the
            route.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              disabled={reviewers.length >= 10}
              onClick={() => setReviewers([...reviewers, ""])}
            >
              Add reviewer
            </button>
            {reviewers.length > 1 && (
              <button
                type="button"
                className="button"
                onClick={() => setReviewers(reviewers.slice(0, -1))}
              >
                Remove last
              </button>
            )}
            <button className="button primary" disabled={busy}>
              Save route
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
