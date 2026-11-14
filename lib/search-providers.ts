
import { brand } from "./brand";
import { monitorClient, monitorWorkspace } from "./website-monitor";
import { openMonitorCredentials } from "./monitor-secrets";
import { searchWindows, totals, type SearchRow } from "./search-intelligence";
export async function refreshSearch() {
  const db = monitorClient(),
    workspace = monitorWorkspace();
  if (!workspace) throw Error("Website monitoring needs setup.");
  const { data: claimed, error: claimError } = await db.rpc(
    "claim_monitor_refresh",
    { w: workspace, k: "search-intelligence" },
  );
  if (claimError) throw Error("Could not reserve a refresh.");
  if (!claimed) return { skipped: true };
  const property =
    process.env.SEARCH_CONSOLE_PROPERTY || (brand.websiteUrl + "/");
  if (
    ![
      (brand.searchProperty),
      (brand.websiteUrl + "/"),
      (brand.wwwUrl + "/"),
    ].includes(property)
  )
    throw Error(("Choose the " + brand.domain + " Search Console property."));
  const { data: connection, error } = await db
    .from("website_monitor_connections")
    .select("encrypted_payload")
    .eq("workspace_id", workspace)
    .single();
  if (error || !connection)
    throw Error(
      "Connect Google with Search Console read access before refreshing.",
    );
  const google = openMonitorCredentials(
    connection.encrypted_payload,
    workspace,
  ).google_search;
  if (!google)
    throw Error(
      "Connect the existing read-only Search Console grant to this Monitor.",
    );
  const body = await collectSearchReport(google, property);
  const saved = await db.from("monitor_records").upsert(
    {
      workspace_id: workspace,
      source: "pms-search",
      kind: "search_report",
      source_id: "current",
      title: (brand.name + " search performance"),
      body,
      imported_at: body.fetched_at,
    },
    { onConflict: "workspace_id,source,kind,source_id" },
  );
  if (saved.error) throw Error("Could not save the search report.");
  return { updated: true };
}
export async function collectSearchReport(
  google: { client_id: string; client_secret: string; refresh_token: string },
  property: string,
) {
  if (
    ![
      (brand.searchProperty),
      (brand.websiteUrl + "/"),
      (brand.wwwUrl + "/"),
    ].includes(property)
  )
    throw Error(("Choose the " + brand.domain + " Search Console property."));
  const auth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ ...google, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!auth.ok) throw Error("Reconnect Google to refresh search reports.");
  const token = await auth.json();
  const windows = searchWindows();
  async function query(
    window: { startDate: string; endDate: string },
    dimensions: string[],
    chroniclesOnly = false,
  ): Promise<SearchRow[]> {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...window,
          dimensions,
          type: "web",
          dataState: "final",
          ...(chroniclesOnly
            ? {
                dimensionFilterGroups: [
                  {
                    filters: [
                      {
                        dimension: "page",
                        operator: "contains",
                        expression: (brand.websiteUrl + "/chronicles/"),
                      },
                    ],
                  },
                ],
              }
            : {}),
          rowLimit: dimensions[0] === "date" ? 100 : 1000,
        }),
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw Error(
        response.status === 403
          ? "Google needs Search Console read access and permission to this property. Your saved report is unchanged."
          : "Google could not return the report. Your saved report is unchanged.",
      );
    const result = await response.json();
    return result.rows || [];
  }
  const historyStart = new Date(windows.current.endDate + "T12:00:00Z");
  historyStart.setUTCMonth(historyStart.getUTCMonth() - 16);
  const ninetyStart = new Date(windows.current.endDate + "T12:00:00Z");
  ninetyStart.setUTCDate(ninetyStart.getUTCDate() - 89);
  const historyWindows = {
    ninety: {
      startDate: ninetyStart.toISOString().slice(0, 10),
      endDate: windows.current.endDate,
    },
    sixteenMonths: {
      startDate: historyStart.toISOString().slice(0, 10),
      endDate: windows.current.endDate,
    },
  };
  const [
    current,
    previous,
    year,
    queries,
    pages,
    queries90,
    queries16,
    previousPages,
    chroniclesQueries,
  ] = await Promise.all([
    query(windows.current, ["date"]),
    query(windows.previous, ["date"]),
    query(windows.year, ["date"]),
    query(windows.current, ["query"]),
    query(windows.current, ["page"]),
    query(historyWindows.ninety, ["query"]),
    query(historyWindows.sixteenMonths, ["query"]),
    query(windows.previous, ["page"]),
    query(windows.current, ["page", "query"], true),
  ]);
  return {
    windows,
    totals: {
      current: totals(current),
      previous: totals(previous),
      year: totals(year),
    },
    trend: current,
    previousTrend: previous,
    yearTrend: year,
    queries,
    pages,
    previousPages,
    chroniclesQueries,
    keywordHistory: {
      windows: historyWindows,
      ninety: queries90,
      sixteenMonths: queries16,
    },
    property,
    fetched_at: new Date().toISOString(),
    note: "Finalized web search data. Dates use Pacific time. Previous-year comparison uses the same weekdays, 364 days earlier. Tables contain up to 1,000 top rows; anonymized queries are omitted. Totals come from daily rows.",
  };
}
// Public, undocumented Google Suggest endpoint. Best effort only; never bypass a denial.
export async function autocomplete(
  seed: string,
  language: string,
  country: string,
) {
  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.search = new URLSearchParams({
    client: "firefox",
    q: seed,
    hl: language,
    gl: country,
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw Error(
      "Google Autocomplete is unavailable. Try later or add a keyword manually.",
    );
  const result: unknown = await response.json();
  if (!Array.isArray(result) || !Array.isArray(result[1]))
    throw Error("Google returned an unsupported suggestion format.");
  return {
    seed,
    language,
    country,
    source: "Google Autocomplete",
    fetched_at: new Date().toISOString(),
    suggestions: [
      ...new Set(
        result[1].filter(
          (s: unknown): s is string => typeof s === "string" && s.length <= 200,
        ),
      ),
    ].slice(0, 20),
    note: "Autocomplete suggestions are discovery ideas, not search volume or ranking. Results depend on language, country and time. This public endpoint has no availability guarantee.",
  };
}
