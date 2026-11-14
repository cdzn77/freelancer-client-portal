"use client";
import { brand } from "../lib/brand";

import { SearchIntelligence } from "./search-intelligence";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { StudioContext } from "./studio";
import { Select } from "./select";
import { Panel, Empty, Field, Modal } from "./ui";
type Data = Record<string, any>;
type Row = {
  id: string;
  kind: string;
  source: string;
  source_id: string;
  body: Data;
  imported_at: string;
};
const pages = [
  ["home", "Homepage"],
  ["info", "Info"],
  ["cases", "Cases"],
  ["beat-saber", "Beat Saber"],
  ["marriott", "Marriott"],
  ["contact", "Contact"],
];
function date(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Not checked yet";
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "—";
}
function age(report: Data | undefined) {
  const at = report?.checked_at || report?.fetched_at;
  return at
    ? Date.now() - Date.parse(at) > 86400000
      ? "Older than 24 hours"
      : "Recent report"
    : "No report yet";
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="website-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function Table({
  rows,
  columns,
  onSelect,
}: {
  rows: Data[];
  columns: [string, string][];
  onSelect?: (row: Data) => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  const count = Math.max(1, Math.ceil(rows.length / 8));
  const current = Math.min(page, count - 1);
  return !rows.length ? (
    <Empty title="No rows in this report" />
  ) : (
    <>
      <div
        className="website-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Report data"
      >
        <table className="website-table">
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
              {onSelect && <th>Details</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 8, current * 8 + 8).map((row, i) => (
              <tr key={i}>
                {columns.map(([key]) => (
                  <td key={key}>
                    {typeof row[key] === "number"
                      ? number(row[key])
                      : String(row[key] ?? "—")}
                  </td>
                ))}
                {onSelect && (
                  <td>
                    <button
                      className="button small"
                      onClick={() => onSelect(row)}
                    >
                      View
                      <span className="sr-only">
                        {" "}
                        {row.title || row.label || row.url}
                      </span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {count > 1 && (
        <div className="website-pagination">
          <button
            className="button small"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <span>
            Page {current + 1} of {count}
          </span>
          <button
            className="button small"
            disabled={current === count - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
function Trend({ rows }: { rows: Data[] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => Number(r.activeUsers) || 0));
  return (
    <div className="website-trend">
      <div className="website-section-heading">
        <h3>Daily visitors</h3>
        <button className="button small" onClick={() => setTable(!table)}>
          {table ? "Show chart" : "Show data"}
        </button>
      </div>
      {table ? (
        <Table
          rows={rows}
          columns={[
            ["date", "Date"],
            ["activeUsers", "Visitors"],
            ["screenPageViews", "Page views"],
          ]}
        />
      ) : rows.length ? (
        <>
          <svg
            viewBox="0 0 800 170"
            role="img"
            aria-label={`Daily active visitors across ${rows.length} days. Use Show data for exact values.`}
          >
            <line x1="20" y1="150" x2="780" y2="150" stroke="#ddd" />
            <polyline
              fill="none"
              stroke="#222"
              strokeWidth="2.5"
              points={rows
                .map(
                  (r, i) =>
                    `${20 + (i * 760) / Math.max(1, rows.length - 1)},${150 - ((Number(r.activeUsers) || 0) / max) * 125}`,
                )
                .join(" ")}
            />
          </svg>
          <div className="website-chart-labels">
            <span>{rows[0]?.date}</span>
            <span>Peak {number(max)} visitors / day</span>
            <span>{rows.at(-1)?.date}</span>
          </div>
        </>
      ) : (
        <p className="muted">No daily traffic data available.</p>
      )}
    </div>
  );
}
export function MonitorView({ ctx }: { ctx: StudioContext }) {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("Overview"),
    [healthView, setHealthView] = useState("Findings"),
    [days, setDays] = useState(7),
    [breakdown, setBreakdown] = useState("pages"),
    [page, setPage] = useState("home"),
    [device, setDevice] = useState("mobile"),
    [selected, setSelected] = useState<Data | null>(null);
  const [configured, setConfigured] = useState(false);
  const request = useRef(0);
  const workspace = ctx.workspace.id;
  const activeWorkspace = useRef(workspace);
  activeWorkspace.current = workspace;
  async function load() {
    if (activeWorkspace.current !== workspace) return;
    const sequence = ++request.current;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("monitor_records")
        .select("id,kind,source,source_id,body,imported_at")
        .eq("workspace_id", workspace)
        .in("kind", ["website_report", "reports", "analytics"])
        .order("imported_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      if (sequence === request.current) {
        setRows(data || []);
        const session = await supabase.auth.getSession();
        const status = await fetch(`/api/monitor?workspace=${workspace}`, {
          headers: {
            Authorization: `Bearer ${session.data.session?.access_token}`,
          },
        });
        if (sequence === request.current)
          setConfigured(status.ok && (await status.json()).configured);
        if (sequence === request.current) setError("");
      }
    } catch {
      if (sequence === request.current)
        setError("Reports could not load. Please try again.");
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setConfigured(false);
    void load();
    return () => {
      request.current++;
    };
  }, [workspace]);
  const find = (id: string): Data | undefined => {
    const live = rows.find(
      (r) => r.source === "pms-monitor" && r.source_id === id,
    );
    const old = rows.find((r) =>
      id.startsWith("analytics-")
        ? r.kind === "analytics" && r.body.days === Number(id.split("-")[1])
        : r.kind === "reports" && r.body.name === id,
    );
    const historic =
      old?.body ||
      (id.startsWith("performance-")
        ? rows
            .find((r) => r.kind === "reports" && r.body.name === "performance")
            ?.body.rows?.find(
              (r: Data) => `performance-${r.page_id}-${r.strategy}` === id,
            )
        : undefined);
    if (live?.body.checked_at || live?.body.fetched_at)
      return { ...live.body, origin: "Online PMS" };
    if (historic)
      return { ...historic, ...live?.body, origin: "Desk snapshot" };
    return live ? { ...live.body, origin: "Online PMS" } : undefined;
  };
  const health = find("health"),
    domains = find("domains"),
    delivery = find("delivery");
  const analytics: Data | undefined =
    find(`analytics-${days}`) ||
    (() => {
      const row = rows.find(
        (r) => r.kind === "analytics" && r.body.days === days,
      );
      return row ? { ...row.body, origin: "Desk snapshot" } : undefined;
    })();
  const audit =
    find(`performance-${page}-${device}`) ||
    find("performance")?.rows?.find(
      (r: Data) => r.page_id === page && r.strategy === device,
    );
  const findings: Data[] = health?.findings || [];
  const current = analytics?.reports?.overview?.rows?.find(
    (r: Data) => r.dateRange === "current",
  );
  const previous = analytics?.reports?.overview?.rows?.find(
    (r: Data) => r.dateRange === "previous",
  );
  const report =
    view === "Analytics"
      ? analytics
      : view === "Operations"
        ? healthView === "Performance"
          ? audit
          : healthView === "Domain & delivery"
            ? domains
            : health
        : health;
  const healthPaused =
    health?.access_paused ||
    health?.pages?.some((p: Data) => [401, 403].includes(p.status));
  async function refresh(kind: string, retestHealth = false) {
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/monitor", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace,
          kind,
          days,
          page,
          device,
          retestHealth,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.error)
        throw Error(result.error || "Refresh failed.");
      if (result.skipped)
        ctx.notify("A refresh ran recently. Try again in two minutes.");
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const delta = (key: string) => {
    if (
      typeof current?.[key] !== "number" ||
      typeof previous?.[key] !== "number"
    )
      return "No comparison available";
    if (previous[key] === 0)
      return current[key] === 0 ? "No change" : "Previous period was zero";
    const pct = ((current[key] - previous[key]) / previous[key]) * 100;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% vs previous period`;
  };
  return (
    <div className="website-monitor">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WEBSITE INTELLIGENCE</div>
          <h1>Website Monitor</h1>
          <p>Website health and audience insights, in one place.</p>
        </div>
        <button className="button" disabled={loading || busy} onClick={load}>
          Reload reports
        </button>
      </div>
      <div className="website-context">
        <div>
          <strong>{brand.domain}</strong>
          <span>Private · Administrators only</span>
        </div>
        <a
          href={brand.websiteUrl}
          target="_blank"
          rel="noreferrer"
          className="button small"
        >
          Visit website <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      <nav className="website-views" aria-label="Monitor views">
        {[
          "Overview",
          "Suggestions",
          "Search",
          "Chronicles",
          "Keywords",
          "AI visibility",
          "Changes",
          "Operations",
          "Analytics",
          "Settings",
        ].map((v) => (
          <button
            key={v}
            className={view === v ? "active" : ""}
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setSelected(null);
            }}
          >
            {v}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="website-notice">
          {error}
        </p>
      )}
      {loading && !rows.length ? (
        <p role="status">Loading website reports…</p>
      ) : (
        <>
          {view !== "Analytics" && (
            <SearchIntelligence
              ctx={ctx}
              view={view}
              onNavigate={setView}
              monitor={{ health, analytics }}
            />
          )}
          {view === "Operations" && (
            <>
              <div className="website-toolbar">
                <div className="website-segments" aria-label="Health report">
                  {[
                    "Findings",
                    "Pages",
                    "Performance",
                    "Domain & delivery",
                  ].map((v) => (
                    <button
                      key={v}
                      aria-pressed={healthView === v}
                      onClick={() => setHealthView(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  className="button"
                  disabled={busy || !configured}
                  onClick={() =>
                    refresh(
                      healthView === "Performance"
                        ? "performance"
                        : healthView === "Domain & delivery"
                          ? "domains"
                          : "health",
                      Boolean(healthPaused) &&
                        ["Findings", "Pages"].includes(healthView),
                    )
                  }
                >
                  {busy
                    ? "Checking…"
                    : healthView === "Performance"
                      ? "Run page audit"
                      : healthView === "Domain & delivery"
                        ? "Check DNS"
                        : healthPaused
                          ? "Retest website health"
                          : "Run website check"}
                </button>
              </div>
              {healthView === "Performance" ? (
                <Panel
                  title="Page performance"
                  subtitle="Choose one page and device. Lab scores remain separate from audience analytics."
                >
                  <div className="website-panel-body">
                    <div className="website-form-row">
                      <Field label="Page">
                        <Select
                          value={page}
                          onChange={(e) => setPage(e.target.value)}
                        >
                          {pages.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Device">
                        <Select
                          value={device}
                          onChange={(e) => setDevice(e.target.value)}
                        >
                          <option value="mobile">Mobile</option>
                          <option value="desktop">Desktop</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="website-metrics">
                      {[
                        "performance",
                        "accessibility",
                        "best-practices",
                        "seo",
                      ].map((k) => (
                        <Metric
                          key={k}
                          label={k.replace("-", " ")}
                          value={number(audit?.scores?.[k])}
                          note="Lab score / 100"
                        />
                      ))}
                    </div>
                    {audit?.metrics && (
                      <Table
                        rows={Object.entries(audit.metrics).map(
                          ([label, value]) => ({ label, value }),
                        )}
                        columns={[
                          ["label", "Measurement"],
                          ["value", "Result"],
                        ]}
                      />
                    )}
                    <p className="muted">
                      No score means unavailable, not zero. Checks can take up
                      to 25 seconds; retry later if the provider is slow.
                    </p>
                  </div>
                </Panel>
              ) : healthView === "Domain & delivery" ? (
                <div className="website-overview-grid">
                  <Panel
                    title="Domain & email DNS"
                    subtitle="Read-only public records; no DNS settings are changed."
                  >
                    <div className="website-panel-body">
                      <Table
                        rows={domains?.rows || []}
                        columns={[
                          ["label", "Record"],
                          ["observed", "Observed value"],
                        ]}
                      />
                    </div>
                  </Panel>
                  <Panel
                    title="Published website"
                    subtitle="A failed build does not necessarily mean the website is offline."
                  >
                    <div className="website-panel-body">
                      <p>
                        Published release:{" "}
                        <strong>
                          {delivery?.published?.state || "Not checked"}
                        </strong>
                      </p>
                      <p>
                        Revision:{" "}
                        {delivery?.published?.commit?.slice(0, 7) || "—"}
                      </p>
                      <p className="muted">{date(delivery?.checked_at)}</p>
                      {delivery?.error && <p role="status">{delivery.error}</p>}
                      <button
                        className="button"
                        disabled={busy || !configured}
                        onClick={() => refresh("delivery")}
                      >
                        Refresh deployment
                      </button>
                    </div>
                  </Panel>
                </div>
              ) : (
                <Panel
                  title={
                    healthView === "Findings"
                      ? "Findings to review"
                      : "Checked pages"
                  }
                  subtitle={
                    health?.note ||
                    "Six registered pages. Failed connections are unavailable, not a passing result."
                  }
                >
                  <div className="website-panel-body">
                    {health?.complete === false && (
                      <p className="website-notice">
                        Some pages could not be checked. Findings are
                        incomplete.
                      </p>
                    )}
                    {healthView === "Findings" ? (
                      health?.checked_at && !findings.length ? (
                        <Empty
                          title={
                            health.complete
                              ? "No findings in the latest check"
                              : "No findings returned; check incomplete"
                          }
                        />
                      ) : (
                        <Table
                          rows={findings}
                          columns={[
                            ["title", "Finding"],
                            ["severity", "Priority"],
                            ["url", "Page"],
                          ]}
                          onSelect={setSelected}
                        />
                      )
                    ) : (
                      <Table
                        rows={health?.pages || []}
                        columns={[
                          ["label", "Page"],
                          ["status", "HTTP status"],
                          ["response_ms", "Response (ms)"],
                          ["error", "Check error"],
                        ]}
                      />
                    )}
                  </div>
                </Panel>
              )}
            </>
          )}
          {view === "Analytics" && (
            <>
              <div className="website-toolbar">
                <Field label="Date range">
                  <Select
                    value={String(days)}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[7, 14, 28, 90].map((d) => (
                      <option value={d} key={d}>
                        Last {d} days
                      </option>
                    ))}
                  </Select>
                </Field>
                <button
                  className="button"
                  disabled={busy || !configured}
                  onClick={() => refresh("analytics")}
                >
                  {busy ? "Refreshing…" : "Refresh analytics"}
                </button>
              </div>
              <div className="website-metrics">
                <Metric
                  label="Visitors"
                  value={number(current?.activeUsers)}
                  note={delta("activeUsers")}
                />
                <Metric
                  label="Visits"
                  value={number(current?.sessions)}
                  note={delta("sessions")}
                />
                <Metric
                  label="Page views"
                  value={number(current?.screenPageViews)}
                  note={delta("screenPageViews")}
                />
                <Metric
                  label="Engagement rate"
                  value={
                    typeof current?.engagementRate === "number"
                      ? `${(current.engagementRate * 100).toFixed(1)}%`
                      : "—"
                  }
                  note={analytics?.timezone || "Google Analytics"}
                />
              </div>
              {analytics?.reports ? (
                <Panel
                  title="Traffic & discovery"
                  subtitle={`Last ${days} days including today (incomplete). Compared with the preceding ${days} days.`}
                >
                  <div className="website-panel-body">
                    <Trend rows={analytics.reports.trend?.rows || []} />
                    <div className="website-toolbar">
                      <h3>Explore your traffic</h3>
                      <Field label="Breakdown">
                        <Select
                          value={breakdown}
                          onChange={(e) => setBreakdown(e.target.value)}
                        >
                          {[
                            ["pages", "Top pages"],
                            ["sources", "Traffic sources"],
                            ["countries", "Countries"],
                            ["devices", "Devices"],
                            ["events", "Events"],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Table
                      key={breakdown + days}
                      rows={analytics.reports[breakdown]?.rows || []}
                      columns={
                        breakdown === "pages"
                          ? [
                              ["pagePath", "Page"],
                              ["screenPageViews", "Views"],
                              ["activeUsers", "Visitors"],
                            ]
                          : breakdown === "sources"
                            ? [
                                ["sessionSourceMedium", "Source / medium"],
                                ["sessions", "Visits"],
                              ]
                            : breakdown === "events"
                              ? [
                                  ["eventName", "Event"],
                                  ["eventCount", "Count"],
                                ]
                              : [
                                  [
                                    breakdown === "countries"
                                      ? "country"
                                      : "deviceCategory",
                                    breakdown === "countries"
                                      ? "Country"
                                      : "Device",
                                  ],
                                  ["activeUsers", "Visitors"],
                                ]
                      }
                    />
                    {analytics.notices?.map((n: string) => (
                      <p key={n} className="muted">
                        {n}
                      </p>
                    ))}
                  </div>
                </Panel>
              ) : (
                <Empty title="No analytics report for this range" />
              )}
            </>
          )}
          {(view === "Operations" || view === "Analytics") && (
            <div className="website-report-footer">
              <span>
                {report?.origin || "Online PMS"} · {age(report)} ·{" "}
                {date(report?.checked_at || report?.fetched_at)}
              </span>
              {report?.error && (
                <p role="status">
                  {report.error} Last attempt: {date(report.last_attempt_at)}
                </p>
              )}
            </div>
          )}
        </>
      )}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title || "Finding details"}
        description="Review the observation before deciding on a repair."
      >
        <div className="website-panel-body">
          <p>{selected?.url}</p>
          <p>
            {selected?.evidence ||
              "Observed in the served HTML during the latest page check."}
          </p>
          <p className="muted">Priority: {selected?.severity || "normal"}</p>
        </div>
      </Modal>
    </div>
  );
}
