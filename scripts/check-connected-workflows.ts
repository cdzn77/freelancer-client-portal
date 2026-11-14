import assert from "node:assert/strict";
import { emptyData, type Data, type Task } from "../lib/types";
import { bookingInsight } from "../lib/schedule-insights";
import { parseGitHubLink, readGitHubLink } from "../lib/github-links";
async function main() {
  const data: Data = {
    ...emptyData,
    team_capacity: [
      { user_id: "person", daily_minutes: 480, weekdays: [1, 2, 3, 4, 5] },
    ],
    tasks: [{ id: "task", status: "To do" } as Task],
    resource_bookings: [
      {
        id: "booking",
        project_id: "project",
        user_id: "person",
        starts_on: "2026-10-14",
        ends_on: "2026-10-14",
        daily_minutes: 240,
        tentative: false,
        note: "",
      },
    ],
    task_allocations: [
      {
        id: "a",
        task_id: "task",
        project_id: "project",
        user_id: "person",
        work_date: "2026-10-14",
        minutes: 120,
      },
    ],
  };
  assert.equal(
    bookingInsight("person", "2026-10-14", "2026-10-14", data).confirmed,
    240,
    "Task effort must not double count project envelope",
  );
  data.task_allocations[0].minutes = 300;
  assert.equal(
    bookingInsight("person", "2026-10-14", "2026-10-14", data).confirmed,
    300,
    "Excess task effort expands demand",
  );
  data.team_time_off = [
    {
      id: "leave",
      user_id: "person",
      starts_on: "2026-10-14",
      ends_on: "2026-10-14",
    },
  ];
  assert.equal(
    bookingInsight("person", "2026-10-14", "2026-10-14", data).conflicts[0]
      .over,
    300,
    "Leave preserves visible booking conflicts",
  );
  data.team_capacity = [];
  data.team_time_off = [];
  assert.equal(
    bookingInsight("person", "2026-10-14", "2026-10-14", data).available,
    null,
    "Unknown hours must not become zero",
  );
  assert.equal(
    parseGitHubLink("https://github.com/team/project/pull/42").repo,
    "team/project",
  );
  for (const url of [
    "http://github.com/team/repo/pull/1",
    "https://github.com.evil.test/a/b/pull/1",
    "https://github.com/../repo/issues/1",
    "https://github.com/team/repo/pull/1?token=x",
    "https://localhost/issues/1",
  ])
    assert.throws(() => parseGitHubLink(url));
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    paths.push(url);
    if (url.includes("check-runs"))
      return Response.json({
        total_count: 1,
        check_runs: [
          { name: "Build", status: "completed", conclusion: "failure" },
        ],
      });
    if (url.includes("/reviews"))
      return Response.json([
        { user: { login: "reviewer" }, state: "CHANGES_REQUESTED" },
        { user: { login: "reviewer" }, state: "APPROVED" },
      ]);
    return Response.json({
      title: "Fix",
      state: "closed",
      merged_at: "2026-10-14",
      head: { sha: "a".repeat(40) },
    });
  };
  const code = await readGitHubLink("https://github.com/team/project/pull/42");
  assert.equal(code.state, "merged");
  assert.deepEqual(code.reviews, [{ reviewer: "reviewer", state: "APPROVED" }]);
  assert.equal(
    (code.checks as { conclusion: string }[])[0].conclusion,
    "failure",
  );
  assert(
    paths.every((p) =>
      p.startsWith("https://api.github.com/repos/team/project/"),
    ),
  );
  globalThis.fetch = original;
  console.log("Connected allocation and GitHub behavior checks passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
