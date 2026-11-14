
import { brand } from "./brand";
import { createHash } from "node:crypto";
import {
  monitorClient,
  monitorWorkspace,
  inspectPage,
} from "./website-monitor";
const ORIGIN = (brand.websiteUrl);
export function safeCrawlURL(input: string) {
  try {
    const u = new URL(input, ORIGIN);
    if (
      ![ORIGIN, (brand.wwwUrl)].includes(u.origin) ||
      u.username ||
      u.password ||
      u.search ||
      /\.(pdf|zip|png|jpe?g|webp|svg|gif|mp4|css|js|ico|woff2?|ttf)$/i.test(
        u.pathname,
      )
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
export function robotsAllows(url: string, rules: string[]) {
  const pathname = new URL(url, ORIGIN).pathname;
  return !rules.filter(Boolean).some((rule) => {
    const end = rule.endsWith("$");
    const pattern = (end ? rule.slice(0, -1) : rule)
      .split("*")
      .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp("^" + pattern + (end ? "$" : "")).test(pathname);
  });
}
export function crawlPage(html: string, url: string, status: number) {
  const meta = (name: string) => {
    const tag =
      html.match(
        new RegExp(`<meta\\b[^>]*name=["']${name}["'][^>]*>`, "i"),
      )?.[0] || "";
    return tag.match(/content=["']([^"']*)/i)?.[1] || "";
  };
  const schemas = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((x) => x[1].trim())
    .sort();
  return {
    url,
    status,
    title:
      html
        .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.trim()
        .slice(0, 500) || "",
    description: meta("description").slice(0, 1000),
    canonical:
      html
        .match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0]
        ?.match(/href=["']([^"']*)/i)?.[1] || "",
    schemaHash: schemas.length
      ? createHash("sha256").update(schemas.join("\n")).digest("hex")
      : "",
    findings: inspectPage(html, url, status),
    checked_at: new Date().toISOString(),
  };
}
export function crawlDrift(before: any[], after: any[]) {
  const changes: any[] = [];
  for (const page of after) {
    const prior = before.find((p) => p.url === page.url);
    if (!prior || prior.status !== 200 || page.status !== 200) continue;
    for (const field of ["title", "description", "canonical", "schemaHash"])
      if (prior[field] !== page[field])
        changes.push({
          url: page.url,
          field,
          before: prior[field],
          after: page[field],
        });
  }
  return changes;
}
export async function refreshCrawl(retestPaused = false) {
  const db = monitorClient(),
    workspace = monitorWorkspace();
  if (!workspace) throw Error("Website monitoring needs setup.");
  const claim = await db.rpc("claim_monitor_refresh", {
    w: workspace,
    k: "crawl",
  });
  if (claim.error) throw Error("Could not reserve a crawl.");
  if (!claim.data) return { skipped: true };
  const deadline = AbortSignal.timeout(24000);
  async function get(
    url: string,
    redirects = 0,
  ): Promise<{ status: number; text: string }> {
    if (!safeCrawlURL(url)) throw Error("Unsupported crawl URL");
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(6000)]),
      headers: {
        "User-Agent": ("PortalMonitor/1.0 (+" + brand.websiteUrl + ")"),
      },
    });
    if ([401, 403, 429].includes(r.status))
      throw Error(`Access restricted (${r.status})`);
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("location");
      const next = location ? safeCrawlURL(new URL(location, url).href) : null;
      if (next && redirects < 3) return get(next, redirects + 1);
    }
    const text = (await r.text()).slice(0, 1500000);
    return { status: r.status, text };
  }
  const prior = await db
    .from("monitor_records")
    .select("body")
    .eq("workspace_id", workspace)
    .eq("source", "pms-search")
    .eq("kind", "crawl")
    .eq("source_id", "current")
    .maybeSingle();
  if (prior.error) throw Error("Could not load crawl state.");
  let state: any = prior.data?.body;
  if (
    state?.paused ||
    /Access restricted|access was restricted/.test(state?.error || "")
  ) {
    if (!retestPaused)
      return {
        skipped: true,
        error:
          "Crawl is paused after an access restriction. Review the site policy before resuming collection.",
      };
    // Explicit administrator retry runs from the same hosted collector, with the same agent and policy.
    try {
      const robots = await get(ORIGIN + "/robots.txt");
      if (![200, 404].includes(robots.status))
        throw Error("Robots policy unavailable");
      const rules = [...robots.text.matchAll(/^Disallow:\s*(\S+)/gim)].map(
        (x) => x[1],
      );
      if (!robotsAllows(ORIGIN + "/", rules))
        throw Error("Robots policy disallows the homepage");
      const home = await get(ORIGIN + "/");
      if (home.status !== 200) throw Error("Homepage unavailable");
      state = {
        ...state,
        paused: false,
        error: null,
        complete: true,
        pages: state.previous || state.pages || [],
      };
    } catch {
      return {
        skipped: true,
        error:
          "Access retest did not pass. Collection remains paused; no site policy was changed.",
      };
    }
  }
  if (!state || state.complete || state.error) {
    const previous = state?.complete ? state.pages : state?.previous || [];
    state = {
      started_at: new Date().toISOString(),
      pages: [],
      previous,
      queue: [],
      changes: [],
      complete: false,
      coverage: "Sitemap URLs, up to 500 pages per cycle",
      limit: 500,
    };
    try {
      const robots = await get(ORIGIN + "/robots.txt");
      if (robots.status !== 200 && robots.status !== 404)
        throw Error("Robots policy unavailable");
      // Conservatively honor every disallow entry, including agent-specific restrictions.
      state.disallow = [...robots.text.matchAll(/^Disallow:\s*(\S+)/gim)].map(
        (x) => x[1],
      );
      const declared = [...robots.text.matchAll(/^Sitemap:\s*(\S+)/gim)]
        .map((x) => x[1])
        .find((x) => safeCrawlURL(x));
      let root = await get(declared || ORIGIN + "/sitemap.xml");
      if (root.status === 404 && !declared)
        root = await get(ORIGIN + "/sitemap-index.xml");
      if (root.status !== 200)
        throw Error("Sitemap unavailable (HTTP " + root.status + ")");
      const locations = (xml: string) =>
        [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
          .map((x) => x[1].trim().replace(/&amp;/g, "&"))
          .filter((x) => safeCrawlURL(x));
      let urls = locations(root.text);
      if (/<sitemapindex\b/i.test(root.text)) {
        const children = await Promise.all(
          urls.slice(0, 8).map(async (url) => {
            const r = await get(url);
            if (r.status !== 200) throw Error("Child sitemap unavailable");
            return locations(r.text);
          }),
        );
        state.sitemapLimited = urls.length > 8;
        urls = children.flat();
      }
      const allowed = urls.filter((url) => robotsAllows(url, state.disallow));
      state.discovered = urls.length;
      state.excluded = urls.length - allowed.length;
      state.truncated = allowed.length > 500 || state.sitemapLimited;
      state.queue = [...new Set(allowed)].slice(0, 500);
      if (!state.queue.length) throw Error("No crawlable sitemap pages");
    } catch (e) {
      state.error = (e as Error).message;
      if (
        /^(Sitemap unavailable|No crawlable sitemap|Child sitemap unavailable)/.test(
          state.error,
        ) &&
        Array.isArray(state.disallow) &&
        robotsAllows(ORIGIN + "/", state.disallow)
      ) {
        state.sitemap_error = state.error;
        state.error = null;
        state.discovery_mode = "links";
        state.coverage =
          "Reachable same-site links; sitemap discovery unavailable; up to 500 pages";
        state.queue = [ORIGIN + "/"];
      }
    }
  }
  if (!state.error) {
    for (
      let batch = 0;
      batch < 3 && state.queue.length && !deadline.aborted;
      batch++
    ) {
      const urls = state.queue.splice(0, 4);
      const pages = await Promise.all(
        urls.map(async (url: string) => {
          try {
            const r = await get(url);
            const page = crawlPage(r.text, url, r.status);
            if (state.discovery_mode === "links" && r.status === 200) {
              const known = new Set([
                ...state.pages.map((p: any) => p.url),
                ...state.queue,
                ...urls,
              ]);
              for (const match of r.text.matchAll(
                /<a\b[^>]*href=["']([^"']+)["']/gi,
              )) {
                let target: string | null = null;
                try {
                  target = safeCrawlURL(new URL(match[1], url).href);
                } catch {}
                if (
                  !target ||
                  known.has(target) ||
                  !robotsAllows(target, state.disallow)
                )
                  continue;
                if (
                  state.pages.length + state.queue.length + urls.length >=
                  500
                ) {
                  state.truncated = true;
                  break;
                }
                state.queue.push(target);
                known.add(target);
              }
            }
            return page;
          } catch (e) {
            return {
              url,
              status: null,
              error: (e as Error).message,
              checked_at: new Date().toISOString(),
            };
          }
        }),
      );
      state.pages.push(...pages);
      if (pages.some((p: any) => p.error?.startsWith("Access restricted"))) {
        state.paused = true;
        state.error =
          "Crawl paused: site access was restricted. Review the site policy before retrying.";
        break;
      }
    }
    state.complete = state.queue.length === 0 && !state.error;
    state.changes = crawlDrift(state.previous || [], state.pages);
    state.failed = state.pages.filter((p: any) => p.status !== 200).length;
    if (state.complete) state.completed_at = new Date().toISOString();
  }
  state.updated_at = new Date().toISOString();
  const saved = await db.from("monitor_records").upsert(
    {
      workspace_id: workspace,
      source: "pms-search",
      kind: "crawl",
      source_id: "current",
      title: "Website crawl and content changes",
      body: state,
      imported_at: state.updated_at,
    },
    { onConflict: "workspace_id,source,kind,source_id" },
  );
  if (saved.error) throw Error("Could not save crawl state.");
  if (state.complete) {
    const archive = await db.from("monitor_records").upsert(
      {
        workspace_id: workspace,
        source: "pms-search",
        kind: "crawl_history",
        source_id: state.started_at,
        title: "Completed sitemap crawl",
        body: { ...state, previous: undefined, queue: undefined },
        imported_at: state.updated_at,
      },
      { onConflict: "workspace_id,source,kind,source_id" },
    );
    if (archive.error) throw Error("Could not save crawl history.");
  }
  return {
    updated: true,
    checked: state.pages.length,
    remaining: state.queue.length,
    complete: state.complete,
    error: state.error,
  };
}
