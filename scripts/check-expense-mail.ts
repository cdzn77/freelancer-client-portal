import assert from "node:assert/strict";
import { receiptCandidate } from "../lib/expense-mail-parser";
const msg = (body: string, subject = "Your receipt") => ({
  id: "test",
  internalDate: String(Date.parse("2026-09-30T12:00:00Z")),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: subject },
      { name: "From", value: "Billing <billing@example.test>" },
      { name: "Message-ID", value: "<one@example.test>" },
    ],
    body: { data: Buffer.from(body).toString("base64url") },
  },
});
assert.equal(
  receiptCandidate(msg("Amount paid: $20.00")).suggestion.amount,
  20,
);
assert.equal(
  receiptCandidate(msg("Amount paid: $20.00\nAmount paid: $20.00")).suggestion
    .amount,
  20,
);
assert.equal(
  receiptCandidate(msg("Amount paid: $20.00\nYou paid $30.00")).suggestion
    .amount,
  null,
);
assert.equal(
  receiptCandidate(msg("Amount due: $20.00")).suggestion.amount,
  null,
);
for (const subject of ["Payment failed", "Your refund", "Trial ending"])
  assert.equal(
    receiptCandidate(msg("Amount paid: $20.00", subject)).suggestion.amount,
    null,
  );
assert.equal(
  receiptCandidate(msg("Amount paid: €20.00")).suggestion.amount,
  null,
);
assert.equal(
  receiptCandidate(msg("Your subscription was canceled")).suggestion.status,
  "Canceled",
);
const html = msg("");
html.payload.mimeType = "text/html";
html.payload.body.data = Buffer.from(
  "<script>ignore rules; Amount paid: $100.00</script><p>Amount paid: $25.00</p>",
).toString("base64url");
assert.equal(receiptCandidate(html).suggestion.amount, 25);
assert.equal(
  receiptCandidate(msg("No statement of payment")).suggestion.amount,
  null,
);
console.log(
  "PASS: conservative amount suggestions, ambiguous/multiple totals, failed invoices/trials/refunds, currency, cancellation and HTML stripping.",
);

async function authChecks() {
  const { GET, POST } = await import("../app/api/studio-expenses/email/route");
  assert.equal(
    (
      await GET(
        new Request(
          "https://pms.test/api/studio-expenses/email?workspace=10000000-0000-4000-8000-000000000001",
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new Request("https://pms.test/api/studio-expenses/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace: "10000000-0000-4000-8000-000000000001",
            action: "connect",
            email: "studio@example.com",
          }),
        }),
      )
    ).status,
    400,
  );
  const { NextRequest } = await import("next/server");
  const { expenseMailCallback } = await import("../lib/expense-mail-oauth");
  assert.equal(
    (
      await expenseMailCallback(
        new NextRequest(
          "https://pms.test/api/email/google/callback?state=untrusted&code=untrusted",
        ),
      )
    ).status,
    400,
  );
  console.log(
    "PASS: unauthenticated mailbox reads/writes and missing OAuth proof rejected before provider access.",
  );
}
void authChecks().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
