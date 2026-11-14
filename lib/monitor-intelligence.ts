
import { brand } from "./brand";
import {
  opportunities,
  measurementState,
  type SearchRow,
} from "./search-intelligence";
export const DEFAULT_PROMPTS = [
  "Which independent design studios in the United States help agencies with UX strategy and product design?",
  "Who can help a US business redesign its website with both brand strategy and UX design?",
  "Which freelance UX designers in the United States have experience with entertainment or hospitality brands?",
  "Where can a US marketing team find a design partner for a campaign website and brand experience?",
  "Which independent US studios offer website design and development for growing businesses?",
];
export type Advice = {
  key: string;
  title: string;
  evidence: string;
  next: string;
  priority: "1" | "2" | "3";
  effort: "Low" | "Medium" | "High";
  category: string;
  page: string;
  confidence: string;
};
export function activeAction(body: any, now = Date.now()) {
  return (
    body.state !== "Resolved" &&
    body.state !== "Dismissed" &&
    !(body.state === "Snoozed" && Date.parse(body.snoozed_until || "") > now)
  );
}
export function advisor(report: any, health: any, crawl: any): Advice[] {
  const result: Advice[] = opportunities(
    report?.queries || [],
    report?.pages || [],
  ).map((x) => ({
    ...x,
    priority: "2",
    effort: "Medium",
    category: "Search",
    page: x.key.startsWith("page:") ? x.key.slice(5) : "",
    confidence: "Measured opportunity",
  }));
  for (const f of (health?.findings || []).slice(0, 15))
    result.push({
      key: `health:${f.code}:${f.url}`,
      title: f.title,
      evidence: `Latest bounded site check: ${f.url}. Collected ${health.checked_at || "at an unknown time"}.`,
      next: "Inspect the affected URL and confirm the finding before editing. Record the fix and its verification evidence.",
      priority: f.severity === "high" ? "1" : "2",
      effort: "Medium",
      category: "Site health",
      page: f.url,
      confidence:
        health.complete === false ? "Incomplete check" : "Observed finding",
    });
  for (const f of (crawl?.changes || []).slice(0, 10))
    result.push({
      key: `drift:${f.url}:${f.field}:${f.after}`,
      title: `Review changed ${f.field}`,
      evidence: `${f.url}: ${String(f.before || "(empty)").slice(0, 500)} → ${String(f.after || "(empty)").slice(0, 500)}.`,
      next: "Confirm whether this was an intended website change. Check the page and record the deployment or restore the intended content.",
      priority: "2",
      effort: "Low",
      category: "Content change",
      page: f.url,
      confidence: "Saved crawl comparison",
    });
  if (
    report &&
    !(report.queries || []).some((r: SearchRow) => r.impressions >= 100)
  )
    for (const r of [...(report.pages || [])]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 3))
      result.push({
        key: `review:page:${r.keys[0]}`,
        title: `Investigate ${r.keys[0]}`,
        evidence: `${r.impressions} impressions, ${r.clicks} clicks, ${(r.ctr * 100).toFixed(2)}% CTR and position ${r.position.toFixed(1)}. Small sample, not a proven issue.`,
        next: "Check whether this is the intended current URL and whether the title and opening answer match visitor intent. Gather a full comparison period before evaluating a change.",
        priority: "3",
        effort: "Low",
        category: "Search",
        page: r.keys[0],
        confidence: "Small sample",
      });
  if (crawl?.sitemap_error || crawl?.error)
    result.push({
      key: "crawl:discovery",
      title: "Repair website crawl discovery",
      evidence: crawl.sitemap_error || crawl.error,
      next: "Check robots.txt and the sitemap redirect chain. Make the declared sitemap resolve to valid XML with no redirect loop, then run the crawl again.",
      priority: "1",
      effort: "Low",
      category: "Site health",
      page: (brand.websiteUrl + "/sitemap.xml"),
      confidence: "Observed collection failure",
    });
  return [...new Map(result.map((x) => [x.key, x])).values()].sort((a, b) =>
    a.priority.localeCompare(b.priority),
  );
}
export function exactPage(report: any, page: string): SearchRow | undefined {
  let target: string;
  try {
    target = new URL(page, (brand.websiteUrl)).href;
  } catch {
    return;
  }
  return report?.pages?.find((r: SearchRow) => r.keys?.[0] === target);
}
export function changeStage(body: any, report: any) {
  if (body.status === "Reverted" || body.status === "Proposed")
    return body.status;
  const state = measurementState(
    body.shipped_at,
    report?.windows?.current,
    body.baseline?.windows?.current,
  );
  return body.status === "Verified" &&
    body.verification &&
    state === "Comparable window"
    ? "Verified"
    : state;
}
export function keywordStatus(row: SearchRow | undefined, intent: string) {
  if (intent === "brand") return "Brand";
  if (!row || !row.impressions) return "Not measured";
  return row.position <= 3
    ? "Top 3"
    : row.position <= 20
      ? "Within reach"
      : "Develop";
}
export function summarizeAI(
  run: any,
  competitors: { name: string; aliases?: string[] }[] = [],
) {
  const valid = (run?.answers || []).filter(
    (a: any) => a.status === "success" && a.answer,
  );
  const brands = [
    { name: (brand.name), aliases: [] },
    ...competitors,
  ];
  const named = (answer: string, b: any) =>
    [b.name, ...(b.aliases || [])].some((alias: string) =>
      new RegExp(
        `(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
        "i",
      ).test(answer),
    );
  const brandRows = brands.map((b) => ({
    name: b.name,
    mentions: valid.filter((a: any) => named(a.answer, b)).length,
  }));
  const domains = new Map<string, number>();
  for (const a of valid) {
    const unique = new Set<string>();
    for (const url of a.citations || [])
      try {
        unique.add(new URL(url).hostname.replace(/^www\./, ""));
      } catch {}
    for (const domain of unique)
      domains.set(domain, (domains.get(domain) || 0) + 1);
  }
  const mentions = brandRows[0].mentions,
    citations = domains.get((brand.domain)) || 0,
    total = brandRows.reduce((s, b) => s + b.mentions, 0);
  return {
    successful: valid.length,
    failed: (run?.answers || []).length - valid.length,
    mentions,
    citations,
    brandCoverage: valid.length ? mentions / valid.length : null,
    domainCoverage: valid.length ? citations / valid.length : null,
    share: competitors.length && total ? mentions / total : null,
    brands: brandRows.sort((a, b) => b.mentions - a.mentions),
    domains: [...domains]
      .map(([domain, answers]) => ({ domain, answers }))
      .sort((a, b) => b.answers - a.answers),
    engines: [...new Set<string>(valid.map((a: any) => a.engine))].map(
      (engine) => ({
        engine,
        answers: valid.filter((a: any) => a.engine === engine).length,
        mentions: valid.filter(
          (a: any) => a.engine === engine && named(a.answer, brands[0]),
        ).length,
        citations: valid.filter(
          (a: any) =>
            a.engine === engine &&
            (a.citations || []).some((url: string) => {
              try {
                return (
                  new URL(url).hostname.replace(/^www\./, "") ===
                  (brand.domain)
                );
              } catch {
                return false;
              }
            }),
        ).length,
      }),
    ),
  };
}
