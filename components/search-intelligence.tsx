"use client";
import { brand } from "../lib/brand";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import {
  brandEvidence,
  changePercent,
  measurementState,
  opportunities,
  type SearchRow,
} from "@/lib/search-intelligence";
import { ChroniclesMonitor } from "./chronicles-monitor";
import { Panel } from "./ui";
import { fullMonitorReport } from "@/lib/monitor-report";
import {
  IntelligenceOverview,
  IntelligenceSettings,
  AIRunPanel,
  CrawlPanel,
  ChangeMeasurements,
} from "./monitor-intelligence-panels";
import {
  activeAction,
  advisor,
  keywordStatus,
  changeStage,
} from "@/lib/monitor-intelligence";
import type { StudioContext } from "./studio";
type RecordRow = {
  id: string;
  kind: string;
  source_id: string;
  title: string;
  body: any;
  linked_task_id?: string;
};
const tabs = [
  "Overview",
  "Search",
  "Chronicles",
  "Keywords",
  "Suggestions",
  "AI visibility",
  "Changes",
  "Operations",
  "Settings",
] as const;
const n = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "Not available";
const pct = (v: unknown) =>
  typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "Not available";
function SearchTable({
  rows,
  label,
  onReview,
  busy,
  saved = [],
}: {
  rows: SearchRow[];
  label: string;
  onReview?: (row: SearchRow) => void;
  busy?: boolean;
  saved?: string[];
}) {
  const [filter, setFilter] = useState(""),
    [page, setPage] = useState(0);
  const [sort, setSort] = useState<
    "clicks" | "impressions" | "ctr" | "position"
  >("clicks");
  const filtered = rows.filter((r) =>
    r.keys?.[0]?.toLowerCase().includes(filter.toLowerCase()),
  );
  filtered.sort((a, b) =>
    sort === "position" ? a[sort] - b[sort] : b[sort] - a[sort],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    current = Math.min(page, pages - 1);
  return (
    <Panel title={label} bodyClassName="search-panel-body">
      <label className="field">
        Filter {label.toLowerCase()}
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <label>
        Sort by
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setPage(0);
          }}
        >
          <option value="clicks">Most clicks</option>
          <option value="impressions">Most impressions</option>
          <option value="ctr">Highest CTR</option>
          <option value="position">Best position</option>
        </select>
      </label>
      <div
        className="website-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Report data"
      >
        <table className="website-table">
          <thead>
            <tr>
              <th>{label}</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>CTR</th>
              <th>Position</th>
              {onReview && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 10, current * 10 + 10).map((r) => (
              <tr key={r.keys?.[0]}>
                <td>{r.keys?.[0]}</td>
                <td>{n(r.clicks)}</td>
                <td>{n(r.impressions)}</td>
                <td>{pct(r.ctr)}</td>
                <td>{n(r.position)}</td>
                {onReview && (
                  <td>
                    <button
                      className="button small"
                      disabled={busy || saved.includes(r.keys?.[0] || "")}
                      onClick={() => onReview(r)}
                    >
                      {saved.includes(r.keys?.[0] || "")
                        ? "Action saved"
                        : "Save action"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>No matching rows.</p>}
      <div className="search-actions">
        <button
          className="button small"
          disabled={!current}
          onClick={() => setPage(current - 1)}
        >
          Previous
        </button>
        <span>
          Page {current + 1} of {pages} · {filtered.length} rows
        </span>
        <button
          className="button small"
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          Next
        </button>
      </div>
    </Panel>
  );
}
function SearchTrend({ report }: { report: any }) {
  const [metric, setMetric] = useState<
    "clicks" | "impressions" | "ctr" | "position"
  >("clicks");
  const series = [
    {
      label: "Current 28 days",
      rows: report.trend || [],
      start: report.windows.current.startDate,
    },
    {
      label: "Previous 28 days",
      rows: report.previousTrend || [],
      start: report.windows.previous?.startDate,
    },
    {
      label: "364 days earlier",
      rows: report.yearTrend || [],
      start: report.windows.year?.startDate,
    },
  ];
  const maximum = Math.max(
    metric === "ctr" ? 0.001 : 1,
    ...series.flatMap((s) =>
      s.rows.map((row: SearchRow) => Number(row[metric]) || 0),
    ),
  );
  return (
    <div className="search-chart">
      <div className="website-segments" aria-label="Chart metric">
        {(
          [
            ["clicks", "Clicks"],
            ["impressions", "Impressions"],
            ["ctr", "CTR"],
            ["position", "Position"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 800 180"
        role="img"
        aria-label={`${metric}: current, previous and annual periods`}
        className="search-trend"
      >
        {[0, 1, 2].map((i) => (
          <line
            key={i}
            x1="40"
            x2="780"
            y1={20 + i * 65}
            y2={20 + i * 65}
            stroke="#dddddd"
          />
        ))}
        <text x="4" y="24" fontSize="11" fill="currentColor">
          {metric === "ctr" ? pct(maximum) : n(maximum)}
        </text>
        <text x="4" y="150" fontSize="11" fill="currentColor">
          0
        </text>
        {series.map((s, index) => {
          const points = s.rows.map((row: SearchRow, i: number) => {
            const day =
              row.keys?.[0] && s.start
                ? (Date.parse(row.keys[0]) - Date.parse(s.start)) / 86400000
                : i;
            return {
              x: 40 + (Math.max(0, Math.min(27, day)) / 27) * 740,
              y: 150 - (Number(row[metric]) / maximum) * 130,
            };
          });
          return (
            <g key={s.label} opacity={index ? 0.5 : 1}>
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={
                  index === 2 ? "2 4" : index ? "6 5" : undefined
                }
                points={points
                  .map((p: { x: number; y: number }) => `${p.x},${p.y}`)
                  .join(" ")}
              />
              {points.map((p: { x: number; y: number }, i: number) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="currentColor" />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="search-chart-legend">
        <span>━━ Current 28 days</span>
        <span>┄┄ Previous 28 days</span>
        <span>··· 364 days earlier</span>
        <span>Day 1 → Day 28</span>
      </div>
      {metric === "position" && (
        <p className="muted">Lower position is better.</p>
      )}
    </div>
  );
}
export function SearchIntelligence({
  ctx,
  view,
  onNavigate,
  monitor = {},
}: {
  ctx: StudioContext;
  view?: string;
  onNavigate?: (view: string) => void;
  monitor?: any;
}) {
  const [localTab, setLocalTab] = useState<string>("Search"),
    [records, setRecords] = useState<RecordRow[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const tab = view || localTab;
  const setTab = (next: string) =>
    onNavigate ? onNavigate(next) : setLocalTab(next);
  const [showHistory, setShowHistory] = useState(false);
  const keywordForm = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState(""),
    [source, setSource] = useState("Manual"),
    [selectedProject, setSelectedProject] = useState("");
  const sequence = useRef(0),
    workspace = ctx.workspace.id;
  const active = useRef(workspace);
  active.current = workspace;
  const endpoint = `/api/monitor/search?workspace=${workspace}`;
  async function headers() {
    const { data } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${data.session?.access_token}`,
      "Content-Type": "application/json",
    };
  }
  async function load() {
    const seq = ++sequence.current;
    try {
      const r = await fetch(endpoint, { headers: await headers() });
      const value = await r.json();
      if (!r.ok) throw Error(value.error);
      if (seq === sequence.current) setRecords(value.records || []);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setRecords([]);
    setError("");
    setLoading(true);
    setBusy(false);
    setSelectedProject("");
    void load();
    return () => {
      sequence.current++;
    };
  }, [workspace]);
  async function save(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(input),
      });
      const value = await r.json();
      if (!r.ok) throw Error(value.error);
      if (active.current !== workspace) return false;
      await load();
      ctx.notify(
        value.error
          ? value.error
          : value.skipped
            ? "A refresh ran recently. Try again in two minutes."
            : "Search intelligence saved.",
      );
      return true;
    } catch (e) {
      if (active.current === workspace) setError((e as Error).message);
      return false;
    } finally {
      if (active.current === workspace) setBusy(false);
    }
  }
  const report = records.find((r) => r.kind === "search_report")?.body;
  const byKind = (kind: string) => records.filter((r) => r.kind === kind);
  const ideas = advisor(report, monitor.health, byKind("crawl")[0]?.body);
  const answers = byKind("answer");
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  };
  const metrics = [
    ["clicks", "Search clicks"],
    ["impressions", "Impressions"],
    ["ctr", "Click-through rate"],
    ["position", "Average position"],
  ];
  async function task(r: RecordRow) {
    if (!selectedProject) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("monitor_create_task", {
      record_id: r.id,
      project: selectedProject,
    });
    if (active.current !== workspace) return;
    if (error) setError("Could not create the task. Check project access.");
    else {
      await load();
      await ctx.refresh();
      ctx.notify("Private studio task linked.");
    }
    setBusy(false);
  }
  async function review(row: SearchRow, kind: "page" | "query") {
    const subject = row.keys?.[0] || "";
    const saved = await save({
      action: "suggestion",
      key: `review:${kind}:${subject}`,
      title: `Review ${kind}: ${subject}`,
      evidence: `${n(row.clicks)} clicks from ${n(row.impressions)} impressions; CTR ${pct(row.ctr)}; average position ${n(row.position)}. Window: ${report.windows.current.startDate} to ${report.windows.current.endDate}. ${row.impressions < 100 ? "Small sample: treat this as an investigation, not a proven issue." : "Review the context before editing."}`,
      next:
        kind === "page"
          ? "Check the page's title, description and opening content against the searches bringing it impressions. Confirm it is the intended current URL. Record any shipped change with a baseline."
          : "Find the page answering this search in Search Console. Check search intent, the result snippet and the page's opening answer before choosing a change.",
      state: "Open",
    });
    if (saved) setTab("Suggestions");
  }
  const leadingPages: SearchRow[] = [...(report?.pages || [])]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3);
  return (
    <section className="search-intelligence">
      <div className="page-heading">
        <div>
          <h2>{tab === "Overview" ? "Studio intelligence" : tab}</h2>
          <p>Search opportunities for {brand.domain}.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([fullMonitorReport(records, monitor)], {
                type: "text/html",
              }),
            );
            window.open(url, "_blank", "noopener,noreferrer");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          }}
        >
          Full report / PDF
        </button>
      </div>
      {!view && (
        <nav className="website-views" aria-label="Search intelligence views">
          {tabs.map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <p role="alert" className="website-notice">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading search intelligence…</p>}
      {tab === "Overview" && (
        <IntelligenceOverview
          report={report}
          records={records}
          monitor={monitor}
          navigate={setTab}
        />
      )}
      {tab === "Chronicles" && (
        <ChroniclesMonitor
          report={report}
          records={records}
          busy={busy}
          save={save}
        />
      )}
      {tab === "Settings" && (
        <IntelligenceSettings
          records={records}
          monitor={monitor}
          save={save}
          busy={busy}
        />
      )}
      {tab === "Operations" && (
        <CrawlPanel records={records} save={save} busy={busy} />
      )}
      {tab === "Search" && (
        <>
          <Panel
            bodyClassName="search-panel-body"
            title="Google Search Console"
            subtitle="Your site's search performance. Free Google service."
            action={
              <button
                className="button"
                disabled={busy || loading}
                onClick={() => save({ action: "refresh" })}
              >
                {busy ? "Refreshing…" : "Refresh search"}
              </button>
            }
          >
            {!report ? (
              <p>
                No search report yet. Your Google connection needs read access
                to the verified {brand.domain} Search Console property.
                Refresh after connecting it.
              </p>
            ) : (
              <>
                <p>
                  {report.windows.current.startDate} to{" "}
                  {report.windows.current.endDate} · Collected{" "}
                  {new Date(report.fetched_at).toLocaleString()}
                </p>
                <div className="website-metrics">
                  {metrics.map(([key, label]) => {
                    const value = report.totals.current[key],
                      prev = changePercent(value, report.totals.previous[key]),
                      year = changePercent(value, report.totals.year[key]);
                    return (
                      <div className="website-metric" key={key}>
                        <span>{label}</span>
                        <strong>{key === "ctr" ? pct(value) : n(value)}</strong>
                        <small>
                          {prev === null
                            ? "No prior comparison"
                            : `${prev > 0 ? "+" : ""}${prev.toFixed(1)}% vs previous 28 days`}
                        </small>
                        <small>
                          {year === null
                            ? "No annual comparison"
                            : `${year > 0 ? "+" : ""}${year.toFixed(1)}% vs 364 days earlier`}
                        </small>
                        {key === "position" && (
                          <small>Lower position is better.</small>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="muted">{report.note}</p>
                <div className="search-briefing">
                  <div>
                    <h3>Where things stand</h3>
                    <p>
                      {n(report.totals.current.clicks)} clicks from{" "}
                      {n(report.totals.current.impressions)} impressions,
                      compared with {n(report.totals.previous.clicks)} clicks
                      from {n(report.totals.previous.impressions)} impressions
                      in the previous 28 days.
                    </p>
                    <p>
                      {report.totals.current.impressions < 500
                        ? "Search volume is still small. A few clicks can move the percentages sharply. Use these figures to choose what to investigate and compare a full period after changes."
                        : "Compare clicks and impressions together, then inspect the pages below before deciding what to change."}
                    </p>
                    <button
                      className="button small"
                      onClick={() => setTab("Suggestions")}
                    >
                      Open saved actions (
                      {
                        byKind("suggestion").filter(
                          (r) => r.body.state !== "Resolved",
                        ).length
                      }
                      )
                    </button>
                  </div>
                  <div>
                    <h3>Pages to investigate first</h3>
                    <p className="muted">
                      Highest impressions in this report. Review candidates, not
                      confirmed problems.
                    </p>
                    {leadingPages.map((row) => (
                      <div className="search-review-row" key={row.keys?.[0]}>
                        <div>
                          <strong>
                            {row.keys?.[0]?.replace(
                              (brand.websiteUrl),
                              "",
                            ) || "/"}
                          </strong>
                          <p>
                            {n(row.impressions)} impressions · {n(row.clicks)}{" "}
                            clicks · {pct(row.ctr)} CTR
                          </p>
                        </div>
                        <button
                          className="button small"
                          disabled={
                            busy ||
                            byKind("suggestion").some(
                              (r) =>
                                r.source_id === `review:page:${row.keys?.[0]}`,
                            )
                          }
                          onClick={() => review(row, "page")}
                        >
                          {byKind("suggestion").some(
                            (r) =>
                              r.source_id === `review:page:${row.keys?.[0]}`,
                          )
                            ? "Action saved"
                            : "Save action"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Panel>
          {report && (
            <>
              <Panel
                bodyClassName="search-panel-body"
                title="Daily search performance"
                subtitle="Current, previous and annual 28-day periods, aligned by day. Missing observations are omitted; lines connect available dates."
              >
                <SearchTrend report={report} />
                <details>
                  <summary>Read daily values</summary>
                  <SearchTable rows={report.trend} label="Dates" />
                </details>
              </Panel>
              <SearchTable
                rows={report.queries}
                label="Queries"
                busy={busy}
                onReview={(row) => review(row, "query")}
                saved={byKind("suggestion")
                  .filter((r) => r.source_id.startsWith("review:query:"))
                  .map((r) => r.source_id.slice(13))}
              />
              <SearchTable
                rows={report.pages}
                label="Pages"
                busy={busy}
                onReview={(row) => review(row, "page")}
                saved={byKind("suggestion")
                  .filter((r) => r.source_id.startsWith("review:page:"))
                  .map((r) => r.source_id.slice(12))}
              />
            </>
          )}
        </>
      )}
      {tab === "Keywords" && (
        <>
          <Panel
            bodyClassName="search-panel-body"
            title="Discover with Google Autocomplete"
            subtitle="Suggestions show searches to explore. They do not provide volume or ranking."
          >
            <form
              className="search-form"
              onSubmit={(e) => save({ action: "discover", ...form(e) })}
            >
              <label>
                Search seed
                <input
                  name="seed"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="brand design studio"
                />
              </label>
              <label>
                Language
                <select name="language">
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                </select>
              </label>
              <label>
                Country
                <select name="country">
                  <option value="us">United States</option>
                  <option value="gb">United Kingdom</option>
                  <option value="ca">Canada</option>
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                Find suggestions
              </button>
            </form>
            <p className="muted">
              No API key required. Google can limit this public service; saved
              discoveries remain available.
            </p>
            {byKind("discovery").map((r) => (
              <details key={r.id}>
                <summary>
                  {r.title} · {r.body.language}/{r.body.country} ·{" "}
                  {new Date(r.body.fetched_at).toLocaleDateString()}
                </summary>
                <ul>
                  {r.body.suggestions.map((s: string) => (
                    <li key={s} className="search-actions">
                      <span>{s}</span>
                      <button
                        className="button small"
                        onClick={() => {
                          setQuery(s);
                          setSource("Google Autocomplete");
                        }}
                      >
                        Use keyword
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </Panel>
          <Panel
            bodyClassName="search-panel-body"
            title="Keyword targets"
            subtitle="Save a phrase with its purpose and the page that should answer it."
          >
            <form
              ref={keywordForm}
              className="search-form"
              onSubmit={async (e) => {
                const data = form(e);
                if (await save({ action: "keyword", ...data, query, source })) {
                  setQuery("");
                  setSource("Manual");
                }
              }}
            >
              <label>
                Keyword
                <input
                  required
                  maxLength={200}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSource("Manual");
                  }}
                />
              </label>
              <label>
                Target page
                <input
                  name="page"
                  required
                  defaultValue="/"
                  placeholder="/info/"
                />
              </label>
              <label>
                Intent
                <select name="intent">
                  <option value="buyer">Buyer</option>
                  <option value="research">Research</option>
                  <option value="brand">Brand</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority">
                  <option value="1">1 · High</option>
                  <option value="2">2 · Medium</option>
                  <option value="3">3 · Low</option>
                </select>
              </label>
              <label>
                Approval
                <select name="approval">
                  <option>Draft</option>
                  <option>Approved</option>
                  <option>Rejected</option>
                </select>
              </label>
              <label>
                Why this keyword matters
                <input name="rationale" maxLength={2000} />
              </label>
              <label>
                Next action
                <input name="next" maxLength={2000} />
              </label>
              <button className="button primary" disabled={busy}>
                Save target
              </button>
            </form>
            <p className="muted">
              Source: {source}. Saving the same phrase updates its target.
            </p>
            <div
              className="website-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Report data"
            >
              <table className="website-table">
                <thead>
                  <tr>
                    <th>Search</th>
                    <th>Intent</th>
                    <th>Page</th>
                    <th>Priority</th>
                    <th>Source</th>
                    <th>Position</th>
                    <th>Impressions</th>
                    <th>90-day impressions</th>
                    <th>16-month impressions</th>
                    <th>Position group</th>
                    <th>Approval</th>
                    <th>Rationale</th>
                    <th>Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {byKind("keyword").map((r) => {
                    const observed = report?.queries?.find(
                      (q: SearchRow) =>
                        q.keys?.[0]?.toLowerCase() === r.title.toLowerCase(),
                    );
                    return (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="button small"
                            onClick={() => {
                              setQuery(r.title);
                              setSource(r.body.source);
                              for (const key of [
                                "page",
                                "intent",
                                "priority",
                                "next",
                                "approval",
                                "rationale",
                              ]) {
                                const field =
                                  keywordForm.current?.elements.namedItem(
                                    key,
                                  ) as
                                    HTMLInputElement | HTMLSelectElement | null;
                                if (field)
                                  field.value =
                                    r.body[key] ||
                                    (key === "approval" ? "Draft" : "");
                              }
                              keywordForm.current?.scrollIntoView({
                                block: "center",
                              });
                            }}
                          >
                            {r.title}
                          </button>
                        </td>
                        <td>{r.body.intent}</td>
                        <td>{r.body.page}</td>
                        <td>{r.body.priority}</td>
                        <td>{r.body.source}</td>
                        <td>{n(observed?.position)}</td>
                        <td>{n(observed?.impressions)}</td>
                        <td>
                          {n(
                            report?.keywordHistory?.ninety?.find(
                              (q: SearchRow) =>
                                q.keys?.[0]?.toLowerCase() ===
                                r.title.toLowerCase(),
                            )?.impressions,
                          )}
                        </td>
                        <td>
                          {n(
                            report?.keywordHistory?.sixteenMonths?.find(
                              (q: SearchRow) =>
                                q.keys?.[0]?.toLowerCase() ===
                                r.title.toLowerCase(),
                            )?.impressions,
                          )}
                        </td>
                        <td>{keywordStatus(observed, r.body.intent)}</td>
                        <td>{r.body.approval || "Draft"}</td>
                        <td>{r.body.rationale || "Not recorded"}</td>
                        <td>{r.body.next}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Metrics use exact matches in the saved Search Console query
              report. A missing row is unknown, not zero demand.
            </p>
          </Panel>
        </>
      )}
      {tab === "Suggestions" && (
        <>
          <Panel
            bodyClassName="search-panel-body"
            title="Evidence-based opportunities"
            subtitle="Rules applied to saved Search Console observations. Review before making website changes."
          >
            {!ideas.length && (
              <p>No opportunities identified from the available report.</p>
            )}
            {ideas.map((idea) => (
              <article key={idea.key} className="search-card">
                <div className="search-actions">
                  <span className="badge">Priority {idea.priority}</span>
                  <span>
                    {idea.category} · {idea.effort} effort · {idea.confidence}
                  </span>
                </div>
                <h3>{idea.title}</h3>
                <p>{idea.evidence}</p>
                <p>{idea.next}</p>
                <details>
                  <summary>Implementation brief</summary>
                  <p>
                    Review {idea.page || "the page answering this query"}.
                    Evidence: {idea.evidence} Next step: {idea.next} Preserve a
                    baseline before shipping and record how the change was
                    verified.
                  </p>
                </details>
                <button
                  className="button"
                  disabled={
                    busy ||
                    byKind("suggestion").some((r) => r.source_id === idea.key)
                  }
                  onClick={() =>
                    save({ action: "suggestion", ...idea, state: "Open" })
                  }
                >
                  Save suggestion
                </button>
              </article>
            ))}
          </Panel>
          <Panel
            bodyClassName="search-panel-body"
            title="Saved actions"
            subtitle="Resolving an action records your decision. It does not edit the website."
          >
            <label className="field">
              Internal project for linked tasks
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="">Choose a studio project</option>
                {ctx.data.projects
                  .filter((p) => !p.archived_at && !p.deleted_at)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="search-actions">
              <button
                className="button small"
                aria-pressed={!showHistory}
                onClick={() => setShowHistory(false)}
              >
                Active actions
              </button>
              <button
                className="button small"
                aria-pressed={showHistory}
                onClick={() => setShowHistory(true)}
              >
                Resolved, dismissed and snoozed
              </button>
            </div>
            {byKind("suggestion")
              .filter((r) =>
                showHistory ? !activeAction(r.body) : activeAction(r.body),
              )
              .sort((a, b) =>
                (a.body.priority || "2").localeCompare(b.body.priority || "2"),
              )
              .map((r) => (
                <article className="search-card" key={r.id}>
                  <div className="search-actions">
                    <span className="badge">
                      Priority {r.body.priority || "2"}
                    </span>
                    <span>
                      {r.body.category || "Search"} ·{" "}
                      {r.body.effort || "Medium"} effort
                    </span>
                  </div>
                  <h3>{r.title}</h3>
                  <p>{r.body.evidence}</p>
                  <p>{r.body.next}</p>
                  <p>
                    Status: {r.body.state}
                    {r.body.snoozed_until
                      ? ` until ${new Date(r.body.snoozed_until).toLocaleDateString()}`
                      : ""}
                  </p>
                  <div className="search-actions">
                    {[
                      "Open",
                      "Acknowledged",
                      "Snoozed",
                      "Resolved",
                      "Dismissed",
                    ].map((state) => (
                      <button
                        key={state}
                        className="button small"
                        disabled={busy || r.body.state === state}
                        onClick={() =>
                          save({
                            ...r.body,
                            action: "suggestion",
                            key: r.source_id,
                            state,
                          })
                        }
                      >
                        {state === "Snoozed"
                          ? "Snooze 7 days"
                          : state === "Open"
                            ? "Reopen"
                            : state === "Acknowledged"
                              ? "Acknowledge"
                              : state === "Dismissed"
                                ? "Dismiss"
                                : "Resolve"}
                      </button>
                    ))}
                    <button
                      className="button small"
                      disabled={busy || !selectedProject || !!r.linked_task_id}
                      onClick={() => task(r)}
                    >
                      {r.linked_task_id ? "Task linked" : "Create private task"}
                    </button>
                  </div>
                </article>
              ))}
          </Panel>
        </>
      )}
      {tab === "AI visibility" && (
        <>
          <AIRunPanel records={records} />
          <button className="button" onClick={() => setTab("Settings")}>
            Manage prompts and competitors
          </button>
          <Panel
            bodyClassName="search-panel-body"
            title="Manual AI observations"
            subtitle="Use answers you collect through your existing ChatGPT, Claude or Kimi accounts. No paid API is called."
          >
            <p>
              Save the exact prompt, full answer, observation time and cited
              URLs. This measures the saved sample, not consumer rankings or all
              AI answers.
            </p>
            {answers.length > 0 && (
              <div className="website-metrics">
                <div className="website-metric">
                  <span>Brand mentions</span>
                  <strong>
                    {
                      answers.filter(
                        (r) =>
                          brandEvidence(r.body.answer, r.body.citations)
                            .mentioned,
                      ).length
                    }{" "}
                    / {answers.length}
                  </strong>
                </div>
                <div className="website-metric">
                  <span>Answers citing the website</span>
                  <strong>
                    {
                      answers.filter(
                        (r) =>
                          brandEvidence(r.body.answer, r.body.citations).cited,
                      ).length
                    }{" "}
                    / {answers.length}
                  </strong>
                </div>
              </div>
            )}
            <div
              className="website-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Report data"
            >
              <table className="website-table">
                <thead>
                  <tr>
                    <th>Engine</th>
                    <th>Observed answers</th>
                    <th>Brand mentions</th>
                    <th>Website citations</th>
                  </tr>
                </thead>
                <tbody>
                  {["ChatGPT", "Claude", "Kimi", "Gemini", "Other"].map(
                    (engine) => {
                      const sample = answers.filter(
                        (r) => r.body.engine === engine,
                      );
                      return (
                        <tr key={engine}>
                          <td>{engine}</td>
                          <td>{sample.length || "No observations"}</td>
                          <td>
                            {sample.length
                              ? sample.filter((r) => r.body.mentioned).length
                              : "Not measured"}
                          </td>
                          <td>
                            {sample.length
                              ? sample.filter((r) => r.body.cited).length
                              : "Not measured"}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
            <form
              className="search-form"
              onSubmit={async (e) => {
                const data = form(e);
                await save({
                  ...data,
                  action: "answer",
                  observed_at: new Date(String(data.observed_at)).toISOString(),
                  citations: String(data.citations || "")
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            >
              <label>
                Engine
                <select name="engine">
                  <option>ChatGPT</option>
                  <option>Claude</option>
                  <option>Gemini</option>
                  <option>Kimi</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Observed at
                <input type="datetime-local" required name="observed_at" />
              </label>
              <label className="search-wide">
                Prompt
                <textarea name="prompt" required maxLength={2000} />
              </label>
              <label className="search-wide">
                Full answer
                <textarea name="answer" required maxLength={20000} rows={6} />
              </label>
              <label className="search-wide">
                Cited URLs, one per line
                <textarea name="citations" rows={3} />
              </label>
              <button className="button primary" disabled={busy}>
                Save observation
              </button>
            </form>
          </Panel>
          {answers.map((r) => (
            <Panel
              bodyClassName="search-panel-body"
              key={r.id}
              title={r.body.engine}
              subtitle={`${new Date(r.body.observed_at).toLocaleString()} · Manual observation`}
            >
              <p>
                <strong>{r.title}</strong>
              </p>
              <p>
                {r.body.mentioned ? "Brand named" : "Brand not named"} ·{" "}
                {r.body.cited ? "Website cited" : "Website not cited"}
              </p>
              <details>
                <summary>Full evidence</summary>
                <p className="search-answer">{r.body.answer}</p>
                <ul>
                  {r.body.citations.map((url: string) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </Panel>
          ))}
        </>
      )}
      {tab === "Changes" && (
        <>
          <div className="website-metrics">
            {[
              "Still measuring",
              "Comparable window",
              "Verified",
              "Reverted",
            ].map((state) => (
              <div className="website-metric" key={state}>
                <span>{state}</span>
                <strong>
                  {
                    byKind("change").filter(
                      (r) => changeStage(r.body, report) === state,
                    ).length
                  }
                </strong>
              </div>
            ))}
          </div>
          <Panel
            bodyClassName="search-panel-body"
            title="Record a shipped change"
            subtitle="Save the current search report as a baseline when a website update ships."
          >
            <form
              className="search-form"
              onSubmit={(e) => save({ action: "change", ...form(e) })}
            >
              <label>
                Change title
                <input name="title" required minLength={3} maxLength={250} />
              </label>
              <label>
                Page
                <input name="page" required defaultValue="/" />
              </label>
              <label className="search-wide">
                What changed
                <textarea name="notes" maxLength={4000} />
              </label>
              <button className="button primary" disabled={busy}>
                Record change and baseline
              </button>
            </form>
          </Panel>
          {byKind("change").map((r) => (
            <Panel
              bodyClassName="search-panel-body"
              key={r.id}
              title={r.title}
              subtitle={`${r.body.page} · ${new Date(r.body.shipped_at).toLocaleString()}`}
            >
              <p>{r.body.notes}</p>
              <ChangeMeasurements
                record={r}
                report={report}
                save={save}
                busy={busy}
              />
              <strong>
                {measurementState(
                  r.body.shipped_at,
                  report?.windows?.current,
                  r.body.baseline?.windows?.current,
                )}
              </strong>
              <p>
                Sitewide clicks at baseline:{" "}
                {n(r.body.baseline?.totals?.current?.clicks)} · Latest:{" "}
                {n(report?.totals?.current?.clicks)}
              </p>
              <p className="muted">
                These totals cover the whole site. A later change does not
                establish causation. Comparisons need a full window after the
                recorded date.
              </p>
            </Panel>
          ))}
        </>
      )}
      <p className="muted">
        Private studio records. Up to 500 most recent records are shown.
      </p>
    </section>
  );
}
