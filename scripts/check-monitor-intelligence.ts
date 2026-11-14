import { parseClaudeEvidence } from "../lib/monitor-ai-evidence";
import assert from "node:assert/strict";
import { fullMonitorReport } from "../lib/monitor-report";
import {
  activeAction,
  advisor,
  exactPage,
  summarizeAI,
  changeStage,
  keywordStatus,
} from "../lib/monitor-intelligence";
import {
  safeCrawlURL,
  crawlPage,
  crawlDrift,
  robotsAllows,
} from "../lib/monitor-crawl";
assert.equal(
  activeAction({ state: "Snoozed", snoozed_until: "2099-01-01" }),
  false,
);
assert.equal(
  activeAction({ state: "Snoozed", snoozed_until: "2000-01-01" }),
  true,
);
assert.equal(activeAction({ state: "Resolved" }), false);
const page = {
  keys: ["https://example.com/info/"],
  clicks: 1,
  impressions: 20,
  ctr: 0.05,
  position: 5,
};
assert.equal(exactPage({ pages: [page] }, "/info/"), page);
assert.equal(
  exactPage({ pages: [page] }, "/info"),
  undefined,
  "Do not merge distinct URL evidence",
);
assert.equal(keywordStatus(undefined, "buyer"), "Not measured");
assert.equal(keywordStatus(page, "buyer"), "Within reach");
const run = {
  answers: [
    {
      engine: "Codex",
      status: "success",
      answer: "Example Studio and Another Studio.",
      citations: [
        "https://example.com/info/",
        "https://www.example.com/",
      ],
    },
    { engine: "Codex", status: "failed", error: "Unavailable" },
    {
      engine: "Codex",
      status: "success",
      answer: "Another Studio.",
      citations: ["https://example.com.evil.example/"],
    },
  ],
};
const ai = summarizeAI(run, [{ name: "Another Studio", aliases: [] }]);
assert.equal(ai.successful, 2);
assert.equal(ai.failed, 1);
assert.equal(ai.brandCoverage, 0.5);
assert.equal(ai.domainCoverage, 0.5);
assert.equal(ai.share, 1 / 3);
assert.equal(
  ai.domains.find((d) => d.domain === "example.com")?.answers,
  1,
);
assert.equal(summarizeAI({ answers: [] }).brandCoverage, null);
assert.equal(
  summarizeAI(run).share,
  null,
  "No competitor set means unmeasured share",
);
assert.equal(safeCrawlURL("https://other.example/"), null);
assert.equal(safeCrawlURL("https://example.com@evil.example/"), null);
assert.equal(safeCrawlURL("/?redirect=evil"), null);
const before = crawlPage("<title>A</title>", "https://example.com/", 200);
const after = crawlPage("<title>B</title>", "https://example.com/", 200);
assert.equal(crawlDrift([before], [after])[0].field, "title");
assert.equal(
  crawlDrift([before], [{ ...after, status: 403 }]).length,
  0,
  "Access errors are not content changes",
);
const record = {
  shipped_at: "2026-09-01",
  baseline: {
    windows: { current: { startDate: "2026-08-01", endDate: "2026-08-28" } },
  },
  status: "Verified",
  verification: "",
};
assert.equal(
  changeStage(record, {
    windows: { current: { startDate: "2026-09-05", endDate: "2026-10-02" } },
  }),
  "Comparable window",
);
const recommendations = advisor(
  { queries: [], pages: [page] },
  {
    checked_at: "2026-10-04",
    findings: [
      {
        code: "http",
        title: "Failed request",
        url: "/info/",
        severity: "high",
      },
    ],
  },
  null,
);
assert.equal(recommendations[0].priority, "1");
assert.ok(recommendations.some((r) => r.confidence === "Small sample"));

assert.ok(
  !fullMonitorReport(
    [{ kind: "suggestion", title: "<script>alert(1)</script>", body: {} }],
    {},
  ).includes("<script>"),
  "Source content cannot execute in export",
);

assert.equal(robotsAllows("/private", ["/private$"]), false);
assert.equal(robotsAllows("/private-more", ["/private$"]), true);
assert.equal(robotsAllows("/a/secret", ["/*/secret"]), false);

assert.equal(
  crawlPage(
    '<link href="https://example.com/info/" rel="canonical">',
    "https://example.com/info/",
    200,
  ).canonical,
  "https://example.com/info/",
);
console.log(
  "PASS: action lifecycle, exact page baselines, keyword grouping, AI denominators and domain isolation, crawl boundaries and drift.",
);

const claudeEvents = [
  { message: { content: [{ type: "tool_use", id: "s1", name: "WebSearch" }] } },
  {
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "s1",
          content: "https://example.com/source",
        },
      ],
    },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: {
      answer: "A researched answer with a source.",
      citations: ["https://example.com/source", "javascript:alert(1)"],
    },
  },
];
assert.deepEqual(parseClaudeEvidence(claudeEvents).citations, [
  "https://example.com/source",
]);
assert.throws(() => parseClaudeEvidence(claudeEvents.slice(2)), /unavailable/);
assert.throws(
  () =>
    parseClaudeEvidence([
      ...claudeEvents.slice(0, 2),
      { ...claudeEvents[2], is_error: true },
    ]),
  /unavailable/,
);
console.log(
  "PASS: Claude evidence requires successful grounded tool results and rejects invalid citation protocols.",
);
