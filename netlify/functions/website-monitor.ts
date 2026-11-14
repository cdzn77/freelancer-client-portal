import { refreshSearch } from "../../lib/search-providers";
import type { Config } from "@netlify/functions";
import { monitorWorkspace, refreshMonitor } from "../../lib/website-monitor";
export default async function () {
  if (!monitorWorkspace()) return Response.json({ enabled: false });
  const hour = new Date().getUTCHours();
  const jobs: Promise<unknown>[] = [
    refreshMonitor("health"),
    refreshMonitor("analytics", [7, 14, 28, 90][hour % 4]),
  ];
  if (hour === 8 && Netlify.env.get("SEARCH_CONSOLE_PROPERTY"))
    jobs.push(refreshSearch());
  if (hour % 6 === 0)
    jobs.push(refreshMonitor("domains"), refreshMonitor("delivery"));
  return Response.json(await Promise.allSettled(jobs));
}
export const config: Config = { schedule: "17 * * * *" };
