"use client";
import { Select } from "./select";
import { useState } from "react";
import type { StudioContext } from "./studio";
import { Field, Panel } from "./ui";
import { supabase } from "@/lib/supabase";
export function TaskFieldInputs({
  ctx,
  values,
}: {
  ctx: StudioContext;
  values: Record<string, string>;
}) {
  return (
    <fieldset className="operation-section">
      <legend>Custom fields</legend>
      {ctx.data.task_field_definitions
        .filter((d) => !d.archived)
        .map((d) => (
          <Field key={d.id} label={d.name}>
            {d.kind === "select" || d.kind === "boolean" ? (
              <Select
                name={`custom_${d.id}`}
                required={d.required}
                defaultValue={values[`field:${d.id}`] || ""}
              >
                <option value="">Not set</option>
                {(d.kind === "boolean" ? ["true", "false"] : d.options).map(
                  (o) => (
                    <option key={o} value={o}>
                      {d.kind === "boolean" ? (o === "true" ? "Yes" : "No") : o}
                    </option>
                  ),
                )}
              </Select>
            ) : (
              <input
                name={`custom_${d.id}`}
                type={
                  d.kind === "number"
                    ? "number"
                    : d.kind === "date"
                      ? "date"
                      : "text"
                }
                step={d.kind === "number" ? "any" : undefined}
                maxLength={2000}
                required={d.required}
                defaultValue={values[`field:${d.id}`] || ""}
              />
            )}
          </Field>
        ))}
      {!ctx.data.task_field_definitions.some((d) => !d.archived) && (
        <p className="muted">
          No custom fields configured. Administrators can add them in Custom
          fields.
        </p>
      )}
    </fieldset>
  );
}
export function TaskFieldsView({ ctx }: { ctx: StudioContext }) {
  const [kind, setKind] = useState("text"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Custom fields.</h1>
          <p>
            Workspace fields appear on task forms. Existing legacy values are
            preserved.
          </p>
        </div>
      </div>
      <Panel title="Task fields" bodyClassName="panel-body">
        {ctx.data.task_field_definitions.map((d) => (
          <div key={d.id} className="workflow-row">
            <div>
              <strong>{d.name}</strong>
              <p>
                {d.kind} · {d.archived ? "Archived" : "Active"}
              </p>
            </div>
            <button
              className="button small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const { error } = await supabase
                  .from("task_field_definitions")
                  .update({ archived: !d.archived })
                  .eq("id", d.id);
                if (error) setError(error.message);
                else await ctx.refresh();
                setBusy(false);
              }}
            >
              {d.archived ? "Restore" : "Archive"}
            </button>
          </div>
        ))}
        <form
          className="settings-form operation-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            setBusy(true);
            setError("");
            try {
              const { error } = await supabase
                .from("task_field_definitions")
                .insert({
                  workspace_id: ctx.workspace.id,
                  name: String(f.get("name")).trim(),
                  kind,
                  options:
                    kind === "select"
                      ? String(f.get("options"))
                          .split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean)
                      : [],
                });
              if (error) throw error;
              await ctx.refresh();
              form.reset();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Add a field</h3>
          <Field label="Field name">
            <input name="name" required maxLength={80} />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {["text", "number", "date", "select", "boolean"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          {kind === "select" && (
            <Field label="Options, one per line">
              <textarea name="options" required maxLength={3000} />
            </Field>
          )}
          <p className="muted">
            Fields are optional. Archive a field to hide it without deleting
            saved values; create a new field if its type changes.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Add field
          </button>
        </form>
        <section
          className="custom-field-guide"
          aria-labelledby="custom-field-guide-title"
        >
          <h3 id="custom-field-guide-title">Custom field cheat sheet</h3>
          <p className="muted">
            A field is an extra detail you want to track on a task. Give it a
            name here, then fill in its value when you add or edit a task.
          </p>
          <dl className="custom-field-examples">
            <div>
              <dt>Text</dt>
              <dd>
                For words, reference codes, or a link stored as text.{" "}
                <span>
                  Example: “Reference link” → a Figma URL, or “Asset size” →
                  1080 × 1920.
                </span>
              </dd>
            </div>
            <div>
              <dt>Number</dt>
              <dd>
                For quantities or decimal values.{" "}
                <span>
                  Example: “Revision round” → 2, or “Estimated hours” → 3.5.
                </span>
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>
                For an extra milestone alongside the task’s due date.{" "}
                <span>
                  Example: “Client review date” → the day feedback is expected.
                </span>
              </dd>
            </div>
            <div>
              <dt>Select</dt>
              <dd>
                For one choice from a reusable list. Enter each option on its
                own line.{" "}
                <span>
                  Example: “Channel” with options Website, Email, and Social.
                </span>
                <pre aria-label="Example select options">
                  {"Website\nEmail\nSocial"}
                </pre>
              </dd>
            </div>
            <div>
              <dt>Boolean (Yes / No)</dt>
              <dd>
                For a simple check.{" "}
                <span>
                  Example: “Client assets received?” → Yes or No. “Not set”
                  means it hasn’t been answered yet.
                </span>
              </dd>
            </div>
          </dl>
          <div className="custom-field-tips">
            <h4>Useful shortcuts</h4>
            <ul>
              <li>
                Put the unit in the name: “Estimated hours” or “Word count” is
                clearer than “Amount”.
              </li>
              <li>
                Use Select for consistent labels, such as “Design”, “Copy”, and
                “Development”, instead of typing a category differently on every
                task.
              </li>
              <li>
                Use the task’s built-in status, priority, owner, and due date
                first. Add fields only for details those don’t cover.
              </li>
              <li>
                Fields appear across this workspace’s task forms, so keep names
                useful for more than one project. Start with two or three.
              </li>
            </ul>
            <p className="muted">
              Custom fields store information; they don’t calculate totals, send
              reminders, or trigger automations. Archiving hides a field while
              keeping its saved values.
            </p>
          </div>
        </section>
      </Panel>
    </>
  );
}
