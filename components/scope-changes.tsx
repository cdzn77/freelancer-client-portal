"use client";
import { Select } from "./select";
import { useState } from "react";
import type { ScopeChange } from "@/lib/studio-operations";
import type { StudioContext } from "./studio";
import { Field, Panel, Modal, Badge } from "./ui";
import { managesProject } from "./access";
import { money } from "@/lib/types";
import { supabase } from "@/lib/supabase";
export function ScopeChanges({
  ctx,
  projectId,
}: {
  ctx: StudioContext;
  projectId: string;
}) {
  const [editing, setEditing] = useState<ScopeChange | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const manager = managesProject(ctx, projectId);
  async function act(id: string, action: string) {
    if (ctx.readOnly) {
      ctx.notify("Client preview is read-only.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("act_on_scope_change", {
        change_id: id,
        action,
      });
      if (error) throw error;
      await ctx.refresh();
      ctx.notify(
        action === "estimate"
          ? "Draft estimate created in Financials"
          : "Scope change updated",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Scope changes"
      bodyClassName="panel-body"
      subtitle="Agree on extra work and proposed cost before creating a draft estimate. Approval does not change the project deadline, tasks or invoices automatically."
      action={
        manager && (
          <button
            className="button"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            New scope change
          </button>
        )
      }
    >
      {ctx.data.scope_changes
        .filter((s) => s.project_id === projectId)
        .map((s) => (
          <article className="feedback-card feedback-card-content" key={s.id}>
            <div className="workflow-row">
              <strong>{s.title}</strong>
              <Badge>{s.status}</Badge>
              <span>
                {money(Number(s.amount))} USD · {s.added_days} additional days
              </span>
            </div>
            <p className="workflow-copy">{s.description}</p>
            <p className="muted">
              Reviewer:{" "}
              {ctx.data.members.find((m) => m.user_id === s.reviewer_id)
                ?.display_name || "Not selected"}
            </p>
            <div className="modal-actions">
              {manager && s.status === "Draft" && (
                <>
                  <button
                    className="button"
                    onClick={() => {
                      setEditing(s);
                      setOpen(true);
                    }}
                  >
                    Edit draft
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => act(s.id, "submit")}
                  >
                    Submit for approval
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => act(s.id, "delete")}
                  >
                    Delete draft
                  </button>
                </>
              )}
              {s.status === "Submitted" && s.reviewer_id === ctx.userId && (
                <>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => act(s.id, "decline")}
                  >
                    Decline
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => act(s.id, "approve")}
                  >
                    Approve scope
                  </button>
                </>
              )}
              {s.status === "Approved" && ctx.workspace.role === "owner" && (
                <button
                  className="button"
                  disabled={busy || !!s.estimate_id}
                  onClick={() => act(s.id, "estimate")}
                >
                  {s.estimate_id
                    ? "Draft estimate created"
                    : "Create draft estimate"}
                </button>
              )}
            </div>
          </article>
        ))}
      {!ctx.data.scope_changes.some((s) => s.project_id === projectId) && (
        <p className="muted">No scope changes for this project.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Propose a scope change"
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const { error } = await supabase.rpc("save_scope_change", {
                project: projectId,
                change_id: editing?.id || null,
                title: f.get("title"),
                description: f.get("description"),
                amount: Number(f.get("amount")),
                added_days: Number(f.get("days")),
                reviewer: f.get("reviewer"),
              });
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
          <Field label="Title">
            <input
              name="title"
              defaultValue={editing?.title}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Extra work and assumptions">
            <textarea
              name="description"
              defaultValue={editing?.description}
              required
              maxLength={12000}
            />
          </Field>
          <Field label="Proposed amount (USD)">
            <input
              type="number"
              name="amount"
              defaultValue={editing?.amount}
              required
              min={0}
              step={0.01}
            />
          </Field>
          <Field label="Additional days">
            <input
              name="days"
              type="number"
              required
              min={0}
              max={3650}
              defaultValue={editing?.added_days || 0}
            />
          </Field>
          <Field label="Approving reviewer">
            <Select
              name="reviewer"
              required
              defaultValue={editing?.reviewer_id || ""}
            >
              {ctx.data.members
                .filter(
                  (m) =>
                    m.role === "owner" ||
                    (m.role === "client" &&
                      ctx.data.project_members.some(
                        (pm) =>
                          pm.project_id === projectId &&
                          pm.user_id === m.user_id,
                      )),
                )
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
            </Select>
          </Field>
          <p className="muted">
            Client reviewers need Approvals enabled in project Access. This
            saves a draft; submit it when ready.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save draft
          </button>
        </form>
      </Modal>
    </Panel>
  );
}
