"use client";
import { csvCell } from "@/lib/csv";
import { useEffect, useState } from "react";
import type { StudioContext } from "./studio";
import type { Project } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { localDate } from "@/lib/work-planning";
import { Field, Panel } from "./ui";
type Report = {
  entries: {
    task_id: string;
    task: string;
    date: string;
    minutes: number;
    billable: boolean;
    billing_treatment: string;
  }[];
  retainers: {
    period: string;
    hours: number;
    rollover: number;
    shared_covered_minutes: number;
  }[];
};
export function ClientTimeReport({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const today = localDate();
  const [start, setStart] = useState(today.slice(0, 7) + "-01"),
    [end, setEnd] = useState(today),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setReport(null);
    setError("");
    void supabase
      .rpc("client_time_report", {
        p_project: project.id,
        starts_on: start,
        ends_on: end,
        preview_client: ctx.readOnly ? ctx.userId : null,
      })
      .then(({ data, error }) => {
        if (live) {
          if (error) setError(error.message);
          else setReport(data as Report);
        }
      });
    return () => {
      live = false;
    };
  }, [project.id, start, end, ctx.readOnly, ctx.userId]);
  return (
    <Panel
      title="Shared time report"
      bodyClassName="panel-body"
      subtitle="Approved time on tasks shared with you. Internal work and unapproved entries are excluded."
    >
      <div className="form-grid">
        <Field label="From">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Through">
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && !report && <p role="status">Loading shared time…</p>}
      {report && (
        <>
          <p>
            <strong>
              {(report.entries.reduce((n, e) => n + e.minutes, 0) / 60).toFixed(
                2,
              )}{" "}
              hours
            </strong>{" "}
            approved in this date range.
          </p>
          <button
            className="button"
            onClick={() => {
              const csv = [
                ["Date", "Task", "Minutes", "Billable", "Coverage"],
                ...report.entries.map((e) => [
                  e.date,
                  e.task,
                  e.minutes,
                  e.billable ? "Yes" : "No",
                  e.billing_treatment,
                ]),
              ]
                .map((r) => r.map(csvCell).join(","))
                .join("\r\n");
              const url = URL.createObjectURL(
                new Blob([csv], { type: "text/csv;charset=utf-8" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `shared-time-${start}-${end}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export shared time CSV
          </button>
          {!report.entries.length && (
            <p>No approved shared time in this date range.</p>
          )}
          <div
            className="table-scroll"
            role="region"
            aria-label="Approved shared time"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Task</th>
                  <th>Hours</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.task}</td>
                    <td>{(e.minutes / 60).toFixed(2)}</td>
                    <td>
                      {!e.billable
                        ? "Non-billable"
                        : e.billing_treatment === "covered"
                          ? "Included in existing fees"
                          : e.billing_treatment === "invoice"
                            ? "Separately billable"
                            : "Coverage under review"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!report.retainers.length && (
            <>
              <h3>Retainer periods</h3>
              <p>
                Plan hours and approved shared covered usage for each full
                period. This excludes internal and unapproved work and is not
                the total remaining retainer balance.
              </p>
              {report.retainers.map((r) => (
                <p key={r.period}>
                  {r.period}: {r.hours} plan hours + {r.rollover} rollover hours
                  · {(r.shared_covered_minutes / 60).toFixed(2)} shared covered
                  hours
                </p>
              ))}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
