"use client";
import { FilterSelect } from "./filter-select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { defaultTaskFilters, type TaskFilters } from "@/lib/work-planning";
import { Modal, Field } from "./ui";
import { supabase } from "@/lib/supabase";
export function SavedTaskViews({
  ctx,
  scope,
  value,
  onChange,
}: {
  ctx: StudioContext;
  scope: string;
  value: TaskFilters;
  onChange: (value: TaskFilters) => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState(false);
  const views = ctx.data.saved_task_views.filter((v) => v.scope === scope);
  const chosen = views.find((v) => v.id === selected);
  async function deleteView() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase
        .from("saved_task_views")
        .delete()
        .eq("id", selected);
      if (error) throw error;
      await ctx.refresh();
      setSelected("");
      setRemove(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="view-toolbar saved-views-toolbar">
        <Field label="Your saved views">
          <FilterSelect
            label="Your saved views"
            value={selected}
            onValueChange={(nextValue) => {
              setSelected(nextValue);
              const saved = views.find((v) => v.id === nextValue);
              const next = { ...defaultTaskFilters };
              if (saved)
                for (const k of Object.keys(next) as (keyof TaskFilters)[])
                  if (typeof saved.filters[k] === "string")
                    next[k] = saved.filters[k];
              onChange(next);
            }}
            options={[
              { value: "", label: "Default view" },
              ...views.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </Field>
        <div className="toolbar-right">
          <button
            className="button small"
            onClick={() => {
              setOpen(true);
              setError("");
            }}
          >
            Save current view
          </button>
          {chosen && (
            <button
              className="text-button"
              onClick={() => {
                setRemove(true);
                setError("");
              }}
            >
              Delete saved view
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              setSelected("");
              onChange({ ...defaultTaskFilters });
            }}
          >
            Reset filters
          </button>
        </div>
      </div>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Save task view"
        description="Save these filters and the list/board layout for yourself in this workspace. This does not share tasks or change anyone’s access."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const { data, error } = await supabase
                .from("saved_task_views")
                .insert({
                  workspace_id: ctx.workspace.id,
                  user_id: ctx.userId,
                  name: String(f.get("name")).trim(),
                  scope,
                  filters: value,
                })
                .select("id")
                .single();
              if (error) throw error;
              await ctx.refresh();
              setSelected(data.id);
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="View name">
            <input name="name" required maxLength={80} />
          </Field>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save view
          </button>
        </form>
      </Modal>
      <Modal
        open={remove}
        onClose={() => !busy && setRemove(false)}
        title={`Delete “${chosen?.name || "view"}”?`}
        description="Only this saved filter preset will be removed. Tasks stay unchanged."
      >
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setRemove(false)}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={deleteView}
          >
            Delete saved view
          </button>
        </div>
      </Modal>
    </>
  );
}
