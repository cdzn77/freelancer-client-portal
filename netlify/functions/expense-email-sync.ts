import type { Config } from "@netlify/functions";
import { syncExpenseMailbox } from "../../lib/expense-mail-sync";
export default async function () {
  // No mailbox can be scanned until its owner has explicitly connected it.
  try {
    return Response.json(await syncExpenseMailbox());
  } catch {
    return Response.json(
      { error: "Receipt sync needs attention in Studio expenses." },
      { status: 503 },
    );
  }
}
export const config: Config = { schedule: "*/15 * * * *" };
