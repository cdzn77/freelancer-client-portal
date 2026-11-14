"use client";
import { ServiceRequestForm } from "./service-request-form";
import { requestDetails } from "@/lib/service-catalog";
import { Select } from "./select";
import { TrashTools } from "./trash-tools";
import { StudioItemActions, StudioItemFilter } from "./studio-item-actions";
import { inStudioView, type StudioItemView } from "@/lib/studio-workflows";
import { uxAuditSteps, uxAuditDescription } from "@/lib/ux-audit-blueprint";
import { BlueprintDetails, BlueprintSteps } from "./blueprint-details";
import { useEffect, useState } from "react";
import { Plus, ArrowRight, Sparkles } from "lucide-react";
import type { StudioContext } from "./studio";
import { Badge, Empty, Field, Modal, Panel } from "./ui";
import { supabase } from "@/lib/supabase";
import {
  BlueprintStep,
  Blueprint,
  WorkRequest,
  planSchema,
  starterSteps,
} from "@/lib/studio-workflows";

export async function askStudioAI(
  ctx: StudioContext,
  action: string,
  extra: Record<string, unknown>,
) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/studio-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token}`,
    },
    body: JSON.stringify({ workspaceId: ctx.workspace.id, action, ...extra }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "The assistant is unavailable.");
  return result;
}
export function RequestsView({
  ctx,
  initialRequestId,
  initialProjectId,
  initialCreate = false,
  onReturn,
}: {
  ctx: StudioContext;
  initialCreate?: boolean;
  initialRequestId?: string;
  initialProjectId?: string;
  onReturn?: () => void;
}) {
  const [view, setView] = useState<StudioItemView>("Active");
  const [uxPreset, setUxPreset] = useState(false);
  const [open, setOpen] = useState(
      !initialRequestId && (!!initialProjectId || initialCreate),
    ),
    [kind, setKind] = useState("Website"),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<WorkRequest | null>(
      () =>
        ctx.data.work_requests.find((r) => r.id === initialRequestId) || null,
    ),
    [filter, setFilter] = useState("Submitted"),
    [failure, setFailure] = useState("");
  const admin = ctx.workspace.role === "owner";
  const requests = ctx.data.work_requests
    .filter(
      (r) =>
        inStudioView(r, view) &&
        (view !== "Active" || filter === "All" || r.status === filter),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (open)
    return (
      <Panel title="New project or service">
        <ServiceRequestForm
          projectId={initialProjectId || null}
          onReturn={onReturn}
          returnLabel={
            ctx.workspace.role === "client"
              ? "Return to client portal"
              : "Return to overview"
          }
          submit={async (input) => {
            const { error } = await supabase.rpc(
              "submit_member_service_request",
              {
                w: ctx.workspace.id,
                submission: input.submission_id,
                request_title: input.title,
                request_brief: input.brief,
                client: input.client_name,
                service_details: requestDetails(input),
                desired: input.desired_date || null,
                p: input.project_id || null,
              },
            );
            if (error) throw error;
            await ctx.refresh();
            setFilter("Submitted");
            setView("Active");
          }}
        />
      </Panel>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A GOOD PLACE TO START</div>
          <h1>Requests.</h1>
          <p>Bring the brief, scope, and next step together.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setFailure("");
            setOpen(true);
          }}
        >
          <Plus size={16} />
          New request
        </button>
      </div>
      <StudioItemFilter value={view} onChange={setView} />
      {view === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="request"
          items={requests.map((r) => ({ id: r.id, label: r.title }))}
        />
      )}
      <div className="detail-tabs" role="group" aria-label="Request status">
        {["Submitted", "Converted", "Declined", "All"].map((s) => (
          <button
            key={s}
            className={filter === s ? "active" : ""}
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <Panel
        title={admin ? "Work coming in" : "Your requests"}
        subtitle={
          admin
            ? "Review scope before committing to a project."
            : "Your studio will review each request."
        }
      >
        {requests.length ? (
          requests.map((r) => (
            <div className="workflow-row" key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <p className="muted">
                  {r.kind} · {r.client_name || "No client name"}
                  {r.desired_date ? ` · Requested for ${r.desired_date}` : ""}
                </p>
              </div>
              <Badge>{r.status}</Badge>
              {(admin ||
                (r.created_by === ctx.userId && r.status === "Submitted")) && (
                <StudioItemActions
                  ctx={ctx}
                  kind="request"
                  item={r}
                  title={r.title}
                />
              )}
              <button
                className="button small"
                onClick={() => {
                  setFailure("");
                  setSelected(r);
                }}
              >
                View request
              </button>
              {r.project_id &&
                ctx.data.projects.some((p) => p.id === r.project_id) && (
                  <button
                    className="text-button"
                    onClick={() => ctx.selectProject(r.project_id!)}
                  >
                    Open project <ArrowRight size={14} />
                  </button>
                )}
            </div>
          ))
        ) : (
          <Empty title="No requests here yet">
            <p>New requests will appear here for review.</p>
          </Empty>
        )}
      </Panel>
      <Modal
        open={!!selected}
        onClose={() => !busy && setSelected(null)}
        title={selected?.title || "Request"}
        description="Review the brief and choose the next step."
      >
        {selected && (
          <>
            <Badge>{selected.status}</Badge>
            {(admin ||
              (selected.created_by === ctx.userId &&
                selected.status === "Submitted")) && (
              <StudioItemActions
                ctx={ctx}
                kind="request"
                item={selected}
                title={selected.title}
                onDone={() => setSelected(null)}
              />
            )}
            <p className="workflow-copy">{selected.brief}</p>
            {Object.entries(selected.details)
              .filter(([k]) => k !== "answers" && k !== "service_id")
              .map(([k, v]) => (
                <p key={k} className="workflow-copy">
                  <strong>
                    {k === "scope"
                      ? "Scope"
                      : k === "contact_email"
                        ? "Contact email"
                        : k === "source"
                          ? "Source"
                          : "References"}
                    :{" "}
                  </strong>
                  {v}
                </p>
              ))}
            {admin &&
              inStudioView(selected, "Active") &&
              selected.status === "Submitted" && (
                <form
                  className="settings-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setFailure("");
                    const f = new FormData(e.currentTarget);
                    try {
                      const { data, error } = await supabase.rpc(
                        "convert_work_request",
                        {
                          request_id: selected.id,
                          blueprint_id: f.get("blueprint") || null,
                          starts_on: f.get("start"),
                        },
                      );
                      if (error) throw error;
                      await ctx.refresh();
                      setSelected(null);
                      ctx.selectProject(data);
                      ctx.notify("Project and plan created");
                    } catch (e) {
                      setFailure((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Field label="Project blueprint">
                    <Select name="blueprint">
                      <option value="">Start without tasks</option>
                      {ctx.data.studio_blueprints
                        .filter((b) => inStudioView(b, "Active"))
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} · {b.steps.length} steps
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Project start date">
                    <input
                      name="start"
                      type="date"
                      required
                      defaultValue={new Date().toLocaleDateString("en-CA")}
                    />
                  </Field>
                  <p className="muted">
                    Blueprint dates are relative to the start date. Review them
                    against the requested deadline. Client access stays private
                    until you invite and share.
                  </p>
                  {failure && <p role="alert">{failure}</p>}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const { error } = await supabase.rpc(
                          "decline_work_request",
                          { request_id: selected.id },
                        );
                        if (error) setFailure(error.message);
                        else {
                          await ctx.refresh();
                          setSelected(null);
                        }
                        setBusy(false);
                      }}
                    >
                      Decline request
                    </button>
                    <button className="button primary" disabled={busy}>
                      {busy ? "Working…" : "Accept and create project"}
                    </button>
                  </div>
                </form>
              )}
          </>
        )}
      </Modal>
    </>
  );
}
export function BlueprintsView({ ctx }: { ctx: StudioContext }) {
  const [uxPreset, setUxPreset] = useState(false);
  const [view, setView] = useState<StudioItemView>("Active");
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<BlueprintStep[] | null>(null),
    [aiStatus, setAIStatus] = useState<{
      enabled: boolean;
      provider?: string;
      error?: string;
    } | null>(null),
    [viewId, setViewId] = useState(""),
    [edit, setEdit] = useState<Blueprint | null>(null),
    [steps, setSteps] = useState<BlueprintStep[]>(starterSteps),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [brief, setBrief] = useState("");
  const admin = ctx.workspace.role === "owner";
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBrief("");
    setDraft(null);
    setAIStatus(null);
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const response = await fetch(
          `/api/studio-ai?workspaceId=${ctx.workspace.id}`,
          {
            headers: { Authorization: `Bearer ${data.session?.access_token}` },
            cache: "no-store",
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Could not check the AI connection.");
        if (active) setAIStatus(result);
      } catch {
        if (active)
          setAIStatus({
            enabled: false,
            error:
              "Could not check the AI connection. Close and reopen this blueprint to retry.",
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [open, ctx.workspace.id]);
  function change(
    i: number,
    key: keyof BlueprintStep,
    value: string | number | boolean | number[],
  ) {
    setSteps((s) => s.map((x, n) => (n === i ? { ...x, [key]: value } : x)));
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LESS SETUP. MORE MAKING.</div>
          <h1>Blueprints.</h1>
          <p>Reusable phases, effort estimates, deadlines, and dependencies.</p>
        </div>
        {admin && (
          <button
            className="button primary"
            onClick={() => {
              setEdit(null);
              setUxPreset(false);
              setSteps(starterSteps.map((s) => ({ ...s })));
              setError("");
              setOpen(true);
            }}
          >
            <Plus size={16} />
            New blueprint
          </button>
        )}
      </div>
      {admin && (
        <Panel
          title="UX audit starter"
          subtitle="Five phases, 20 tasks, explicit client approvals and 46.5 planned hours."
        >
          <p>
            Includes mapped owners, shared and internal work, dependencies,
            kickoff and decision threads, and a weekly status task. Review the
            suggested workday dates before applying.
          </p>
          <button
            className="button"
            onClick={() => {
              setEdit(null);
              setUxPreset(true);
              setSteps(
                uxAuditSteps.map((s) => ({
                  ...s,
                  depends_on: [...(s.depends_on || [])],
                })),
              );
              setError("");
              setOpen(true);
            }}
          >
            Use UX audit starter
          </button>
        </Panel>
      )}
      <StudioItemFilter value={view} onChange={setView} />
      {view === "Trash" && (
        <TrashTools
          ctx={ctx}
          kind="blueprint"
          items={ctx.data.studio_blueprints
            .filter((b) => !!b.deleted_at)
            .map((b) => ({ id: b.id, label: b.name }))}
        />
      )}
      <Panel
        title="Your studio playbook"
        subtitle="Open a blueprint to see its steps, apply it, and view the projects using it."
      >
        {ctx.data.studio_blueprints.some((b) => inStudioView(b, view)) ? (
          ctx.data.studio_blueprints
            .filter((b) => inStudioView(b, view))
            .map((b) => (
              <div className="workflow-row" key={b.id}>
                <div>
                  <button
                    className="text-button notification-link"
                    onClick={() => setViewId(b.id)}
                  >
                    {b.name}
                  </button>
                  <Badge>Version {b.revision}</Badge>
                  <p>{b.description}</p>
                  <span className="muted">
                    {b.steps.length} steps ·{" "}
                    {Math.round(
                      (b.steps.reduce((n, s) => n + s.estimated_minutes, 0) /
                        60) *
                        10,
                    ) / 10}{" "}
                    estimated hours
                  </span>
                </div>
                <button className="button" onClick={() => setViewId(b.id)}>
                  View blueprint
                </button>
                {admin && (
                  <StudioItemActions
                    ctx={ctx}
                    kind="blueprint"
                    item={b}
                    title={b.name}
                  />
                )}
                {admin && inStudioView(b, "Active") && (
                  <button
                    className="button"
                    onClick={() => {
                      setEdit(b);
                      setUxPreset(!!b.setup?.ux_audit);
                      setSteps(b.steps);
                      setError("");
                      setOpen(true);
                    }}
                  >
                    Edit blueprint
                  </button>
                )}
              </div>
            ))
        ) : (
          <Empty
            title={
              view === "Active"
                ? "Create your first blueprint"
                : `No blueprints in ${view.toLowerCase()}`
            }
          >
            <p>Start with the studio workflow, then tailor each step.</p>
          </Empty>
        )}
      </Panel>
      {ctx.data.studio_blueprints.find((b) => b.id === viewId) && (
        <BlueprintDetails
          ctx={ctx}
          blueprint={ctx.data.studio_blueprints.find((b) => b.id === viewId)!}
          onClose={() => setViewId("")}
        />
      )}
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={edit ? "Edit blueprint" : "New blueprint"}
        description="Days are measured from the project start. Estimates are planning assumptions."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const parsed = planSchema.parse({ steps });
              if (
                await ctx.mutate(
                  "studio_blueprints",
                  {
                    name: f.get("name"),
                    description: f.get("description"),
                    steps: parsed.steps,
                    setup: { ux_audit: uxPreset },
                  },
                  edit?.id,
                )
              ) {
                setOpen(false);
                setView("Active");
                ctx.notify("Blueprint saved");
              }
            } catch {
              setError(
                "Check titles, offsets, effort, sharing and dependencies. Each dependency must refer to an earlier step.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Blueprint name">
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={edit?.name || (uxPreset ? "UX audit" : "")}
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={
                edit?.description || (uxPreset ? uxAuditDescription : "")
              }
            />
          </Field>
          <details className="workflow-ai">
            <summary>Draft steps with your AI</summary>
            <p className="muted">
              Only the brief below is sent to the configured provider. Generated
              steps are suggestions. Review them before replacing your editable
              steps.
            </p>
            <p role="status">
              {!aiStatus
                ? "Checking AI connection…"
                : aiStatus.error ||
                  (aiStatus.enabled
                    ? `${aiStatus.provider === "anthropic" ? "Anthropic" : "OpenAI"} configured. Availability is checked when you generate.`
                    : "AI is not connected. Configure OpenAI or Anthropic on the server to generate a draft. You can still build and save steps manually.")}
            </p>
            <Field label="Brief for AI">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={12000}
              />
            </Field>
            <button
              type="button"
              className="button"
              disabled={busy || !brief.trim() || !aiStatus?.enabled}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await askStudioAI(ctx, "draft_plan", {
                    brief,
                  });
                  setDraft(planSchema.parse(result).steps);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Sparkles size={14} />
              {busy ? "Drafting…" : "Draft plan"}
            </button>
            {draft && (
              <section aria-label="AI draft preview">
                <h3>Review suggested steps</h3>
                <p>
                  Using this draft replaces the steps below. Your saved
                  blueprint changes only when you save.
                </p>
                <BlueprintSteps steps={draft} />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setSteps(draft);
                    setDraft(null);
                  }}
                >
                  Use these steps
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  Discard draft
                </button>
              </section>
            )}
          </details>
          {steps.map((s, i) => (
            <fieldset className="blueprint-step" key={i}>
              <legend>Step {i + 1}</legend>
              <Field label={`Step ${i + 1} title`}>
                <input
                  value={s.title}
                  onChange={(e) => change(i, "title", e.target.value)}
                  required
                  maxLength={200}
                />
              </Field>
              <div className="workflow-fields">
                <Field label="Phase">
                  <input
                    value={s.phase}
                    onChange={(e) => change(i, "phase", e.target.value)}
                    maxLength={80}
                  />
                </Field>
                <Field
                  label={uxPreset ? "Workdays after start" : "Days after start"}
                >
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    value={s.offset_days}
                    onChange={(e) =>
                      change(i, "offset_days", Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Estimated minutes">
                  <input
                    type="number"
                    min={0}
                    max={60000}
                    value={s.estimated_minutes}
                    onChange={(e) =>
                      change(i, "estimated_minutes", Number(e.target.value))
                    }
                  />
                </Field>
              </div>
              <Field label="Step description">
                <textarea
                  value={s.description}
                  onChange={(e) => change(i, "description", e.target.value)}
                  maxLength={2000}
                />
              </Field>
              <div className="workflow-fields">
                <Field label={`Step ${i + 1} owner role`}>
                  <Select
                    value={s.owner_role || "unassigned"}
                    onChange={(e) => {
                      change(i, "owner_role", e.target.value);
                      if (e.target.value === "client")
                        change(i, "shared", true);
                    }}
                  >
                    <option value="unassigned">Assign later</option>
                    <option value="lead">Project lead</option>
                    <option value="client">Client contact</option>
                    <option value="reviewer">Peer reviewer</option>
                  </Select>
                </Field>
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={!!s.shared}
                    disabled={s.owner_role === "client"}
                    onChange={(e) => change(i, "shared", e.target.checked)}
                  />
                  Shared with clients
                </label>
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={!!s.approval_gate}
                    onChange={(e) =>
                      change(i, "approval_gate", e.target.checked)
                    }
                  />
                  Requires recorded approval
                </label>
              </div>
              {i > 0 && (
                <Field label={`Step ${i + 1} dependencies`}>
                  <input
                    key={(s.depends_on || []).join(",")}
                    defaultValue={(s.depends_on || []).join(", ")}
                    placeholder="Earlier step numbers, such as 2, 5"
                    onBlur={(e) =>
                      change(
                        i,
                        "depends_on",
                        e.target.value
                          .split(",")
                          .map((x) => Number(x.trim()))
                          .filter((n) => n > 0),
                      )
                    }
                  />
                </Field>
              )}
              {i > 0 && (
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={s.after_previous}
                    onChange={(e) =>
                      change(i, "after_previous", e.target.checked)
                    }
                  />
                  Depends on previous step
                </label>
              )}
              <button
                type="button"
                className="text-button"
                disabled={steps.length === 1}
                onClick={() =>
                  setSteps(
                    steps
                      .filter((_, n) => n !== i)
                      .map((step) => ({
                        ...step,
                        depends_on: (step.depends_on || [])
                          .filter((n) => n !== i + 1)
                          .map((n) => (n > i + 1 ? n - 1 : n)),
                      })),
                  )
                }
              >
                Remove step {i + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="button"
            disabled={steps.length >= 50}
            onClick={() =>
              setSteps([
                ...steps,
                {
                  title: "",
                  phase: "Production",
                  description: "",
                  offset_days: 0,
                  estimated_minutes: 0,
                  after_previous: false,
                },
              ])
            }
          >
            Add step
          </button>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            {busy ? "Working…" : "Save blueprint"}
          </button>
        </form>
      </Modal>
    </>
  );
}
