import type { Config } from "@netlify/functions";
import {
  monitorWorkspace,
  PAGES,
  refreshMonitor,
} from "../../lib/website-monitor";
export default async function () {
  if (!monitorWorkspace()) return Response.json({ enabled: false });
  const slot = Math.floor(new Date().getUTCHours() / 2);
  return Response.json(
    await refreshMonitor(
      "performance",
      7,
      PAGES[Math.floor(slot / 2)][0],
      slot % 2 ? "desktop" : "mobile",
    ),
  );
}
export const config: Config = { schedule: "42 */2 * * *" };
