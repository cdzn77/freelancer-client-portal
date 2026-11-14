"use client";
import { useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Modal } from "./ui";
import type { Project } from "@/lib/types";
import type { StudioContext } from "./studio";
import { managesProject } from "./access";
export function ProjectActions({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  if (!managesProject(ctx, project.id)) return null;
  async function update(values: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      if (await ctx.mutate("projects", values, project.id)) {
        setOpen(false);
        ctx.selectProject("");
        ctx.notify(message);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="toolbar-right project-header-actions">
      {!project.deleted_at && (
        <button
          className="button"
          disabled={busy}
          data-tooltip={
            project.archived_at
              ? "Restore this project to active views"
              : "Hide from active views and keep all project history"
          }
          onClick={() =>
            update(
              {
                archived_at: project.archived_at
                  ? null
                  : new Date().toISOString(),
              },
              project.archived_at ? "Project restored" : "Project archived",
            )
          }
        >
          {project.archived_at ? (
            <ArchiveRestore size={15} />
          ) : (
            <Archive size={15} />
          )}{" "}
          {project.archived_at ? "Restore project" : "Archive project"}
        </button>
      )}
      {ctx.workspace.role === "owner" &&
        (project.deleted_at ? (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              update(
                { deleted_at: null, archived_at: null },
                "Project restored from Trash",
              )
            }
          >
            Restore from Trash
          </button>
        ) : (
          <button
            className="button"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            <Trash2 size={15} /> Delete project
          </button>
        ))}
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={`Delete ${project.name}?`}
        description="Move this project to Trash and remove it from active views. Files, tasks, discussions, time entries and financial history are preserved. An administrator can restore it from Projects → Trash."
      >
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() =>
              update(
                { deleted_at: new Date().toISOString() },
                "Project moved to Trash",
              )
            }
          >
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
