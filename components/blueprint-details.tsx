"use client";
import { Select } from "./select";
import { inStudioView } from "@/lib/studio-workflows";
import { StudioItemActions } from "./studio-item-actions";
import { useState } from "react";
import { Blueprint, BlueprintStep } from "@/lib/studio-workflows";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { Badge, Empty, Field, Modal, Panel } from "./ui";
import { projectPeople } from "@/lib/project-people";
import { managesProject } from "./access";
export function BlueprintSteps({
  steps,
  startsOn,
  workdays,
  holidays = [],
  businessDays = false,
}: {
  steps: BlueprintStep[];
  startsOn?: string;
  workdays?: number[];
  holidays?: string[];
  businessDays?: boolean;
}) {
  return (
    <ol className="blueprint-preview">
      {steps.map((s, i) => {
        const date = startsOn ? new Date(startsOn + "T12:00:00") : null;
        if (date) {
          if (!businessDays) date.setDate(date.getDate() + s.offset_days);
          else {
            const weekdays = workdays || [1, 2, 3, 4, 5];
            const working = () =>
              weekdays.includes(date.getDay()) &&
              !holidays.includes(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
              );
            let remaining = s.offset_days;
            while (remaining > 0) {
              date.setDate(date.getDate() + 1);
              if (working()) remaining--;
            }
            while (!working()) date.setDate(date.getDate() + 1);
          }
        }
        return (
          <li key={i}>
            <div className="workflow-row">
              <strong>{s.title}</strong>
              <Badge>{s.phase}</Badge>
              <span>
                {date
                  ? date.toLocaleDateString()
                  : `${businessDays ? "Workday" : "Day"} ${s.offset_days}`}{" "}
                · {s.estimated_minutes} min
              </span>
            </div>
            {s.description && <p className="workflow-copy">{s.description}</p>}
            <p className="muted">
              {s.owner_role && s.owner_role !== "unassigned"
                ? `Owner: ${s.owner_role}`
                : "Assign later"}{" "}
              · {s.shared ? "Shared with clients" : "Internal"}
              {s.approval_gate ? " · Recorded approval required" : ""}
            </p>
            {!!s.depends_on?.length && (
              <p className="muted">Waits on steps: {s.depends_on.join(", ")}</p>
            )}
            {i > 0 && s.after_previous && (
              <p className="muted">Depends on: {steps[i - 1].title}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
export function BlueprintApplications({
  ctx,
  blueprintId,
  projectId,
}: {
  ctx: StudioContext;
  blueprintId?: string;
  projectId?: string;
}) {
  const [selected, setSelected] = useState("");
  const applications = ctx.data.blueprint_applications.filter(
    (a) =>
      (!blueprintId || a.blueprint_id === blueprintId) &&
      (!projectId || a.project_id === projectId),
  );
  const snapshot = applications.find((a) => a.id === selected);
  return (
    <>
      <h3>{projectId ? "Applied blueprints" : "Used in projects"}</h3>
      {applications.length ? (
        applications.map((a) => (
          <div className="workflow-row" key={a.id}>
            <div>
              <strong>
                {projectId
                  ? a.blueprint_name
                  : ctx.data.projects.find((p) => p.id === a.project_id)
                      ?.name || "Project"}
              </strong>
              <p className="muted">
                Version {a.blueprint_revision} · {a.steps.length} steps ·
                Applied {new Date(a.created_at).toLocaleDateString()}
              </p>
            </div>
            <button className="button small" onClick={() => setSelected(a.id)}>
              View applied plan
            </button>
            {!projectId && (
              <button
                className="text-button"
                onClick={() => ctx.selectProject(a.project_id, "Plan")}
              >
                Open project
              </button>
            )}
          </div>
        ))
      ) : (
        <Empty title="Not applied yet">
          <p>
            {projectId
              ? "Apply a blueprint from the Blueprints library to add a task plan here."
              : "Apply this blueprint to an existing project, or select it when accepting a request."}
          </p>
        </Empty>
      )}
      <Modal
        open={!!snapshot}
        onClose={() => setSelected("")}
        title={`${snapshot?.blueprint_name || "Applied plan"} · version ${snapshot?.blueprint_revision || 1}`}
        description="This is the saved plan as applied. Editing the reusable blueprint does not change this snapshot or existing tasks."
      >
        {snapshot && (
          <BlueprintSteps
            steps={snapshot.steps}
            startsOn={snapshot.starts_on}
            businessDays={!!snapshot.setup?.ux_audit}
            workdays={snapshot.setup?.workdays}
            holidays={snapshot.setup?.holidays}
          />
        )}
      </Modal>
    </>
  );
}
export function BlueprintDetails({
  ctx,
  blueprint,
  onClose,
}: {
  ctx: StudioContext;
  blueprint: Blueprint;
  onClose: () => void;
}) {
  const [projectChoice, setProjectChoice] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const projects = ctx.data.projects.filter(
    (p) =>
      !p.archived_at &&
      !p.deleted_at &&
      managesProject(ctx, p.id) &&
      !ctx.data.blueprint_applications.some(
        (a) => a.project_id === p.id && a.blueprint_id === blueprint.id,
      ),
  );
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={blueprint.name}
      description={`Reusable blueprint · version ${blueprint.revision}. View the plan, then choose where to use it.`}
    >
      <p className="workflow-copy">{blueprint.description}</p>
      {ctx.workspace.role === "owner" && (
        <StudioItemActions
          ctx={ctx}
          kind="blueprint"
          item={blueprint}
          title={blueprint.name}
          onDone={onClose}
        />
      )}
      <BlueprintSteps
        steps={blueprint.steps}
        businessDays={!!blueprint.setup?.ux_audit}
      />
      <BlueprintApplications ctx={ctx} blueprintId={blueprint.id} />
      {inStudioView(blueprint, "Active") && projects.length > 0 && (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const { error } = await supabase.rpc(
                "apply_studio_blueprint_plan",
                {
                  blueprint_id: blueprint.id,
                  project_id: f.get("project"),
                  starts_on: f.get("start"),
                  assignments: {
                    lead: f.get("lead") || ctx.userId,
                    client: f.get("client") || null,
                    reviewer: f.get("reviewer") || null,
                  },
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
              );
              if (error) throw error;
              await ctx.refresh();
              ctx.notify(
                "Blueprint applied. Open the project to see its plan and tasks.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Apply to a project</h3>
          <Field label="Project for this blueprint">
            <Select
              name="project"
              required
              value={projectChoice}
              onChange={(e) => setProjectChoice(e.target.value)}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {["lead", "client", "reviewer"]
            .filter((role) =>
              blueprint.steps.some((s) => s.owner_role === role),
            )
            .map((role) => {
              const chosen = projects.find((p) => p.id === projectChoice);
              const people = chosen
                ? projectPeople(ctx.data, chosen).filter((m) =>
                    role === "client"
                      ? m.role === "client" &&
                        ctx.data.project_members.some(
                          (pm) =>
                            pm.project_id === chosen.id &&
                            pm.user_id === m.user_id &&
                            pm.role === "guest",
                        )
                      : m.role !== "client",
                  )
                : [];
              return (
                <Field
                  key={role}
                  label={
                    role === "lead"
                      ? "Project lead"
                      : role === "client"
                        ? "Client contact"
                        : "Peer reviewer"
                  }
                >
                  <Select
                    name={role}
                    required
                    defaultValue={role === "lead" ? ctx.userId : ""}
                    key={`${projectChoice}-${role}`}
                  >
                    <option value="">Choose an invited person</option>
                    {people.map((m) => (
                      <option value={m.user_id} key={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            })}
          {blueprint.setup?.ux_audit && (
            <p>
              Dates use this project’s workweek and holidays. Adds five
              discussion/reference threads and a Friday status task. Enables
              client Tasks, Conversation, Files and Review work. Internal steps
              and reference threads stay private. Client assignment shares those
              tasks with invited project clients.
            </p>
          )}
          <Field label="Plan start date">
            <input
              name="start"
              type="date"
              required
              defaultValue={new Date().toLocaleDateString("en-CA")}
            />
          </Field>
          <p className="muted">
            Adds {blueprint.steps.length} new tasks and their dependencies.
            Existing tasks are kept. Each blueprint can be applied once per
            project.
          </p>
          <button className="button primary" disabled={busy}>
            {busy ? "Applying…" : "Apply blueprint"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
export function ProjectPlan({
  ctx,
  projectId,
}: {
  ctx: StudioContext;
  projectId: string;
}) {
  return (
    <Panel
      title="Project plan"
      bodyClassName="panel-body project-plan-body"
      subtitle="Saved blueprints used to create this project’s tasks. Live progress stays in Tasks."
    >
      <BlueprintApplications ctx={ctx} projectId={projectId} />
    </Panel>
  );
}
