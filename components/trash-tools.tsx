"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Modal } from "./ui";
import { supabase } from "@/lib/supabase";
export function TrashTools({
  ctx,
  kind,
  items,
}: {
  ctx: StudioContext;
  kind:
    | "project"
    | "budget"
    | "blueprint"
    | "request"
    | "notification"
    | "deliverable";
  items: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (ctx.workspace.role !== "owner") return null;
  const chosen = items.filter((i) => selected.includes(i.id));
  const details =
    kind === "project"
      ? "Projects and their tasks, files, discussions, reviews, time entries, financial records, linked requests, and PMS history will be permanently removed."
      : kind === "blueprint"
        ? "Blueprints and their saved application history will be removed. Tasks already created in projects stay in those projects."
        : kind === "deliverable"
          ? "Reviews, versions, decisions, and feedback will be removed. Source files remain in Files because other work may use them."
          : kind === "notification"
            ? "Selected inbox notifications and their delivery records will be removed. The linked work stays intact."
            : kind === "budget"
              ? "Selected budgets and their alert records will be removed. Project invoices and time entries stay intact."
              : "Selected requests and their linked notifications will be removed. Projects already created from them stay intact.";
  function show(all: boolean) {
    setSelected(all ? items.map((i) => i.id) : []);
    setConfirmation("");
    setError("");
    setOpen(true);
  }
  async function purge() {
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/trash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({
          workspace: ctx.workspace.id,
          kind,
          ids: chosen.map((i) => i.id),
          confirmation,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error || "Deletion failed");
      await ctx.refresh();
      const channel = new BroadcastChannel("pms-records-changed");
      channel.postMessage(ctx.workspace.id);
      channel.close();
      setOpen(false);
      setSelected([]);
      ctx.notify(
        result.pendingFiles === 0
          ? `${result.deleted} items permanently deleted.`
          : "Records deleted. Stored-file cleanup is pending and will retry automatically.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="view-toolbar standalone"
        aria-label="Trash administration"
      >
        <span className="muted">{items.length} items in this Trash</span>
        <button
          className="button"
          disabled={!items.length}
          onClick={() => show(false)}
        >
          Select items to delete
        </button>
        <button
          className="button"
          disabled={!items.length}
          onClick={() => show(true)}
        >
          Empty trash
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Permanently delete from Trash"
        description={details}
      >
        <p>
          This cannot be undone. Downloaded copies, sent emails, and backups are
          not erased.
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            disabled={busy}
            checked={items.length > 0 && chosen.length === items.length}
            onChange={(e) => {
              setSelected(e.target.checked ? items.map((i) => i.id) : []);
              setConfirmation("");
            }}
          />
          Select all ({items.length})
        </label>
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            border: "1px solid #ddd",
            padding: 16,
          }}
        >
          {items.map((i) => (
            <label className="check-row" key={i.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.includes(i.id)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, i.id]
                      : selected.filter((id) => id !== i.id),
                  );
                  setConfirmation("");
                }}
              />
              {i.label}
            </label>
          ))}
        </div>
        <label className="field">
          Type DELETE to permanently remove {chosen.length} selected items
          <input
            value={confirmation}
            disabled={busy}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !chosen.length || confirmation !== "DELETE"}
            onClick={purge}
          >
            {busy
              ? "Deleting…"
              : `Delete ${chosen.length} selected permanently`}
          </button>
        </div>
      </Modal>
    </>
  );
}
