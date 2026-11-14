export function parseGitHubLink(raw: string) {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/([1-9][0-9]*)\/?$/.exec(
      raw.trim(),
    );
  if (
    !match ||
    match[1] === "." ||
    match[1] === ".." ||
    match[2] === "." ||
    match[2] === ".."
  )
    throw Error("Use a GitHub issue or pull request URL");
  return {
    repo: `${match[1]}/${match[2]}`,
    kind: match[3],
    number: match[4],
    url: raw.trim().replace(/\/$/, ""),
  };
}
export async function readGitHubLink(raw: string, token?: string) {
  const link = parseGitHubLink(raw);
  async function get(path: string) {
    const r = await fetch(`https://api.github.com/repos/${link.repo}/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!r.ok)
      throw Error(
        r.status === 404
          ? "Repository item unavailable. Private repositories require an administrator-configured connection."
          : r.status === 403 || r.status === 429
            ? "GitHub access or rate limit prevented refresh. Try later."
            : "GitHub could not refresh this item",
      );
    return r.json();
  }
  const item = await get(
    `${link.kind === "pull" ? "pulls" : "issues"}/${link.number}`,
  );
  const result: Record<string, unknown> = {
    title: String(item.title || "").slice(0, 500),
    state: item.merged_at ? "merged" : item.state,
    draft: !!item.draft,
  };
  if (link.kind === "pull") {
    const sha = String(item.head?.sha || "");
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("Invalid GitHub commit");
    const results = await Promise.allSettled([
      get(`commits/${sha}/check-runs?per_page=100`),
      get(`pulls/${link.number}/reviews?per_page=100`),
    ]);
    if (results[0].status === "fulfilled") {
      const checks = results[0].value;
      result.checks = (checks.check_runs || []).map(
        (c: { name: string; status: string; conclusion: string }) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
        }),
      );
      result.checks_truncated = checks.total_count > 100;
    } else result.checks_unavailable = true;
    if (results[1].status === "fulfilled") {
      const reviews = results[1].value as {
        user?: { login: string };
        state: string;
      }[];
      const latest = new Map<string, string>();
      for (const r of reviews)
        if (r.user && r.state !== "COMMENTED")
          latest.set(r.user.login, r.state);
      result.reviews = [...latest].map(([reviewer, state]) => ({
        reviewer,
        state,
      }));
      result.reviews_truncated = reviews.length === 100;
    } else result.reviews_unavailable = true;
  }
  return result;
}
