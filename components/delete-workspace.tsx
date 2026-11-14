"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Panel, Modal, Field } from "./ui";
import { supabase } from "@/lib/supabase";
export function DeleteWorkspace({
  ctx,
  onDeleted,
}: {
  ctx: StudioContext;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (ctx.workspace.role !== "owner") return null;
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/workspace", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({
          workspace: ctx.workspace.id,
          confirmedName: name,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not delete workspace");
      setOpen(false);
      const channel = new BroadcastChannel("pms-workspaces-changed");
      channel.postMessage(ctx.workspace.id);
      channel.close();
      await onDeleted();
      ctx.notify(
        result.pendingFiles === 0
          ? "Workspace permanently deleted."
          : "Workspace deleted. Stored-file cleanup is pending and will retry automatically.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Delete workspace"
      subtitle="Permanently remove this workspace for everyone."
      bodyClassName="settings-form"
    >
      <p>
        This removes its projects, tasks, files, reviews, financial records, and
        history. Your sign-in account and other workspaces stay available.
      </p>
      <button
        className="button"
        onClick={() => {
          setName("");
          setError("");
          setOpen(true);
        }}
      >
        Delete workspace
      </button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Delete “${ctx.workspace.name}”?`}
        description="This permanently deletes the entire workspace and its contents for every member. There is no restore option."
      >
        <p>
          Public request forms will stop working and the workspace’s Google
          email connection will be removed. Sent emails, downloaded copies, and
          backups cannot be erased here.
        </p>
        <Field label={`Type ${ctx.workspace.name} to confirm`}>
          <input
            value={name}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
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
            disabled={busy || name !== ctx.workspace.name}
            onClick={remove}
          >
            {busy ? "Deleting workspace…" : "Delete workspace permanently"}
          </button>
        </div>
      </Modal>
    </Panel>
  );
}
