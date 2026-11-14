"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "./ui";
import { supabase } from "@/lib/supabase";
import type { StudioContext } from "./studio";
export function DeleteAction({
  ctx,
  table,
  id,
  label,
  description,
  action,
  buttonLabel = "Delete",
  icon = false,
}: {
  ctx: StudioContext;
  table?: string;
  id?: string;
  label: string;
  description?: string;
  action?: () => Promise<void>;
  buttonLabel?: string;
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className={icon ? "icon-button" : "button small"}
        aria-label={`${buttonLabel} ${label}`}
        data-tooltip={`${buttonLabel} ${label}`}
        onClick={() => {
          if (ctx.readOnly) {
            ctx.notify("Client preview is read-only.");
            return;
          }
          setOpen(true);
        }}
      >
        {icon ? <Trash2 size={15} /> : buttonLabel}
      </button>
      <Modal
        title={`${buttonLabel} ${label}?`}
        description={
          description ||
          "This permanently removes this record. This cannot be undone."
        }
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (action) await action();
                else {
                  const { data, error } = await supabase
                    .from(table!)
                    .delete()
                    .eq("workspace_id", ctx.workspace.id)
                    .eq("id", id!)
                    .select("id");
                  if (error) throw error;
                  if (!data?.length)
                    throw Error(
                      "This record is unavailable or you no longer have permission to remove it.",
                    );
                }
                await ctx.refresh();
                setOpen(false);
                ctx.notify(`${label} removed`);
              } catch (e) {
                ctx.notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : `${buttonLabel} permanently`}
          </button>
        </div>
      </Modal>
    </>
  );
}
