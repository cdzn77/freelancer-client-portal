import assert from "node:assert/strict";
import {
  analyticsRequests,
  inspectPage,
  unpack,
  healthAccessBlocked,
} from "../lib/website-monitor";
const requests = analyticsRequests(7);
assert.deepEqual(requests.overview.dateRanges, [
  { startDate: "6daysAgo", endDate: "today", name: "current" },
  { startDate: "13daysAgo", endDate: "7daysAgo", name: "previous" },
]);
assert.throws(() => analyticsRequests(8));
assert.equal(
  requests.pages.dimensionFilter.filter.stringFilter.value,
  "13572171353",
);
assert.equal(
  inspectPage(
    '<title>Test</title><meta name="description" content="Description"><link rel="canonical" href="https://example.com/"><h1>Test</h1>',
    "https://example.com/",
    200,
  ).length,
  0,
);
assert.ok(
  inspectPage("", "https://example.com/", 404).some(
    (r) => r.severity === "high",
  ),
);
assert.ok(
  inspectPage(
    '<meta content="noindex" name="robots">',
    "https://example.com/",
    200,
  ).some((r) => r.code === "index"),
);
assert.deepEqual(
  unpack({
    dimensionHeaders: [{ name: "dateRange" }],
    metricHeaders: [{ name: "activeUsers" }],
    rows: [
      {
        dimensionValues: [{ value: "current" }],
        metricValues: [{ value: "0" }],
      },
    ],
  }).rows,
  [{ dateRange: "current", activeUsers: 0 }],
);
console.log(
  "PASS: range validation, exact comparisons, fixed website stream, page findings, zero-valued metrics.",
);
import { createCipheriv, randomBytes } from "node:crypto";
import { openMonitorCredentials } from "../lib/monitor-secrets";
const original = process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
const key = randomBytes(32),
  iv = randomBytes(12),
  cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from("website-monitor-v1:workspace-a"));
const sealed = Buffer.concat([
  iv,
  cipher.update(JSON.stringify({ google: { refresh_token: "fixture" } })),
  cipher.final(),
  cipher.getAuthTag(),
]).toString("base64url");
process.env.EMAIL_TOKEN_ENCRYPTION_KEY = key.toString("base64");
assert.equal(
  openMonitorCredentials(sealed, "workspace-a").google.refresh_token,
  "fixture",
);
assert.throws(() => openMonitorCredentials(sealed, "workspace-b"));
const changed = Buffer.from(sealed, "base64url");
changed[15] ^= 1;
assert.throws(() =>
  openMonitorCredentials(changed.toString("base64url"), "workspace-a"),
);
if (original === undefined) delete process.env.EMAIL_TOKEN_ENCRYPTION_KEY;
else process.env.EMAIL_TOKEN_ENCRYPTION_KEY = original;
console.log(
  "PASS: encrypted connections reject another workspace and tampered ciphertext.",
);

assert.equal(healthAccessBlocked({ pages: [{ status: 403 }] }), true);
assert.equal(
  healthAccessBlocked({ pages: [{ status: 200 }, { status: 401 }] }),
  true,
);
assert.equal(
  healthAccessBlocked({ pages: [{ status: 404 }, { status: 500 }] }),
  false,
);
assert.equal(healthAccessBlocked(null), false);
console.log(
  "PASS: saved 401/403 health responses pause collection; ordinary failures remain eligible for checks.",
);
