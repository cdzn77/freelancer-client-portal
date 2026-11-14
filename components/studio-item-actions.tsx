"use client";
import { useState } from "react";
import type { StudioContext } from "./studio";
import type { StudioItemState, StudioItemView } from "@/lib/studio-workflows";
import { supabase } from "@/lib/supabase";
import { Modal } from "./ui";
export function StudioItemFilter({
  value,
  onChange,
}: {
  value: StudioItemView;
  onChange: (value: StudioItemView) => void;
}) {
  return (
    <div className="detail-tabs" role="group" aria-label="Item visibility">
      {(["Active", "Archived", "Trash"] as const).map((v) => (
        <button
          key={v}
          aria-pressed={value === v}
          className={value === v ? "active" : ""}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
export function StudioItemActions({
  ctx,
  kind,
  item,
  title,
  onDone,
}: {
  ctx: StudioContext;
  kind: "blueprint" | "request" | "notification" | "deliverable";
  item: StudioItemState & { id: string };
  title: string;
  onDone?: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(next_state: string) {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("set_studio_item_state", {
        item_kind: kind,
        item_id: item.id,
        next_state,
      });
      if (error) throw error;
      await ctx.refresh();
      setConfirm(false);
      onDone?.();
      ctx.notify(
        next_state === "restore"
          ? "Restored to Active"
          : next_state === "archive"
            ? "Archived"
            : "Moved to trash. You can restore it from Trash.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {item.archived_at || item.deleted_at ? (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => run("restore")}
        >
          Restore
        </button>
      ) : (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => run("archive")}
        >
          Archive
        </button>
      )}
      {!item.deleted_at && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setError("");
            setConfirm(true);
          }}
        >
          Move to trash
        </button>
      )}
      {error && !confirm && <p role="alert">{error}</p>}
      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={`Move “${title}” to trash?`}
        description={
          kind === "notification"
            ? "This removes the notification from your inbox only. The linked work stays unchanged. You can restore it from Trash."
            : "You can restore this item from Trash. Existing projects, tasks, files, and saved review history will be kept."
        }
      >
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => run("trash")}
          >
            {busy ? "Moving…" : "Move to trash"}
          </button>
        </div>
      </Modal>
    </>
  );
}
