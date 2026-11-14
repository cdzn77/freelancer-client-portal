import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  articleURL,
  feedArticles,
  indexLabel,
  articleAdvice,
} from "../lib/chronicles-monitor";
import { ChroniclesMonitor } from "../components/chronicles-monitor";
const url = "https://example.com/chronicles/design-decisions/";
assert.equal(articleURL(url), url);
for (const bad of [
  "https://evil.example/chronicles/a/",
  "https://example.com/chronicles/",
  url + "?x=1",
  url + "#x",
  "javascript:alert(1)",
])
  assert.equal(articleURL(bad), null);
assert.throws(() => feedArticles("<html>Denied</html>"), /unavailable/);
const item = `<item><title>Design &amp; decisions</title><link>${url}</link><pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate></item>`;
assert.equal(feedArticles(`<rss>${item}${item}</rss>`).length, 1);
assert.equal(feedArticles(`<rss>${item}</rss>`)[0].title, "Design & decisions");
const article = {
  url,
  title: "Design decisions",
  publishedAt: "2026-10-05T14:00:00Z",
  inspectedAt: "2026-10-05T15:00:00Z",
  index: { verdict: "PASS" },
};
assert.equal(indexLabel(article), "Indexed");
assert.equal(
  indexLabel({ ...article, inspectionError: "Timeout" }),
  "Inspection unavailable",
);
assert.match(
  articleAdvice(article, undefined, "2026-10-02"),
  /after this reporting window/,
);
assert.match(
  articleAdvice(article, undefined, "2026-10-30"),
  /does not establish zero demand/,
);
const report = {
  pages: [
    { keys: [url], clicks: 7, impressions: 120, ctr: 7 / 120, position: 4.5 },
  ],
  windows: { current: { endDate: "2026-10-30" } },
};
const html = renderToStaticMarkup(
  <ChroniclesMonitor
    report={report}
    records={[{ kind: "chronicles", body: { articles: [article] } }]}
    busy={false}
    save={async () => true}
  />,
);
assert.ok(html.includes("5.8%"), "Exact article URL gets its search metrics");
assert.ok(html.includes(">120<"));
const missing = renderToStaticMarkup(
  <ChroniclesMonitor
    report={{ pages: [] }}
    records={[{ kind: "chronicles", body: { articles: [article] } }]}
    busy={false}
    save={async () => true}
  />,
);
assert.ok(missing.includes("Not reported"));
assert.ok(missing.includes("not measured here yet"));
console.log(
  "PASS: Chronicles URL boundaries, feed deduplication, inspection errors, reporting delay and exact article metrics.",
);
