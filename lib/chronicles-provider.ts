
import { brand } from "./brand";
import { monitorClient, monitorWorkspace } from "./website-monitor";
import { openMonitorCredentials } from "./monitor-secrets";
import { articleURL, feedArticles } from "./chronicles-monitor";
export async function refreshChronicles(retestDiscovery = false) {
  const db = monitorClient(),
    w = monitorWorkspace();
  if (!w) throw Error("Monitor is not configured.");
  const claim = await db.rpc("claim_monitor_refresh", { w, k: "chronicles" });
  if (claim.error) throw Error("Could not reserve Chronicles collection.");
  if (!claim.data) return { skipped: true };
  const deadline = AbortSignal.timeout(24000);
  const old = await db
    .from("monitor_records")
    .select("body")
    .eq("workspace_id", w)
    .eq("source", "pms-search")
    .eq("kind", "chronicles")
    .eq("source_id", "current")
    .maybeSingle();
  if (old.error) throw Error("Could not load Chronicles inventory.");
  const previous = (old.data?.body?.articles || []).filter((a: any) =>
    articleURL(a.url),
  );
  let articles: any[] = previous.map((a: any) => ({ ...a }));
  let discoveryPaused = Boolean(old.data?.body?.discoveryPaused);
  let discoveryError = old.data?.body?.discoveryError;
  let inventoryAt = old.data?.body?.inventory_at || old.data?.body?.fetched_at;
  if (!discoveryPaused || retestDiscovery)
    try {
      const response = await fetch(
        (brand.websiteUrl + "/chronicles/feed.xml"),
        {
          redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(6000)]),
          headers: {
            "User-Agent": ("PortalMonitor/1.0 (+" + brand.websiteUrl + ")"),
          },
        },
      );
      if (!response.ok)
        throw Error(
          `Chronicles feed unavailable (HTTP ${response.status}). Discovery is paused; saved articles are retained.`,
        );
      const inventory = feedArticles(await response.text());
      if (!inventory.length)
        throw Error(
          "Chronicles feed has no valid articles. Saved inventory is unchanged.",
        );
      articles = inventory.map((x) => ({
        ...previous.find((p: any) => p.url === x.url),
        ...x,
      }));
      inventoryAt = new Date().toISOString();
      discoveryPaused = false;
      discoveryError = undefined;
    } catch (e) {
      discoveryPaused = true;
      discoveryError =
        e instanceof Error && e.message.startsWith("Chronicles")
          ? e.message
          : "Feed discovery could not complete. Discovery is paused; saved articles are retained.";
    }
  let collectionError: string | undefined;
  try {
    const connection = await db
      .from("website_monitor_connections")
      .select("encrypted_payload")
      .eq("workspace_id", w)
      .single();
    if (connection.error) throw Error("Search Console connection unavailable.");
    const google = openMonitorCredentials(
      connection.data.encrypted_payload,
      w,
    ).google_search;
    if (!google) throw Error("Search Console read access is not connected.");
    const auth = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ ...google, grant_type: "refresh_token" }),
      signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
    });
    if (!auth.ok) throw Error("Search Console needs reconnection.");
    const token = await auth.json();
    const property =
      process.env.SEARCH_CONSOLE_PROPERTY || (brand.websiteUrl + "/");
    if (
      ![
        (brand.websiteUrl + "/"),
        (brand.searchProperty),
        (brand.wwwUrl + "/"),
      ].includes(property)
    )
      throw Error("Unsupported Search Console property.");
    const batch = [...articles]
      .sort(
        (a, b) =>
          Date.parse(a.attemptedAt || a.inspectedAt || "1970-01-01") -
          Date.parse(b.attemptedAt || b.inspectedAt || "1970-01-01"),
      )
      .slice(0, 20);
    await Promise.all(
      batch.map(async (item) => {
        item.attemptedAt = new Date().toISOString();
        try {
          const r = await fetch(
            "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                inspectionUrl: item.url,
                siteUrl: property,
                languageCode: "en-US",
              }),
              signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
            },
          );
          if (!r.ok)
            throw Error(`Google inspection unavailable (HTTP ${r.status}).`);
          const data = await r.json();
          const result = data.inspectionResult?.indexStatusResult;
          if (!result) throw Error("Google returned no index status.");
          item.index = {
            verdict: result.verdict,
            coverageState: result.coverageState,
            robotsTxtState: result.robotsTxtState,
            indexingState: result.indexingState,
            lastCrawlTime: result.lastCrawlTime,
            googleCanonical: result.googleCanonical,
            userCanonical: result.userCanonical,
            pageFetchState: result.pageFetchState,
          };
          item.inspectedAt = new Date().toISOString();
          delete item.inspectionError;
        } catch (e) {
          item.inspectionError =
            e instanceof Error && e.message.startsWith("Google")
              ? e.message
              : "Google inspection timed out or could not complete.";
        }
      }),
    );
  } catch (e) {
    collectionError =
      e instanceof Error ? e.message : "Collection unavailable.";
  }
  const body = {
    articles,
    inventory_at: inventoryAt,
    discoveryPaused,
    discoveryError,
    fetched_at: new Date().toISOString(),
    collectionError,
    note: "Google URL Inspection describes the indexed version, not a live test or indexing request. Up to 20 oldest inspections refresh each run. Search data uses the separate finalized Search Console window.",
  };
  const saved = await db.from("monitor_records").upsert(
    {
      workspace_id: w,
      source: "pms-search",
      kind: "chronicles",
      source_id: "current",
      title: "Chronicles visibility",
      body,
      imported_at: body.fetched_at,
    },
    { onConflict: "workspace_id,source,kind,source_id" },
  );
  if (saved.error) throw Error("Could not save Chronicles report.");
  return {
    updated: true,
    articles: articles.length,
    inspected: articles.filter((x) => x.inspectedAt).length,
    errors: articles.filter((x) => x.inspectionError).length,
    collectionError,
  };
}
