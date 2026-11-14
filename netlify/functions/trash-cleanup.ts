import type { Config } from "@netlify/functions";
import { cleanupTrashFiles } from "../../lib/trash-cleanup";
export default async function () {
  return Response.json({ pending: await cleanupTrashFiles() });
}
export const config: Config = { schedule: "*/15 * * * *" };
