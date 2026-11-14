import type { Config } from "@netlify/functions";
import { refreshCrawl } from "../../lib/monitor-crawl";
export default async function () {
  if (Netlify.env.get("MONITOR_CRAWL_ENABLED") !== "true")
    return Response.json({ enabled: false });
  return Response.json(await refreshCrawl());
}
export const config: Config = { schedule: "37 * * * *" };
