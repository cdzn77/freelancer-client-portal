import assert from "node:assert/strict";
import {
  searchWindows,
  totals,
  changePercent,
  opportunities,
  measurementState,
  brandEvidence,
} from "../lib/search-intelligence";
const windows = searchWindows(new Date("2026-10-04T23:00:00Z"));
assert.deepEqual(windows.current, {
  startDate: "2026-09-04",
  endDate: "2026-10-01",
});
assert.deepEqual(windows.previous, {
  startDate: "2026-08-07",
  endDate: "2026-09-03",
});
assert.equal(
  (Date.parse(windows.current.startDate) - Date.parse(windows.year.startDate)) /
    86400000,
  364,
);
assert.equal(
  searchWindows(new Date("2026-10-04T01:00:00Z")).current.endDate,
  "2026-09-30",
  "Search Console uses Pacific date, not UTC",
);
const result = totals([
  { clicks: 1, impressions: 10, ctr: 0.1, position: 2 },
  { clicks: 9, impressions: 90, ctr: 0.1, position: 10 },
]);
assert.equal(result.position, 9.2, "Position is weighted by impressions");
assert.equal(result.ctr, 0.1);
assert.equal(totals([]).position, null);
assert.equal(
  changePercent(10, 0),
  null,
  "Zero baseline is not an infinite improvement",
);
assert.equal(changePercent(0, 10), -100);
assert.equal(
  measurementState("2026-10-04", windows.current, windows.current),
  "Still measuring",
);
assert.equal(
  measurementState(
    "2026-10-04",
    { startDate: "2026-10-05", endDate: "2026-11-01" },
    windows.current,
  ),
  "Comparable window",
);
assert.equal(
  measurementState("2026-09-15", windows.current, windows.current),
  "Baseline overlaps change",
);
assert.equal(
  measurementState("2026-10-04", windows.current, undefined),
  "No baseline",
);
assert.deepEqual(
  brandEvidence("Try Example Studio", ["https://example.com.evil.test/"]),
  { mentioned: true, cited: false },
);
assert.equal(
  brandEvidence("Try this studio", ["https://www.example.com/info/"])
    .cited,
  true,
);
assert.equal(
  opportunities(
    [
      {
        keys: ["design studio"],
        clicks: 2,
        impressions: 101,
        ctr: 0.02,
        position: 7,
      },
    ],
    [],
  ).length,
  1,
);
assert.equal(
  opportunities(
    [
      {
        keys: ["design studio"],
        clicks: 2,
        impressions: 99,
        ctr: 0.02,
        position: 7,
      },
    ],
    [],
  ).length,
  0,
);
console.log(
  "Search date windows, weighted metrics, missing data, evidence rules and change baselines passed.",
);
