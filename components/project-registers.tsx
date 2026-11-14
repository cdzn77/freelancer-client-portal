"use client";
import { csvCell } from "@/lib/csv";
import { useCallback, useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import { supabase } from "@/lib/supabase";
import { localDate } from "@/lib/work-planning";
import { Field, Modal, Panel } from "./ui";
import { managesProject } from "./access";
type RecordItem = {
  id: string;
  kind: string;
  title: string;
  details: Record<string, string>;
  status: string;
  record_date: string;
  source_kind: string | null;
  source_id: string | null;
  is_published: boolean;
  superseded_by: string | null;
  revision: number;
};
type Source = { id: string; kind: string; label: string };
const decisionStates = ["Proposed", "Decided", "Superseded", "Archived"],
  findingStates = ["Open", "In progress", "Validated", "Dismissed", "Archived"];
export function ProjectRegisters({
  ctx,
  projectId,
  kind,
}: {
  ctx: StudioContext;
  projectId: string;
  kind: "Decision" | "Finding";
}) {
  const client = ctx.workspace.role === "client" || !!ctx.readOnly,
    editable = !client && managesProject(ctx, projectId);
  const [records, setRecords] = useState<RecordItem[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [editing, setEditing] = useState<RecordItem | "new" | null>(null),
    [filter, setFilter] = useState(""),
    [query, setQuery] = useState(""),
    [history, setHistory] = useState<{
      record: string;
      items: { revision: number; changed_at: string; snapshot: RecordItem }[];
    } | null>(null);
  const load = useCallback(async () => {
    setLoaded(false);
    setError("");
    const r = ctx.readOnly
      ? await supabase.rpc("preview_project_registers", {
          p_project: projectId,
          p_client: ctx.userId,
        })
      : await supabase
          .from("project_registers")
          .select("*")
          .eq("project_id", projectId)
          .order("record_date", { ascending: false });
    if (r.error) setError(r.error.message);
    else setRecords(r.data || []);
    setLoaded(true);
  }, [projectId, ctx.readOnly, ctx.userId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!editable) return;
    let live = true;
    void Promise.all([
      supabase
        .from("discussion_threads")
        .select("id,title")
        .eq("project_id", projectId)
        .is("deleted_at", null),
      supabase
        .from("client_documents")
        .select("id,title")
        .eq("project_id", projectId),
    ]).then(([threads, docs]) => {
      if (!live) return;
      setSources([
        ...ctx.data.tasks
          .filter((t) => t.project_id === projectId)
          .map((t) => ({ id: t.id, kind: "Task", label: t.title })),
        ...ctx.data.project_files
          .filter((f) => f.project_id === projectId)
          .map((f) => ({ id: f.id, kind: "File", label: f.name })),
        ...ctx.data.deliverable_versions
          .filter((v) => v.project_id === projectId)
          .map((v) => ({
            id: v.id,
            kind: "Review",
            label: `${ctx.data.deliverables.find((d) => d.id === v.deliverable_id)?.title || "Review"} · v${v.version_number}`,
          })),
        ...(threads.data || []).map((t) => ({
          id: t.id,
          kind: "Discussion",
          label: t.title,
        })),
        ...(docs.data || []).map((d) => ({
          id: d.id,
          kind: "Document",
          label: d.title,
        })),
      ]);
    });
    return () => {
      live = false;
    };
  }, [editable, ctx.data, projectId]);
  const current = editing && editing !== "new" ? editing : null,
    states = kind === "Decision" ? decisionStates : findingStates;
  const shown = records.filter(
    (r) =>
      r.kind === kind &&
      (!filter || r.status === filter) &&
      (!query ||
        (r.title + JSON.stringify(r.details))
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  function exportCSV() {
    const keys =
      kind === "Decision"
        ? ["maker", "rationale"]
        : [
            "evidence_type",
            "flow",
            "severity",
            "criterion",
            "evidence",
            "recommendation",
            "owner",
            "validation",
          ];

    const rows = [
      [
        "Title",
        "Date",
        "Status",
        "Shared",
        ...keys,
        "Source type",
        "Source ID",
        "Superseded by",
        "Revision",
      ],
      ...shown.map((r) => [
        r.title,
        r.record_date,
        r.status,
        r.is_published,
        ...keys.map((k) => r.details[k]),
        r.source_kind,
        r.source_id,
        r.superseded_by,
        r.revision,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind.toLowerCase()}-register.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function sourceURL(r: RecordItem) {
    const u = new URL(window.location.href);
    if (r.source_kind === "Document") {
      u.pathname = "/";
      u.searchParams.set("page", "Documents & payments");
      u.searchParams.set("clientDocument", r.source_id || "");
    } else if (client) {
      u.searchParams.set(
        "clientSection",
        r.source_kind === "Task"
          ? "Tasks"
          : r.source_kind === "File"
            ? "Files"
            : r.source_kind === "Review"
              ? "Feedback"
              : "Messages",
      );
      if (r.source_kind === "Discussion")
        u.searchParams.set("discussion", r.source_id || "");
    } else {
      u.searchParams.set(
        "section",
        r.source_kind === "Task"
          ? "Tasks"
          : r.source_kind === "File"
            ? "Files"
            : r.source_kind === "Review"
              ? "Review"
              : "Discussions",
      );
      if (r.source_kind === "Discussion")
        u.searchParams.set("discussion", r.source_id || "");
      if (r.source_kind === "Task")
        u.searchParams.set("task", r.source_id || "");
    }
    return u.toString();
  }
  return (
    <Panel
      title={kind === "Decision" ? "Decision register" : "Audit findings"}
      bodyClassName="panel-body"
      subtitle={
        kind === "Decision"
          ? "Record why a choice was made and which decision replaces it. Formal sign-off stays in Reviews and Documents & payments."
          : "Record evidence, severity and validation. A finding is not a conformance certification."
      }
    >
      <div className="toolbar">
        <Field label={`Search ${kind.toLowerCase()} records`}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field label="Record status">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <button className="button" onClick={exportCSV}>
          Export {kind.toLowerCase()} CSV
        </button>
        {editable && (
          <button
            className="button primary"
            onClick={() => {
              setError("");
              setEditing("new");
            }}
          >
            New {kind.toLowerCase()}
          </button>
        )}
        <button className="text-button" onClick={() => void load()}>
          Refresh register
        </button>
      </div>
      {!loaded && <p role="status">Loading register…</p>}
      {loaded && !shown.length && (
        <p>No {kind.toLowerCase()} records match this view.</p>
      )}
      {error && !editing && <p role="alert">{error}</p>}
      {shown.map((r) => (
        <article id={`record-${r.id}`} className="operation-section" key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {r.record_date} · {r.status} ·{" "}
            {r.is_published ? "Shared" : "Internal"} · Revision {r.revision}
          </p>
          <dl>
            {Object.entries(r.details)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{v}</dd>
                </div>
              ))}
          </dl>
          {r.source_id &&
            (ctx.readOnly && r.source_kind === "Document" ? (
              <button
                className="text-button"
                onClick={() =>
                  ctx.notify(
                    "Document sources are outside this project preview. Return to admin to open them.",
                  )
                }
              >
                Open document source
              </button>
            ) : r.source_kind === "Task" &&
              ctx.data.tasks.some((t) => t.id === r.source_id) ? (
              <button
                className="text-button"
                onClick={() =>
                  ctx.openTask(ctx.data.tasks.find((t) => t.id === r.source_id))
                }
              >
                Open task source
              </button>
            ) : (
              <a className="text-button" href={sourceURL(r)}>
                Open {r.source_kind?.toLowerCase()} source
              </a>
            ))}
          {r.superseded_by && (
            <p>
              Replaced by:{" "}
              <a href={`#record-${r.superseded_by}`}>
                {records.find((n) => n.id === r.superseded_by)?.title ||
                  "Decision unavailable"}
              </a>
            </p>
          )}
          {editable && (
            <button
              className="button"
              onClick={() => {
                setError("");
                setEditing(r);
              }}
            >
              Edit {kind.toLowerCase()}
            </button>
          )}
          {!client && (
            <button
              className="text-button"
              onClick={async () => {
                const h = await supabase
                  .from("project_register_history")
                  .select("revision,changed_at,snapshot")
                  .eq("record_id", r.id)
                  .order("revision", { ascending: false });
                if (h.error) setError(h.error.message);
                else setHistory({ record: r.title, items: h.data || [] });
              }}
            >
              View revision history
            </button>
          )}
        </article>
      ))}
      <Modal
        open={!!editing}
        onClose={() => !busy && setEditing(null)}
        title={`${current ? "Edit" : "New"} ${kind.toLowerCase()}`}
        description="Changes create a new history entry. Use Archived to retain a record without treating it as current."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            const details: Record<string, string> = {};
            for (const k of kind === "Decision"
              ? ["maker", "rationale"]
              : [
                  "evidence_type",
                  "flow",
                  "severity",
                  "criterion",
                  "evidence",
                  "recommendation",
                  "owner",
                  "validation",
                ])
              details[k] = String(f.get(k) || "").trim();
            const [source_type, source] = String(f.get("source") || "").split(
              ":",
            );
            const result = await supabase.rpc("save_project_register", {
              p_project: projectId,
              record_id: current?.id || null,
              expected_revision: current?.revision || 0,
              record_kind: kind,
              record_title: f.get("title"),
              record_details: details,
              record_status: f.get("status"),
              record_day: f.get("date"),
              source_type: source_type || null,
              source: source || null,
              published: f.get("published") === "on",
              replacement: f.get("replacement") || null,
            });
            if (result.error) setError(result.error.message);
            else {
              setEditing(null);
              await load();
            }
            setBusy(false);
          }}
        >
          <Field label="Title">
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={current?.title}
            />
          </Field>
          <Field label="Record date">
            <input
              type="date"
              name="date"
              required
              defaultValue={current?.record_date || localDate()}
            />
          </Field>
          <Field label="Status">
            <select
              aria-label="Status"
              name="status"
              defaultValue={current?.status || states[0]}
            >
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          {kind === "Decision" ? (
            <>
              <Field label="Decision maker">
                <input
                  name="maker"
                  required
                  maxLength={200}
                  defaultValue={current?.details.maker}
                />
              </Field>
              <Field label="Rationale">
                <textarea
                  name="rationale"
                  required
                  rows={4}
                  maxLength={6000}
                  defaultValue={current?.details.rationale}
                />
              </Field>
              <Field label="Replacement decision (when superseded)">
                <select
                  name="replacement"
                  defaultValue={current?.superseded_by || ""}
                >
                  <option value="">No replacement</option>
                  {records
                    .filter(
                      (r) =>
                        r.kind === "Decision" &&
                        r.status === "Decided" &&
                        r.id !== current?.id,
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Evidence type">
                <select
                  name="evidence_type"
                  defaultValue={current?.details.evidence_type || "Observation"}
                >
                  <option>Observation</option>
                  <option>Hypothesis</option>
                </select>
              </Field>
              <Field label="Affected flow">
                <input
                  name="flow"
                  required
                  maxLength={300}
                  defaultValue={current?.details.flow}
                />
              </Field>
              <Field label="Severity">
                <select
                  name="severity"
                  defaultValue={current?.details.severity || "Medium"}
                >
                  {["Low", "Medium", "High", "Critical"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Heuristic or WCAG criterion">
                <input
                  name="criterion"
                  maxLength={300}
                  placeholder="For example, WCAG 2.2 1.4.3"
                  defaultValue={current?.details.criterion}
                />
              </Field>
              <Field label="Evidence">
                <textarea
                  name="evidence"
                  required
                  rows={3}
                  maxLength={6000}
                  defaultValue={current?.details.evidence}
                />
              </Field>
              <Field label="Recommendation">
                <textarea
                  name="recommendation"
                  required
                  rows={3}
                  maxLength={6000}
                  defaultValue={current?.details.recommendation}
                />
              </Field>
              <Field label="Finding owner">
                <input
                  name="owner"
                  maxLength={200}
                  defaultValue={current?.details.owner}
                />
              </Field>
              <Field label="Validation result">
                <textarea
                  name="validation"
                  rows={3}
                  maxLength={6000}
                  placeholder="How it was tested, when, and the result"
                  defaultValue={current?.details.validation}
                />
              </Field>
            </>
          )}
          <Field label="Source or evidence file">
            <select
              name="source"
              defaultValue={
                current?.source_id
                  ? `${current.source_kind}:${current.source_id}`
                  : ""
              }
            >
              <option value="">No linked source</option>
              {sources.map((s) => (
                <option key={s.kind + s.id} value={`${s.kind}:${s.id}`}>
                  {s.kind}: {s.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="sharing-choice">
            <input
              type="checkbox"
              name="published"
              defaultChecked={current?.is_published}
            />
            Share this record with invited clients
          </label>
          <p className="muted">
            Clients need Discussions enabled. A linked source must also be
            visible to that client. Revision history stays internal. Review all
            text before sharing.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            Save {kind.toLowerCase()}
          </button>
        </form>
      </Modal>
      <Modal
        open={!!history}
        onClose={() => setHistory(null)}
        title={`History: ${history?.record || ""}`}
        description="Saved revisions are retained for the project team."
      >
        {history?.items.map((h) => (
          <article className="operation-section" key={h.revision}>
            <h3>
              Revision {h.revision} · {new Date(h.changed_at).toLocaleString()}
            </h3>
            <p>
              {h.snapshot.title} · {h.snapshot.status} ·{" "}
              {h.snapshot.is_published ? "Shared" : "Internal"}
            </p>
            <dl>
              {Object.entries(h.snapshot.details).map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </Modal>
    </Panel>
  );
}
