
import { brand } from "./brand";
import { indexLabel } from "./chronicles-monitor";
/** Escaped, self-contained printable report. No remote resources or executable source content. */
const escape = (v: unknown) =>
  String(v ?? "Not measured").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const table = (headers: string[], rows: unknown[][]) =>
  `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export function fullMonitorReport(records: any[], monitor: any) {
  const by = (kind: string) => records.filter((r) => r.kind === kind),
    report = by("search_report")[0]?.body;
  const metrics = report
    ? table(
        ["Metric", "Current", "Previous", "364 days earlier"],
        ["clicks", "impressions", "ctr", "position"].map((k) => [
          k,
          ...["current", "previous", "year"].map(
            (w) => report.totals?.[w]?.[k],
          ),
        ]),
      )
    : "<p>No Search Console report.</p>";
  const search = (rows: any[]) =>
    table(
      ["Query or page", "Clicks", "Impressions", "CTR (fraction)", "Position"],
      (rows || []).map((r) => [
        r.keys?.[0],
        r.clicks,
        r.impressions,
        r.ctr,
        r.position,
      ]),
    );
  const section = (title: string, body: string) =>
    `<section><h2>${title}</h2>${body}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${brand.name} Monitor report</title><style>body{font:14px/1.55 system-ui;color:#222;max-width:1100px;margin:40px auto;padding:24px}h1{font-size:28px}h2{margin-top:36px}table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}th,td{padding:8px;border:1px solid #ddd;text-align:left;overflow-wrap:anywhere;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 system-ui}tr{break-inside:avoid}thead{display:table-header-group}@media print{body{margin:0;padding:0}h2{break-after:avoid}}</style></head><body><h1>${brand.name} Monitor</h1><p>Generated ${escape(new Date().toLocaleString())}. Search period: ${escape(report?.windows?.current?.startDate)} to ${escape(report?.windows?.current?.endDate)}. Other sources retain their own dates and periods. Missing data is unknown. Includes the records currently loaded, up to 500.</p>${section("Search performance", metrics + `<p>${escape(report?.note)}</p>` + search(report?.queries) + search(report?.pages))}${section(
    "Chronicles visibility",
    table(
      ["Article", "URL", "Published", "Google status", "Inspected"],
      (by("chronicles")[0]?.body?.articles || []).map((a: any) => [
        a.title,
        a.url,
        a.publishedAt,
        indexLabel(a),
        a.inspectedAt,
      ]),
    ),
  )}${section(
    "Keyword targets",
    table(
      ["Phrase", "Page", "Intent", "Priority", "Approval", "Rationale"],
      by("keyword").map((r) => [
        r.title,
        r.body.page,
        r.body.intent,
        r.body.priority,
        r.body.approval || "Draft",
        r.body.rationale,
      ]),
    ),
  )}${section(
    "Suggestions and decisions",
    by("suggestion")
      .map(
        (r) =>
          `<h3>${escape(r.title)}</h3><p>${escape(r.body.state)} · Priority ${escape(r.body.priority || "2")}</p><p>${escape(r.body.evidence)}</p><p>${escape(r.body.next)}</p>`,
      )
      .join(""),
  )}${section(
    "AI visibility evidence",
    by("ai_run")
      .slice(0, 1)
      .map(
        (r) =>
          `<p>${escape(r.body.method)} · ${escape(r.body.completed_at)} · ${escape(r.body.status)}</p>` +
          (r.body.answers || [])
            .map(
              (a: any) =>
                `<h3>${escape(a.engine)}: ${escape(a.prompt)}</h3><p>${escape(a.status)}</p><pre>${escape(a.answer || a.error)}</pre><p>${escape((a.citations || []).join("\n"))}</p>`,
            )
            .join(""),
      )
      .join(""),
  )}${section(
    "Changes and frozen baselines",
    by("change")
      .map(
        (r) =>
          `<h3>${escape(r.title)}</h3><p>${escape(r.body.page)} · ${escape(r.body.shipped_at)} · ${escape(r.body.status || "Shipped")}</p><pre>${escape(JSON.stringify({ notes: r.body.notes, page_baseline: r.body.page_baseline, baseline_window: r.body.baseline?.windows?.current, verification: r.body.verification }, null, 2))}</pre>`,
      )
      .join(""),
  )}${section("Traffic and outcomes", `<pre>${escape(JSON.stringify(monitor?.analytics || { status: "Unavailable" }, null, 2))}</pre>`)}${section("Operations", `<pre>${escape(JSON.stringify({ health: monitor?.health, crawl: by("crawl")[0]?.body }, null, 2))}</pre>`)}<p>Saved evidence supports investigation; it does not establish causation. AI observations are CLI samples, not consumer rankings. Use your browser Print command to save this complete report as PDF.</p></body></html>`;
}
