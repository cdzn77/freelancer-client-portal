"use client";
import { useState } from "react";
import { Panel } from "./ui";
import {
  activeAction,
  advisor,
  changeStage,
  DEFAULT_PROMPTS,
  exactPage,
  summarizeAI,
} from "@/lib/monitor-intelligence";
const num = (n: any) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "Not measured";
const pct = (n: any) =>
  typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "Not measured";
const when = (s: any) =>
  s ? new Date(s).toLocaleString() : "No collection yet";
const kind = (records: any[], name: string) =>
  records.filter((r) => r.kind === name);
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: any;
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
function download(name: string, value: any) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function IntelligenceOverview({
  report,
  records,
  monitor,
  navigate,
}: {
  report: any;
  records: any[];
  monitor: any;
  navigate: (v: string) => void;
}) {
  const settings = kind(records, "settings")[0]?.body || {},
    run = kind(records, "ai_run")[0]?.body,
    crawl = kind(records, "crawl")[0]?.body;
  const actions = kind(records, "suggestion")
    .filter((r) => activeAction(r.body))
    .sort((a, b) =>
      (a.body.priority || "2").localeCompare(b.body.priority || "2"),
    );
  const ideas = advisor(report, monitor?.health, crawl),
    ai = summarizeAI(run, run?.competitors || settings.competitors || []);
  const traffic = monitor?.analytics?.reports?.overview?.rows?.find(
    (r: any) => r.dateRange === "current",
  );
  const event = (name: string, evidence: string) => {
    if (!name) return "Not configured";
    const r = monitor?.analytics?.reports?.events?.rows?.find(
      (r: any) => r.eventName === name,
    );
    return evidence && r ? num(r.eventCount) : "Unverified";
  };
  return (
    <>
      <div className="website-metrics">
        {[
          ["clicks", "Search clicks"],
          ["impressions", "Impressions"],
          ["ctr", "Click-through rate"],
          ["position", "Average position"],
        ].map(([key, label]) => (
          <Metric
            key={key}
            label={label}
            value={
              key === "ctr"
                ? pct(report?.totals?.current?.[key])
                : num(report?.totals?.current?.[key])
            }
            note={`Prior 28 days: ${key === "ctr" ? pct(report?.totals?.previous?.[key]) : num(report?.totals?.previous?.[key])}${key === "position" ? " · Lower is better" : ""}`}
          />
        ))}
      </div>
      <Panel
        title="Today's briefing"
        subtitle={`Saved evidence through ${report?.windows?.current?.endDate || "an unavailable search window"}. No website changes are made automatically.`}
        bodyClassName="search-panel-body"
      >
        <div className="search-briefing">
          <div>
            <h3>What changed</h3>
            <p>
              {report
                ? `${num(report.totals.current.clicks)} search clicks from ${num(report.totals.current.impressions)} impressions. The previous period had ${num(report.totals.previous.clicks)} clicks from ${num(report.totals.previous.impressions)} impressions.`
                : "Connect and refresh Search Console to generate a briefing from measured search activity."}
            </p>
            {report?.totals.current.impressions < 500 && (
              <p>
                Small sample. A few clicks can change the percentages sharply;
                investigate before drawing conclusions.
              </p>
            )}
            <p>
              {actions.length} active saved actions ·{" "}
              {
                kind(records, "change").filter(
                  (r) => changeStage(r.body, report) === "Still measuring",
                ).length
              }{" "}
              changes still measuring.
            </p>
          </div>
          <div>
            <h3>What to review next</h3>
            {[
              ...actions.map((r) => ({
                title: r.title,
                evidence: r.body.evidence,
              })),
              ...ideas,
            ]
              .slice(0, 3)
              .map((r, i) => (
                <div className="search-review-row" key={i}>
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.evidence}</p>
                  </div>
                </div>
              ))}
            {!actions.length && !ideas.length && (
              <p>
                No findings from the available sources. Check collection status
                below.
              </p>
            )}
            <button className="button" onClick={() => navigate("Suggestions")}>
              Review suggestions
            </button>
          </div>
        </div>
      </Panel>
      <Panel
        title="Audience and business outcomes"
        subtitle={`GA4: last ${monitor?.analytics?.days || "unknown"} days, including today. This period differs from finalized Search Console data.`}
        bodyClassName="search-panel-body"
      >
        <div className="website-metrics">
          <Metric
            label="Visits"
            value={num(traffic?.sessions)}
            note="All channels"
          />
          <Metric label="Visitors" value={num(traffic?.activeUsers)} />
          <Metric
            label="Inquiries"
            value={event(settings.inquiry_event, settings.inquiry_evidence)}
            note={settings.inquiry_event || "Choose and test the contact event"}
          />
          <Metric
            label="Consultation bookings"
            value={event(settings.booking_event, settings.booking_evidence)}
            note={settings.booking_event || "Choose and test the booking event"}
          />
        </div>
        <p>
          Event counts are not deduplicated qualified leads. Each outcome needs
          a documented end-to-end test before its count is trusted.
        </p>
        <button className="button small" onClick={() => navigate("Settings")}>
          Configure and verify outcomes
        </button>
      </Panel>
      <div className="website-overview-grid">
        <Panel
          title="AI visibility"
          subtitle="Latest automated sample, separate from manual observations."
          bodyClassName="search-panel-body"
        >
          <div className="website-metrics">
            <Metric label="Brand coverage" value={pct(ai.brandCoverage)} />
            <Metric label="Website coverage" value={pct(ai.domainCoverage)} />
          </div>
          <p>
            {ai.successful} successful answers · {ai.failed} failed or unknown.
          </p>
          <button className="button" onClick={() => navigate("AI visibility")}>
            Inspect answers
          </button>
        </Panel>
        <Panel
          title="Website health"
          subtitle="Coverage and last successful collections, not a blanket health score."
          bodyClassName="search-panel-body"
        >
          <p>
            {monitor?.health?.pages?.length ?? 0} registered pages checked ·{" "}
            {monitor?.health?.findings?.length ?? 0} findings.{" "}
            {monitor?.health?.complete === false
              ? "Latest check incomplete."
              : ""}
          </p>
          <p>
            Sitemap crawl: {crawl?.pages?.length ?? 0} checked,{" "}
            {crawl?.queue?.length ?? 0} remaining.{" "}
            {crawl?.error || (!crawl ? "Not run yet." : "")}
          </p>
          <button className="button" onClick={() => navigate("Operations")}>
            Inspect operations
          </button>
        </Panel>
      </div>
      <Panel title="Collection status" bodyClassName="search-panel-body">
        <div
          className="website-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Report data"
        >
          <table className="website-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Latest observation</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "Search Console",
                  report?.fetched_at,
                  report ? "Saved report" : "Not collected",
                ],
                [
                  "Google Analytics",
                  monitor?.analytics?.fetched_at,
                  monitor?.analytics?.error || "Check reporting period",
                ],
                [
                  "Site checks",
                  monitor?.health?.checked_at,
                  monitor?.health?.complete
                    ? "Complete bounded check"
                    : "Incomplete or unavailable",
                ],
                [
                  "AI answers",
                  run?.completed_at,
                  run?.status || "Awaiting local collector",
                ],
                [
                  "Sitemap crawl",
                  crawl?.updated_at,
                  crawl?.error ||
                    (crawl?.complete ? "Cycle complete" : "Not complete"),
                ],
              ].map(([name, time, state]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{when(time)}</td>
                  <td>
                    {state}
                    {time && Date.now() - Date.parse(time) > 86400000
                      ? " · Older than 24 hours"
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Recent changes" bodyClassName="search-panel-body">
        {kind(records, "change")
          .slice(0, 5)
          .map((r) => (
            <div className="search-review-row" key={r.id}>
              <strong>{r.title}</strong>
              <span>{changeStage(r.body, report)}</span>
            </div>
          ))}
        {!kind(records, "change").length && <p>No shipped changes recorded.</p>}
        <button className="button" onClick={() => navigate("Changes")}>
          Review change measurements
        </button>
      </Panel>
    </>
  );
}
export function IntelligenceSettings({
  records,
  save,
  busy,
  monitor,
}: {
  records: any[];
  save: (v: any) => Promise<boolean>;
  busy: boolean;
  monitor: any;
}) {
  const s = kind(records, "settings")[0]?.body || {};
  return (
    <Panel
      title="Collection and outcome settings"
      subtitle="Use the same prompts and competitor set for comparable AI runs. These settings do not enable paid APIs."
      bodyClassName="search-panel-body"
    >
      {s.outcome_test_status && (
        <div className="website-notice">
          <p>
            <strong>Inquiry testing:</strong> {s.outcome_test_status.inquiry}
          </p>
          <p>
            <strong>Consultation bookings:</strong>{" "}
            {s.outcome_test_status.booking}
          </p>
        </div>
      )}
      {s.competitor_research?.length > 0 && (
        <details>
          <summary>
            Why these competitors ({s.competitor_research.length})
          </summary>
          <div
            className="website-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Report data"
          >
            <table className="website-table">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Service overlap</th>
                </tr>
              </thead>
              <tbody>
                {s.competitor_research.map((c: any) => (
                  <tr key={c.name}>
                    <td>
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.name}
                      </a>
                    </td>
                    <td>{c.fit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Selected from their public service descriptions on{" "}
            {s.competitor_research_date}. This is a service-overlap comparison
            set, not evidence of equal pricing or company size. New runs use
            this set; historical runs retain their original comparison lists.
          </p>
        </details>
      )}
      <form
        key={JSON.stringify(s)}
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          void save({
            action: "settings",
            prompts: String(d.prompts)
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
            competitors: String(d.competitors)
              .split("\n")
              .filter((x) => x.trim())
              .map((line) => {
                const [name, ...aliases] = line
                  .split("|")
                  .map((x) => x.trim())
                  .filter(Boolean);
                return { name, aliases };
              }),
            inquiry_event: d.inquiry_event,
            booking_event: d.booking_event,
            inquiry_evidence: d.inquiry_evidence,
            booking_evidence: d.booking_evidence,
          });
        }}
      >
        <label className="search-wide">
          Unbranded buyer prompts, one per line
          <textarea
            name="prompts"
            rows={7}
            defaultValue={(s.prompts || DEFAULT_PROMPTS).join("\n")}
            required
          />
        </label>
        <label className="search-wide">
          Competitors, one per line; optional aliases separated by |
          <textarea
            name="competitors"
            rows={4}
            defaultValue={(s.competitors || [])
              .map((b: any) => [b.name, ...b.aliases].join(" | "))
              .join("\n")}
          />
        </label>
        <label>
          Inquiry event name
          <input name="inquiry_event" defaultValue={s.inquiry_event || ""} />
        </label>
        <label>
          Consultation booking event name
          <input name="booking_event" defaultValue={s.booking_event || ""} />
        </label>
        <label>
          Inquiry test evidence
          <textarea
            name="inquiry_evidence"
            placeholder="Test date, successful form submission and confirmation in GA4."
            defaultValue={s.inquiry_evidence || ""}
          />
        </label>
        <label>
          Booking test evidence
          <textarea
            name="booking_evidence"
            placeholder="Test date, confirmed booking and matching GA4 event."
            defaultValue={s.booking_evidence || ""}
          />
        </label>
        <p className="search-wide muted">
          Observed GA4 events:{" "}
          {(monitor?.analytics?.reports?.events?.rows || [])
            .map((r: any) => r.eventName)
            .join(", ") || "No event report loaded"}
          . Choose exact event names after checking what they measure.
        </p>
        <button className="button primary" disabled={busy}>
          Save collection settings
        </button>
      </form>
    </Panel>
  );
}
export function AIRunPanel({ records }: { records: any[] }) {
  const runs = kind(records, "ai_run"),
    [chosen, setChosen] = useState("");
  const run = runs.find((r) => r.source_id === chosen)?.body || runs[0]?.body;
  const settings = kind(records, "settings")[0]?.body || {};
  const ai = summarizeAI(run, run?.competitors || settings.competitors || []);
  return (
    <Panel
      title="Collected AI visibility"
      subtitle="Grounded CLI observations. These are not consumer-app rankings. Failed answers are excluded from coverage denominators."
      bodyClassName="search-panel-body"
    >
      {!run ? (
        <p>
          No automated run yet. The local collector requires a supported
          signed-in provider and a running Mac.
        </p>
      ) : (
        <>
          <label>
            Saved run
            <select
              value={chosen || runs[0]?.source_id}
              onChange={(e) => setChosen(e.target.value)}
            >
              {runs.map((r) => (
                <option value={r.source_id} key={r.id}>
                  {when(r.body.completed_at)} · {r.body.status}
                </option>
              ))}
            </select>
          </label>
          <div className="website-metrics">
            <Metric
              label="Brand coverage"
              value={pct(ai.brandCoverage)}
              note={`${ai.mentions} of ${ai.successful} successful answers`}
            />
            <Metric
              label="Domain coverage"
              value={pct(ai.domainCoverage)}
              note={`${ai.citations} answers cite this website`}
            />
            <Metric
              label="Share of voice"
              value={pct(ai.share)}
              note="Share of configured brand-answer mentions"
            />
            <Metric
              label="Successful answers"
              value={ai.successful}
              note={`${ai.failed} failed or unknown`}
            />
          </div>
          <p>
            Run method: {run.method}. Prompt set: {run.prompt_set_hash}.
            Comparisons require the same prompt set, method and competitor list.
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
                  <th>Engine</th>
                  <th>Answers</th>
                  <th>Brand coverage</th>
                  <th>Domain coverage</th>
                </tr>
              </thead>
              <tbody>
                {ai.engines.map((e) => (
                  <tr key={e.engine}>
                    <td>{e.engine}</td>
                    <td>{e.answers}</td>
                    <td>{pct(e.mentions / e.answers)}</td>
                    <td>{pct(e.citations / e.answers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="website-overview-grid">
            <div>
              <h3>Brands named</h3>
              {ai.brands.map((b) => (
                <div className="search-review-row" key={b.name}>
                  <span>{b.name}</span>
                  <strong>{b.mentions}</strong>
                </div>
              ))}
            </div>
            <div>
              <h3>Domains cited</h3>
              {ai.domains.map((d) => (
                <div className="search-review-row" key={d.domain}>
                  <span>{d.domain}</span>
                  <strong>{d.answers}</strong>
                </div>
              ))}
            </div>
          </div>
          <button
            className="button"
            onClick={() => download("portal-ai-evidence.json", run)}
          >
            Download run evidence
          </button>
          {(run.answers || []).map((a: any, i: number) => (
            <details key={i}>
              <summary>
                {a.engine}: {a.prompt} · {a.status}
              </summary>
              {a.status === "success" ? (
                <>
                  <p className="search-answer">{a.answer}</p>
                  <ul>
                    {a.citations?.map((u: string) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noreferrer">
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{a.error || "Answer not collected"}</p>
              )}
            </details>
          ))}
        </>
      )}
      <p className="muted">
        ChatGPT, Claude and Kimi collectors use existing local subscriptions
        when authenticated. An unavailable provider is unknown, not zero
        visibility.
      </p>
    </Panel>
  );
}
export function CrawlPanel({
  records,
  save,
  busy,
}: {
  records: any[];
  save: (v: any) => Promise<boolean>;
  busy: boolean;
}) {
  const c = kind(records, "crawl")[0]?.body;
  const lastComplete = kind(records, "crawl_history")[0]?.body;
  const paused =
    c?.paused || /Access restricted|access was restricted/.test(c?.error || "");
  return (
    <Panel
      title="Sitemap crawl and changes"
      subtitle="Checks same-site sitemap pages in small batches, respecting access restrictions. Coverage is shown explicitly."
      bodyClassName="search-panel-body"
      action={
        <button
          className="button"
          disabled={busy}
          onClick={() => save({ action: paused ? "crawl-retest" : "crawl" })}
        >
          {busy
            ? "Collecting…"
            : paused
              ? "Retest access and resume"
              : "Collect next batch"}
        </button>
      }
    >
      <div className="website-metrics">
        <Metric label="Pages checked" value={c?.pages?.length || 0} />
        <Metric label="Remaining" value={c?.queue?.length ?? "Unknown"} />
        <Metric label="Failed or unavailable" value={c?.failed ?? "Unknown"} />
        <Metric
          label="Content changes"
          value={c?.changes?.length ?? "Not compared"}
        />
      </div>
      <p>
        {c?.sitemap_error
          ? `Sitemap issue: ${c.sitemap_error}. Using reachable site links. `
          : ""}
        {c?.error ||
          (c?.complete ? "Cycle complete." : "No completed crawl yet.")}{" "}
        {c?.truncated ? "Coverage was capped; this is not the full site." : ""}{" "}
        {c?.excluded
          ? `${c.excluded} sitemap URLs excluded by robots rules.`
          : ""}{" "}
        Updated {when(c?.updated_at)}.
      </p>
      {lastComplete && (
        <p className="muted">
          Last completed cycle: {lastComplete.pages?.length || 0} pages,{" "}
          {when(lastComplete.completed_at)}. {lastComplete.coverage}. The table
          below shows the latest attempt.
        </p>
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
              <th>Page</th>
              <th>Status</th>
              <th>Title</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {(c?.pages || []).map((p: any) => (
              <tr key={p.url}>
                <td>{p.url}</td>
                <td>{p.status ?? p.error}</td>
                <td>{p.title}</td>
                <td>
                  {p.findings?.map((f: any) => f.title).join("; ") ||
                    "No findings returned"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>
          Title, description, canonical and schema changes (
          {c?.changes?.length || 0})
        </summary>
        {(c?.changes || []).map((d: any, i: number) => (
          <div className="search-card" key={i}>
            <strong>
              {d.url} · {d.field}
            </strong>
            <p>Before: {d.before || "(empty)"}</p>
            <p>After: {d.after || "(empty)"}</p>
          </div>
        ))}
      </details>
    </Panel>
  );
}
export function ChangeMeasurements({
  record,
  report,
  save,
  busy,
}: {
  record: any;
  report: any;
  save: (v: any) => Promise<boolean>;
  busy: boolean;
}) {
  const b = record.body,
    before = b.page_baseline || exactPage(b.baseline, b.page),
    after = exactPage(report, b.page),
    stage = changeStage(b, report);
  return (
    <div className="search-panel-body">
      <strong>{stage}</strong>
      <div
        className="website-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Report data"
      >
        <table className="website-table">
          <thead>
            <tr>
              <th>Page metric</th>
              <th>Saved baseline</th>
              <th>Latest window</th>
            </tr>
          </thead>
          <tbody>
            {(["clicks", "impressions", "ctr", "position"] as const).map(
              (k) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{k === "ctr" ? pct(before?.[k]) : num(before?.[k])}</td>
                  <td>{k === "ctr" ? pct(after?.[k]) : num(after?.[k])}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Exact URL match: {b.page}. Missing page rows are unknown. Comparable
        windows do not prove this change caused the result.
      </p>
      <details>
        <summary>Deployment and verification</summary>
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            void save({ action: "change_status", id: record.id, ...d });
          }}
        >
          <label>
            State
            <select name="status" defaultValue={b.status || "Shipped"}>
              <option>Shipped</option>
              <option
                disabled={
                  !["Comparable window", "Verified"].includes(stage) ||
                  !before ||
                  !after
                }
              >
                Verified
              </option>
              <option>Reverted</option>
            </select>
          </label>
          <label>
            Pull request or deployment reference
            <input name="reference" defaultValue={b.reference || ""} />
          </label>
          <label className="search-wide">
            Verification evidence
            <textarea name="verification" defaultValue={b.verification || ""} />
          </label>
          <button className="button" disabled={busy}>
            Save change status
          </button>
        </form>
      </details>
    </div>
  );
}
