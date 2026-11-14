import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  dailyAvailability,
  dateRange,
  periodStart,
  periodEnd,
  shiftPeriod,
  scheduleState,
} from "../lib/team-schedule";
import { localDate, addDays } from "../lib/work-planning";
async function main() {
  const c = { user_id: "a", daily_minutes: 480, weekdays: [1, 2, 3, 4, 5] };
  assert.equal(periodStart("2026-10-04", "week"), "2026-09-28");
  assert.equal(periodEnd("2028-02-01", "month"), "2028-02-29");
  assert.equal(shiftPeriod("2026-12-01", "month", 1), "2027-01-01");
  assert.equal(dateRange("2026-10-01", "2026-10-31").length, 31);
  assert.throws(() => dateRange("2026-10-02", "2026-10-01"));
  assert.throws(() => dateRange("2026-01-01", "2028-01-01"));
  const states = [
    {
      id: "p",
      user_id: "a",
      status: "paused" as const,
      starts_on: "2026-10-05",
      ends_on: "2026-10-06",
    },
    {
      id: "z",
      user_id: "a",
      status: "archived" as const,
      starts_on: "2026-10-12",
      ends_on: null,
    },
  ];
  assert.equal(scheduleState("a", "2026-10-04", states), "active");
  assert.equal(scheduleState("a", "2026-10-05", states), "paused");
  assert.equal(scheduleState("a", "2026-10-07", states), "active");
  assert.equal(scheduleState("a", "2027-01-01", states), "archived");
  assert.equal(scheduleState("b", "2027-01-01", states), "active");
  const overrides = [{ user_id: "a", work_date: "2026-10-01", minutes: 120 }];
  assert.equal(
    dailyAvailability("a", "2026-10-01", c, overrides, [], states).minutes,
    120,
  );
  assert.equal(
    dailyAvailability("a", "2026-10-03", c, [], [], states).minutes,
    0,
  );
  assert.equal(
    dailyAvailability("a", "2026-10-05", c, [], [], states).minutes,
    0,
  );
  assert.equal(
    dailyAvailability("a", "2026-10-12", c, [], [], states).minutes,
    0,
  );
  const leave = [
    { id: "x", user_id: "a", starts_on: "2026-10-01", ends_on: "2026-10-02" },
  ];
  assert.equal(
    dailyAvailability("a", "2026-10-01", c, overrides, [...leave, ...leave], [])
      .minutes,
    0,
  );
  assert.equal(
    dailyAvailability("a", "2026-10-01", undefined, [], [], []).minutes,
    null,
  );
  assert.equal(
    dailyAvailability("a", "2026-10-01", undefined, overrides, [], []).minutes,
    120,
  );
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "getComputedStyle",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: (dom.window as any)[key],
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const React = await import("react");
  const { render, fireEvent, cleanup } = await import("@testing-library/react");
  const { TeamCapacityView } = await import("../components/team-capacity");
  const { emptyData } = await import("../lib/types");
  const start = periodStart(localDate(), "week");
  const ctx: any = {
    userId: "a",
    workspace: { id: "w", role: "owner" },
    refresh: async () => {},
    data: {
      ...emptyData,
      members: [
        { user_id: "a", display_name: "Alex Freelancer", role: "owner" },
        { user_id: "b", display_name: "Archived Worker", role: "member" },
      ],
      team_capacity: [c],
      team_schedule_days: [
        { user_id: "a", work_date: addDays(start, 7), minutes: 60 },
      ],
      team_schedule_status: [
        {
          id: "b",
          user_id: "b",
          status: "archived",
          starts_on: start,
          ends_on: null,
        },
      ],
    },
  };
  const v = render(<TeamCapacityView ctx={ctx} />);
  assert.equal(v.container.querySelectorAll(".schedule-person").length, 1);
  const first = v.container.querySelector(".schedule-metrics")!.textContent;
  fireEvent.click(v.getByRole("button", { name: "Next week" }));
  const next = v.container.querySelector(".schedule-metrics")!.textContent;
  assert.notEqual(first, next);
  assert.equal(v.container.querySelectorAll(".schedule-day").length, 7);
  fireEvent.click(v.getByRole("button", { name: "Today" }));
  assert.equal(
    v.container.querySelector(".schedule-metrics")!.textContent,
    first,
  );
  assert.equal(
    v.container.querySelectorAll(
      ".schedule-daily-details[open], .schedule-secondary[open]",
    ).length,
    0,
  );
  fireEvent.click(v.getByRole("button", { name: "Month" }));
  assert.equal(
    v.container.querySelectorAll(".schedule-day").length,
    dateRange(
      periodStart(localDate(), "month"),
      periodEnd(periodStart(localDate(), "month"), "month"),
    ).length,
  );
  fireEvent.click(v.getByRole("button", { name: "Week" }));
  // Static local fixture uses the real component markup and production CSS.
  mkdirSync("/tmp/pms-spacing-qa", { recursive: true });
  const css = ["globals", "brand", "obrack"]
    .map((n) => readFileSync(`app/${n}.css`, "utf8"))
    .join("\n");
  writeFileSync(
    "/tmp/pms-spacing-qa/schedule.html",
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="padding:24px;max-width:1400px;margin:auto">${v.container.innerHTML}</main></body></html>`,
  );
  cleanup();
  const member = render(
    <TeamCapacityView
      ctx={{ ...ctx, workspace: { ...ctx.workspace, role: "member" } }}
    />,
  );
  assert.equal(
    member.queryByRole("button", { name: "Manage availability" }),
    null,
  );
  assert.equal(member.queryByRole("button", { name: "Book work" }), null);
  assert.equal(member.container.querySelectorAll(".schedule-person").length, 1);
  cleanup();
  const { bookingInsight } = await import("../lib/schedule-insights");
  const members = Array.from({ length: 6 }, (_, i) => ({
    user_id: `person-${i}`,
    display_name: `Sample Person ${i + 1}`,
    role: i === 0 ? "owner" : "member",
  }));
  const sixData: any = {
    ...emptyData,
    members,
    projects: [{ id: "p", name: "Sample brand project" }],
    team_capacity: members.map((m) => ({ ...c, user_id: m.user_id })),
    resource_bookings: members.map((m, i) => ({
      id: `booking-${i}`,
      user_id: m.user_id,
      project_id: "p",
      starts_on: start,
      ends_on: addDays(start, 6),
      daily_minutes: i === 0 ? 600 : 120,
      tentative: false,
      note: "Sample allocation",
    })),
    team_time_off: [
      { id: "away", user_id: "person-1", starts_on: start, ends_on: start },
    ],
  };
  assert.equal(
    bookingInsight("person-0", start, addDays(start, 6), sixData).confirmed,
    3000,
  );
  assert.equal(
    bookingInsight("person-0", start, addDays(start, 6), sixData).conflicts
      .length,
    5,
  );
  assert.equal(
    bookingInsight("person-1", start, addDays(start, 6), sixData).conflicts
      .length,
    1,
  );
  assert.equal(
    bookingInsight("person-2", start, addDays(start, 6), sixData).conflicts
      .length,
    0,
  );
  assert.equal(
    bookingInsight("person-2", start, addDays(start, 6), sixData).available,
    2400,
  );
  const six = render(
    <TeamCapacityView ctx={{ ...ctx, userId: "person-0", data: sixData }} />,
  );
  assert.equal(six.container.querySelectorAll(".schedule-person").length, 6);
  assert.equal(six.container.querySelectorAll(".schedule-insight").length, 7);
  assert.ok(six.container.textContent?.includes("6 people booked"));
  assert.ok(six.container.textContent?.includes("100.0h confirmed"));
  assert.ok(six.container.textContent?.includes("8.0h unavailable"));
  const sixHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="padding:16px;max-width:1400px;margin:auto"><p>Sample data: six people. No live records.</p>${six.container.innerHTML}</main></body></html>`;
  writeFileSync("/tmp/pms-spacing-qa/schedule-six.html", sixHtml);
  writeFileSync(
    "/tmp/pms-spacing-qa/schedule-six-details.html",
    sixHtml
      .replace(/<section class="panel capacity-panel">[\s\S]*?<\/section>/, "")
      .replaceAll(
        'class="schedule-secondary"',
        'class="schedule-secondary" open',
      ),
  );
  cleanup();
  dom.window.close();
  console.log(
    "PASS: period boundaries, leap year, overrides, time off, dated pauses, archives, identity isolation, changing weekly totals, member-only controls, six-person totals, daily conflicts, and individual leave isolation.",
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
