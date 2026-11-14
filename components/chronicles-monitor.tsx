"use client";
import { useState } from "react";
import { Panel } from "./ui";
import { indexLabel, articleAdvice } from "@/lib/chronicles-monitor";
import { exactPage } from "@/lib/monitor-intelligence";
const value = (n: any) =>
  typeof n === "number"
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "Not reported";
export function ChroniclesMonitor({
  report,
  records,
  busy,
  save,
}: {
  report: any;
  records: any[];
  busy: boolean;
  save: (v: any) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState("");
  const collection = records.find((x) => x.kind === "chronicles")?.body;
  const articles = collection?.articles || [];
  const rows = articles.filter((x: any) =>
    x.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <Panel
      title="Chronicles visibility"
      subtitle="Follow each article from publication to Google discovery. Index inspection is separate from live availability."
      bodyClassName="search-panel-body"
      action={
        <button
          className="button"
          disabled={busy}
          onClick={() => save({ action: "chronicles" })}
        >
          {busy ? "Collecting…" : "Refresh article indexing"}
        </button>
      }
    >
      <div className="website-metrics">
        <div className="website-metric">
          <span>Published articles</span>
          <strong>{articles.length || "Not collected"}</strong>
        </div>
        <div className="website-metric">
          <span>Confirmed indexed</span>
          <strong>
            {
              articles.filter(
                (x: any) => x.index?.verdict === "PASS" && !x.inspectionError,
              ).length
            }
          </strong>
        </div>
        <div className="website-metric">
          <span>Inspection unavailable</span>
          <strong>
            {articles.filter((x: any) => x.inspectionError).length}
          </strong>
        </div>
      </div>
      {collection?.collectionError && (
        <p role="alert">
          {collection.collectionError} Previous inspection timestamps remain
          visible.
        </p>
      )}
      {collection?.discoveryPaused && (
        <div role="status">
          <p>
            {collection.discoveryError} Google inspections can still refresh for
            the saved articles. New articles cannot be discovered until feed
            access is restored.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() => save({ action: "chronicles-discovery" })}
          >
            Retest feed access
          </button>
        </div>
      )}
      <p>
        Inventory collected{" "}
        {collection?.inventory_at || collection?.fetched_at
          ? new Date(
              collection.inventory_at || collection.fetched_at,
            ).toLocaleString()
          : "not yet"}
        . Google inspections refresh every six hours, up to 20 articles per run.
      </p>
      <p>
        Search window: {report?.windows?.current?.startDate || "unavailable"} to{" "}
        {report?.windows?.current?.endDate || "unavailable"}. Articles published
        after this window have no post-publication performance yet. Missing rows
        mean no data reported, not proven zero activity.
      </p>
      <button
        className="button"
        disabled={busy}
        onClick={() => save({ action: "refresh" })}
      >
        Refresh search metrics
      </button>
      <label>
        Find an article{" "}
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
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
              <th>Article / published</th>
              <th>Google indexing / checked</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>CTR</th>
              <th>Average position</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item: any) => {
              const row = exactPage(report, item.url);
              return (
                <tr key={item.url}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                    <br />
                    <small>
                      {new Date(item.publishedAt).toLocaleDateString()}
                    </small>
                  </td>
                  <td>
                    {indexLabel(item)}
                    <br />
                    <small>
                      {item.inspectedAt
                        ? new Date(item.inspectedAt).toLocaleString()
                        : "Not inspected"}
                    </small>
                    {item.index?.googleCanonical &&
                      item.index.googleCanonical !== item.url && (
                        <p>Google canonical: {item.index.googleCanonical}</p>
                      )}
                  </td>
                  <td>{value(row?.clicks)}</td>
                  <td>{value(row?.impressions)}</td>
                  <td>
                    {typeof row?.ctr === "number"
                      ? `${(row.ctr * 100).toFixed(1)}%`
                      : "Not reported"}
                  </td>
                  <td>{value(row?.position)}</td>
                  <td>
                    {articleAdvice(
                      item,
                      row,
                      report?.windows?.current?.endDate,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!articles.length && (
        <p>
          Refresh article indexing to discover the current published RSS
          inventory.
        </p>
      )}
      <h3>Searches reaching Chronicles</h3>
      <p>
        Reported page/query pairs, up to 1,000 rows. Google omits anonymized
        queries.
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
              <th>Article</th>
              <th>Query</th>
              <th>Clicks</th>
              <th>Impressions</th>
            </tr>
          </thead>
          <tbody>
            {(report?.chroniclesQueries || []).map((r: any, i: number) => (
              <tr key={i}>
                <td>{r.keys?.[0]}</td>
                <td>{r.keys?.[1]}</td>
                <td>{value(r.clicks)}</td>
                <td>{value(r.impressions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!report?.chroniclesQueries?.length && (
        <p>No Chronicles queries reported for this window.</p>
      )}
      <p>
        Article-to-service clicks and article-assisted inquiries are not
        measured here yet. The existing inquiry event still requires live
        delivery verification. A page view is not counted as a lead.
      </p>
    </Panel>
  );
}
