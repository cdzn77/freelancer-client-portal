
import { brand } from "./brand";
export type SearchRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
export type Window = { startDate: string; endDate: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export function searchWindows(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const endDate = shift(today, -3);
  const current = { startDate: shift(endDate, -27), endDate };
  return {
    current,
    previous: {
      startDate: shift(current.startDate, -28),
      endDate: shift(current.startDate, -1),
    },
    year: {
      startDate: shift(current.startDate, -364),
      endDate: shift(endDate, -364),
    },
  };
}
export function totals(rows: SearchRow[]) {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0),
    impressions = rows.reduce((n, r) => n + r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions
      ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions
      : null,
  };
}
export function changePercent(
  current: number | null | undefined,
  previous: number | null | undefined,
) {
  return current == null || previous == null || previous === 0
    ? null
    : ((current - previous) / previous) * 100;
}
export function opportunities(queries: SearchRow[], pages: SearchRow[]) {
  return [
    ...queries
      .filter(
        (r) => r.impressions >= 100 && r.position >= 5 && r.position <= 20,
      )
      .map((r) => ({
        key: "query:" + r.keys?.[0],
        title: `Improve the page answering “${r.keys?.[0]}”`,
        evidence: `${r.impressions} impressions, average position ${r.position.toFixed(1)}.`,
        next: "Match the page heading and opening answer to this search. Check the result again after a full comparison window.",
      })),
    ...pages
      .filter((r) => r.impressions >= 100 && r.ctr < 0.01)
      .map((r) => ({
        key: "page:" + r.keys?.[0],
        title: `Review the search snippet for ${r.keys?.[0]}`,
        evidence: `${r.impressions} impressions with ${(r.ctr * 100).toFixed(2)}% click-through rate.`,
        next: "Review the title and description against the searches bringing this page impressions.",
      })),
  ].slice(0, 30);
}
export function measurementState(
  shipped: string,
  current?: Window,
  baseline?: Window,
) {
  if (!current || !baseline) return "No baseline";
  if (baseline.endDate >= shipped.slice(0, 10))
    return "Baseline overlaps change";
  return current.startDate > shipped.slice(0, 10)
    ? "Comparable window"
    : "Still measuring";
}
export function brandEvidence(answer: string, citations: string[]) {
  return {
    mentioned: new RegExp(`(^|[^a-z0-9])${brand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(answer),
    cited: citations.some((link) => {
      try {
        return [(brand.domain), (brand.wwwDomain)].includes(
          new URL(link).hostname,
        );
      } catch {
        return false;
      }
    }),
  };
}
