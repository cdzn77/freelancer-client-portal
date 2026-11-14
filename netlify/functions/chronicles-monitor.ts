import type { Config } from "@netlify/functions";
import { refreshChronicles } from "../../lib/chronicles-provider";
export default async function () {
  return Response.json(await refreshChronicles());
}
export const config: Config = { schedule: "47 */6 * * *" };
