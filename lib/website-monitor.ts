
import { brand } from "./brand";
import { openMonitorCredentials } from "./monitor-secrets";
import { createClient } from "@supabase/supabase-js";

function requiredSetting(name: string) {
 const value = process.env[name];
 if (!value || !/^[a-zA-Z0-9-]+$/.test(value)) throw Error(`Configure ${name} before using this connection.`);
 return value;
}
export const SITE = (brand.websiteUrl);
export const PAGES = [
  ["home", "Homepage", "/"],
  ["info", "Info", "/info/"],
  ["cases", "Cases", "/cases/"],
  ["contact", "Contact", "/contact/"],
] as const;
export const RANGES = [7, 14, 28, 90];
export type Report = Record<string, any>;
const stamp = () => new Date().toISOString();
export function monitorClient() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
export function monitorWorkspace() {
  return process.env.WEBSITE_MONITOR_WORKSPACE || "";
}
async function json(url: string, init: RequestInit = {}, timeout = 10000) {
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok)
    throw Error(
      `Provider request failed (HTTP ${r.status}). Previous results are kept.`,
    );
  return r.json();
}
export function unpack(raw: Report) {
  const dimensions = (raw.dimensionHeaders || []).map((h: Report) => h.name),
    metrics = (raw.metricHeaders || []).map((h: Report) => h.name);
  return {
    rows: (raw.rows || []).map((row: Report) =>
      Object.fromEntries([
        ...dimensions.map((k: string, i: number) => [
          k,
          row.dimensionValues?.[i]?.value || "",
        ]),
        ...metrics.map((k: string, i: number) => [
          k,
          Number(row.metricValues?.[i]?.value || 0),
        ]),
      ]),
    ),
    metadata: raw.metadata || {},
  };
}
export function analyticsRequests(days: number) {
  if (!RANGES.includes(days)) throw Error("Choose 7, 14, 28 or 90 days.");
  const current = {
      startDate: `${days - 1}daysAgo`,
      endDate: "today",
      name: "current",
    },
    previous = {
      startDate: `${days * 2 - 1}daysAgo`,
      endDate: `${days}daysAgo`,
      name: "previous",
    };
  const q = (
    dimensions: string[],
    metrics: string[],
    limit = 15,
    ranges = [current],
  ) => ({
    dateRanges: ranges,
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit: String(limit),
    dimensionFilter: {
      filter: {
        fieldName: "streamId",
        stringFilter: { matchType: "EXACT", value: "13572171353" },
      },
    },
    ...(dimensions.length
      ? { orderBys: [{ metric: { metricName: metrics[0] }, desc: true }] }
      : {}),
  });
  return {
    overview: q(
      [],
      [
        "activeUsers",
        "newUsers",
        "sessions",
        "screenPageViews",
        "engagementRate",
        "averageSessionDuration",
      ],
      15,
      [current, previous],
    ),
    trend: {
      ...q(["date"], ["activeUsers", "screenPageViews"], 100),
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
    pages: q(["pagePath"], ["screenPageViews", "activeUsers"]),
    sources: q(["sessionSourceMedium"], ["sessions", "activeUsers"]),
    countries: q(["country"], ["activeUsers"], 20),
    devices: q(["deviceCategory"], ["activeUsers"]),
    events: q(["eventName"], ["eventCount"]),
  };
}
async function analytics(days: number, credentials: Record<string, string>) {
  if (!credentials.refresh_token)
    throw Error("Google Analytics connection needs setup.");
  const token = await json("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials, grant_type: "refresh_token" }),
  });
  const entries = Object.entries(analyticsRequests(days));
  const results: Report = {};
  const notices = new Set<string>();
  await Promise.all(
    [entries.slice(0, 5), entries.slice(5)].map(async (batch) => {
      const data = await json(
        `https://analyticsdata.googleapis.com/v1beta/properties/${requiredSetting("GA4_PROPERTY_ID")}:batchRunReports`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requests: batch.map(([, value]) => value) }),
        },
      );
      if (data.reports?.length !== batch.length)
        throw Error("Google returned an incomplete report.");
      batch.forEach(([name], i) => {
        results[name] = unpack(data.reports[i]);
        const m = results[name].metadata;
        if (m.subjectToThresholding)
          notices.add("Google may hide rows to protect visitor privacy.");
        if (m.samplingMetadatas) notices.add("Some results are sampled.");
        if (m.dataLossFromOtherRow)
          notices.add("Some results are grouped into “other”.");
      });
    }),
  );
  return {
    days,
    fetched_at: stamp(),
    reports: results,
    timezone: results.overview.metadata.timeZone || "America/New_York",
    notices: [...notices],
    property_id: requiredSetting("GA4_PROPERTY_ID"),
    note: "Includes today, which is incomplete. Comparison is the preceding equal-length period.",
  };
}
export function healthAccessBlocked(report: Report | null | undefined) {
  return (report?.pages || []).some((p: Report) =>
    [401, 403].includes(p.status),
  );
}
const HEALTH_ACCESS_NOTE =
  "Health checks paused after an access-restricted response. Review the approved monitoring access policy before resuming. Saved results do not establish visitor availability.";
