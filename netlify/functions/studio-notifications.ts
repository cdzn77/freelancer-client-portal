import type { Config } from "@netlify/functions";
import { deliverNotifications } from "../../lib/studio-email";
export default async function () {
  return Response.json(await deliverNotifications());
}
export const config: Config = { schedule: "*/15 * * * *" };
