
import { brand } from "./brand";
export const CHRONICLES_ORIGIN = (brand.websiteUrl);
export function articleURL(input: string) {
  try {
    const u = new URL(input);
    return u.origin === CHRONICLES_ORIGIN &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/chronicles\/[a-z0-9-]+\/$/.test(u.pathname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
export function feedArticles(xml: string) {
  if (!/<rss\b/.test(xml))
    throw Error("Chronicles RSS unavailable. Saved inventory unchanged.");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => {
      const read = (tag: string) =>
        decode(
          m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || "",
        );
      return {
        url: articleURL(read("link")),
        title: read("title"),
        publishedAt: read("pubDate"),
      };
    })
    .filter((x) => x.url && x.title);
  return [...new Map(items.map((x) => [x.url, x])).values()];
}
export function indexLabel(item: any) {
  if (item.inspectionError) return "Inspection unavailable";
  if (!item.inspectedAt) return "Not inspected";
  return item.index?.verdict === "PASS"
    ? "Indexed"
    : item.index?.coverageState || "Not confirmed indexed";
}
export function articleAdvice(item: any, row: any, windowEnd?: string) {
  if (item.inspectionError || !item.inspectedAt)
    return "Check Google inspection status.";
  if (item.index?.verdict !== "PASS")
    return "Inspect crawl access, canonical and Google coverage before editing copy.";
  if (
    windowEnd &&
    Date.parse(item.publishedAt) > Date.parse(windowEnd + "T23:59:59Z")
  )
    return "Published after this reporting window. Wait for finalized search data.";
  if (!row)
    return "No reported search row yet. This does not establish zero demand.";
  if (row.impressions >= 100 && row.ctr < 0.02)
    return "Review the query intent and search title. Low CTR alone does not prove a title problem.";
  return "Keep collecting evidence; compare a full post-publication window before changing direction.";
}