export function inspectPage(html: string, url: string, status: number) {
  const findings: Report[] = [];
  const add = (code: string, title: string) =>
    findings.push({
      code,
      title,
      url,
      severity: status >= 400 ? "high" : "normal",
    });
  if (status !== 200) add("http", `Page returned HTTP ${status}`);
  if (status === 200) {
    if (!/<title[^>]*>[^<]+<\/title>/i.test(html))
      add("title", "Missing page title");
    if (!/<meta\b[^>]*name=["']description["']/i.test(html))
      add("description", "Missing search description");
    if (!/<link\b[^>]*rel=["']canonical["']/i.test(html))
      add("canonical", "Missing canonical URL");
    if ((html.match(/<h1\b/gi) || []).length !== 1)
      add("heading", "Review the primary heading");
    if (/<meta\b[^>]*content=["'][^"']*noindex/i.test(html))
      add("index", "Page is marked noindex");
  }
  return findings;
}
async function publicPage(path: string) {
  let url = SITE + path;
  const start = Date.now();
  const signal = AbortSignal.timeout(9000);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal,
      cache: "no-store",
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = new URL(r.headers.get("location") || "", url);
      if (
        next.protocol !== "https:" ||
        ![(brand.domain), (brand.wwwDomain)].includes(
          next.hostname,
        ) ||
        next.port ||
        next.username
      )
        throw Error("Redirect left the registered website.");
      url = next.href;
      continue;
    }
    const reader = r.body?.getReader();
    let body = "",
      size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1500000)
            throw Error("Page exceeded the check size limit.");
          body += new TextDecoder().decode(part.value);
        }
      } finally {
        await reader.cancel();
      }
    }
    return { url, status: r.status, response_ms: Date.now() - start, body };
  }
  throw Error("Too many redirects.");
}
async function health() {
  const results = await Promise.all(
    PAGES.map(async ([id, label, path]) => {
      try {
        const p = await publicPage(path);
        return { id, label, ...p, error: null };
      } catch {
        return {
          id,
          label,
          url: SITE + path,
          status: null,
          response_ms: null,
          body: "",
          error: "Could not complete this page check.",
        };
      }
    }),
  );
  return {
    checked_at: stamp(),
    pages: results.map(({ body, ...row }) => row),
    findings: results.flatMap((r) =>
      r.error ? [] : inspectPage(r.body, r.url, r.status!),
    ),
    complete: results.every((r) => !r.error && ![401, 403].includes(r.status!)),
    note: "Bounded checks of six key pages: availability, title, description, canonical, indexing and primary heading. This is not a full crawl or an uptime percentage.",
  };
}
async function domains() {
  const rows = await Promise.all(
    [
      ["NS", "Name servers"],
      ["MX", "Email routing"],
      ["A", "Website address"],
    ].map(async ([type, label]) => {
      const raw = await json(
        `https://dns.google/resolve?name=${brand.domain}&type=${type}`,
      );
      if (raw.Status !== 0) throw Error("DNS lookup unavailable.");
      return {
        label,
        observed:
          (raw.Answer || []).map((a: Report) => a.data).join(", ") ||
          "No records returned",
      };
    }),
  );
  return {
    checked_at: stamp(),
    rows,
    note: "Observed public DNS records. These do not verify mailbox delivery, account billing or auto-renewal.",
  };
}
async function delivery(token: string) {
  if (!token) throw Error("Deployment connection needs setup.");
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const site = await json(
    `https://api.netlify.com/api/v1/sites/${requiredSetting("NETLIFY_SITE_ID")}`,
    { headers },
  );
  if (site.custom_domain !== (brand.domain))
    throw Error("Provider returned a different website.");
  const clean = (d: Report) =>
    d
      ? {
          id: d.id,
          state: d.state,
          commit: d.commit_ref,
          created_at: d.created_at,
          published_at: d.published_at,
        }
      : null;
  return {
    checked_at: stamp(),
    published: clean(site.published_deploy),
    note: "Published website release. Build status is separate from live website availability.",
  };
}
async function performance(page: string, device: string, key: string) {
  const p = PAGES.find((p) => p[0] === page);
  if (!p || !["mobile", "desktop"].includes(device))
    throw Error("Choose a registered page and device.");
  const params = new URLSearchParams({
    url: SITE + p[2],
    strategy: device,
    ...(key ? { key: key } : {}),
  });
  for (const c of ["performance", "accessibility", "best-practices", "seo"])
    params.append("category", c);
  const raw = await json(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + params,
    {},
    24000,
  );
  const l = raw.lighthouseResult;
  if (
    !l ||
    l.runtimeError ||
    ["performance", "accessibility", "best-practices", "seo"].some(
      (k) => typeof l.categories?.[k]?.score !== "number",
    )
  )
    throw Error("PageSpeed returned an incomplete audit.");
  const final = new URL(l.finalDisplayedUrl || l.finalUrl || SITE + p[2]);
  if (
    final.origin !== SITE ||
    final.pathname.replace(/\/$/, "") !== p[2].replace(/\/$/, "")
  )
    throw Error("PageSpeed ended on another page.");
  return {
    checked_at: stamp(),
    page_id: page,
    label: p[1],
    strategy: device,
    url: SITE + p[2],
    scores: Object.fromEntries(
      Object.entries(l.categories).map(([k, v]) => [
        k,
        Math.round((v as Report).score * 100),
      ]),
    ),
    metrics: Object.fromEntries(
      [
        "largest-contentful-paint",
        "cumulative-layout-shift",
        "total-blocking-time",
      ].map((k) => [k, l.audits?.[k]?.displayValue || "Unavailable"]),
    ),
    note: "Lighthouse lab measurements from this run, not real-visitor measurements.",
  };
}
export async function refreshMonitor(
  kind: string,
  days = 7,
  page = "home",
  device = "mobile",
  retestHealth = false,
) {
  const w = monitorWorkspace();
  if (!w)
    throw Error(
      "Website monitoring has not been configured for this workspace.",
    );
  const id =
    kind === "analytics"
      ? `analytics-${days}`
      : kind === "performance"
        ? `performance-${page}-${device}`
        : kind;
  if (
    !["health", "analytics", "domains", "delivery", "performance"].includes(
      kind,
    )
  )
    throw Error("Unknown report.");
  const db = monitorClient();
  const { data: claimed, error: lockError } = await db.rpc(
    "claim_monitor_refresh",
    { w, k: id },
  );
  if (lockError) throw Error("Could not reserve the refresh.");
  if (!claimed) return { skipped: true };
  const { data: prior, error: readError } = await db
    .from("monitor_records")
    .select("body")
    .eq("workspace_id", w)
    .eq("source", "pms-monitor")
    .eq("kind", "website_report")
    .eq("source_id", id)
    .maybeSingle();
  if (readError) throw Error("Could not read the saved report.");
  if (
    kind === "health" &&
    (prior?.body?.access_paused || healthAccessBlocked(prior?.body)) &&
    !retestHealth
  ) {
    if (!prior?.body?.access_paused) {
      const paused = await db
        .from("monitor_records")
        .update({
          body: {
            ...prior!.body,
            access_paused: true,
            complete: false,
            error: HEALTH_ACCESS_NOTE,
          },
        })
        .eq("workspace_id", w)
        .eq("source", "pms-monitor")
        .eq("kind", "website_report")
        .eq("source_id", id);
      if (paused.error) throw Error("Could not save the health check pause.");
    }
    return { skipped: true, paused: true, error: HEALTH_ACCESS_NOTE };
  }
  let body: Report;
  try {
    let credentials: ReturnType<typeof openMonitorCredentials> | undefined;
    if (["analytics", "performance", "delivery"].includes(kind)) {
      const { data: connection, error } = await db
        .from("website_monitor_connections")
        .select("encrypted_payload")
        .eq("workspace_id", w)
        .single();
      if (error || !connection)
        throw Error("Website provider connections need setup.");
      credentials = openMonitorCredentials(connection.encrypted_payload, w);
    }
    const report: Report =
      kind === "analytics"
        ? await analytics(days, credentials!.google)
        : kind === "health"
          ? await health()
          : kind === "domains"
            ? await domains()
            : kind === "delivery"
              ? await delivery(credentials!.netlify)
              : await performance(page, device, credentials!.pagespeed);
    if (kind === "health") {
      report.access_paused =
        healthAccessBlocked(report) ||
        ((Boolean(prior?.body?.access_paused) ||
          healthAccessBlocked(prior?.body)) &&
          !report.complete);
    }
    body = {
      ...report,
      report_type: kind,
      last_attempt_at: stamp(),
      error: report.access_paused ? HEALTH_ACCESS_NOTE : null,
    };
  } catch (e) {
    body = {
      ...(prior?.body || {}),
      report_type: kind,
      last_attempt_at: stamp(),
      error:
        e instanceof Error &&
        /^(Provider|Google|Deployment|DNS|PageSpeed|Could|Redirect|Too|Page |Website)/.test(
          e.message,
        )
          ? e.message
          : "The check could not finish. Previous results are kept.",
    };
  }
  const { error } = await db.from("monitor_records").upsert(
    {
      workspace_id: w,
      source: "pms-monitor",
      kind: "website_report",
      source_id: id,
      title: id,
      body,
      source_updated_at: body.checked_at || body.fetched_at || null,
      imported_at: stamp(),
    },
    { onConflict: "workspace_id,source,kind,source_id" },
  );
  if (error) throw Error("Could not save the report.");
  return { updated: !body.error, error: body.error };
}
