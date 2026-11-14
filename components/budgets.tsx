"use client";
import { ScopeBudget } from "./scope-budget";
import { Select } from "./select";
import { TrashTools } from "./trash-tools";
import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import type { StudioContext } from "./studio";
import type { Budget } from "@/lib/types";
import { money } from "@/lib/types";
import { Empty, Field, Modal, Panel, Progress } from "./ui";

export function Budgets({
  ctx,
  create,
  onClose,
}: {
  ctx: StudioContext;
  create: boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState("Active");
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = ctx.workspace.role === "owner";
  const available = ctx.data.projects.filter(
    (p) =>
      !p.archived_at &&
      !p.deleted_at &&
      !ctx.data.budgets.some((b) => b.project_id === p.id),
  );
  const rows = ctx.data.budgets.filter((b) =>
    scope === "Trash"
      ? !!b.deleted_at
      : !b.deleted_at &&
        (scope === "Archived" ? !!b.archived_at : !b.archived_at),
  );
  const name = (b: Budget) =>
    ctx.data.projects.find((p) => p.id === b.project_id)?.name ||
    "Project budget";
  async function save(
    values: Record<string, unknown>,
    id: string | undefined,
    message: string,
  ) {
    setBusy(true);
    try {
      if (await ctx.mutate("budgets", values, id)) {
        setEditing(null);
        setDeleting(null);
        onClose();
        ctx.notify(message);
        return true;
      }
    } finally {
      setBusy(false);
    }
    return false;
  }
  if (!admin) return <Empty title="Budgets are available to administrators" />;
  return (
    <>
      <ScopeBudget ctx={ctx} />
      <div className="view-toolbar standalone">
        <Field label="Budget archive filter">
          <Select
            aria-label="Budget archive filter"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {["Active", "Archived", "Trash"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <span className="muted">
          {rows.length} {scope.toLowerCase()} budgets
        </span>
      </div>
      {scope === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="budget"
          items={rows.map((b) => ({ id: b.id, label: name(b) }))}
        />
      )}
      <div className="projects-grid">
        {rows.map((b) => {
          const entries = ctx.data.time_entries.filter(
            (e) => e.project_id === b.project_id,
          );
          const burn = entries
            .filter((e) => e.billable)
            .reduce((s, e) => s + (e.minutes / 60) * e.bill_rate, 0);
          const cost = entries.reduce(
            (s, e) => s + (e.minutes / 60) * e.cost_rate,
            0,
          );
          return (
            <Panel
              key={b.id}
              title={name(b)}
              subtitle={`${scope} project budget`}
            >
              <div className="budget-content">
                <strong>
                  {money(burn)} <small>of {money(Number(b.amount))}</small>
                </strong>
                <Progress value={(burn / Number(b.amount)) * 100} />
                <p>Labor cost: {money(cost)}</p>
                <p>Contribution: {money(burn - cost)}</p>
                <div
                  className="toolbar-right budget-actions"
                  data-tooltip-position="above"
                >
                  {!b.deleted_at && !b.archived_at && (
                    <button
                      className="button small"
                      disabled={busy}
                      data-tooltip="Change this project’s budget amount"
                      onClick={() => setEditing(b)}
                    >
                      <Pencil size={15} /> Edit budget
                    </button>
                  )}
                  {b.deleted_at ? (
                    <button
                      className="button small"
                      disabled={busy}
                      data-tooltip="Return this budget to Active"
                      onClick={() =>
                        save(
                          { deleted_at: null, archived_at: null },
                          b.id,
                          "Budget restored from Trash",
                        )
                      }
                    >
                      <ArchiveRestore size={15} /> Restore from Trash
                    </button>
                  ) : (
                    <>
                      <button
                        className="button small"
                        disabled={busy}
                        data-tooltip={
                          b.archived_at
                            ? "Return this budget to Active"
                            : "Keep this budget in history and stop its alerts"
                        }
                        onClick={() =>
                          save(
                            {
                              archived_at: b.archived_at
                                ? null
                                : new Date().toISOString(),
                            },
                            b.id,
                            b.archived_at
                              ? "Budget restored"
                              : "Budget archived",
                          )
                        }
                      >
                        <Archive size={15} />{" "}
                        {b.archived_at ? "Restore budget" : "Archive budget"}
                      </button>
                      <button
                        className="button small"
                        disabled={busy}
                        data-tooltip="Move this budget to recoverable Trash"
                        onClick={() => setDeleting(b)}
                      >
                        <Trash2 size={15} /> Delete budget
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
      {!rows.length && (
        <Empty
          title={
            scope === "Trash"
              ? "Budget Trash is empty"
              : scope === "Archived"
                ? "No archived budgets"
                : "No active budgets"
          }
        >
          <p>Use New budget to set a project’s spending limit.</p>
        </Empty>
      )}
      <Modal
        open={create || !!editing}
        onClose={() => {
          if (!busy) {
            onClose();
            setEditing(null);
          }
        }}
        title={editing ? "Edit budget" : "New budget"}
        description="Set the total budget in dollars for a project. Each project has one budget; archived or deleted budgets can be restored."
      >
        {editing || available.length ? (
          <form
            key={editing?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const f = new FormData(e.currentTarget),
                amount = Number(f.get("amount"));
              if (!Number.isFinite(amount) || amount <= 0) {
                ctx.notify("Enter a budget greater than zero.");
                return;
              }
              if (
                await save(
                  {
                    project_id:
                      editing?.project_id || String(f.get("project_id")),
                    amount,
                  },
                  editing?.id,
                  editing ? "Budget updated" : "Budget created",
                )
              )
                setScope("Active");
            }}
          >
            {editing ? (
              <p>{name(editing)}</p>
            ) : (
              <Field label="Project">
                <Select name="project_id" aria-label="Project" required>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Budget amount ($)">
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={editing?.amount || ""}
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  onClose();
                  setEditing(null);
                }}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save budget" : "Create budget"}
              </button>
            </div>
          </form>
        ) : (
          <Empty title="No projects available">
            <p>
              Create an active project without a budget, or restore its existing
              budget from Archived or Trash.
            </p>
          </Empty>
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        title="Delete budget?"
        description={`Move ${deleting ? name(deleting) : "this project"}’s budget to Trash. Time entries, invoices and project history stay intact. You can restore the budget from the Trash filter.`}
      >
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() =>
              deleting &&
              save(
                { deleted_at: new Date().toISOString() },
                deleting.id,
                "Budget moved to Trash",
              )
            }
          >
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </Modal>
    </>
  );
}
