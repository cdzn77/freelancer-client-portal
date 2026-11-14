import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "FormData",
    "HTMLSelectElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "DocumentFragment",
    "MutationObserver",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "FocusEvent",
    "getComputedStyle",
  ])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as any)[name],
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.Element.prototype.hasPointerCapture = function () {
    return false;
  };
  dom.window.Element.prototype.setPointerCapture = function () {};
  dom.window.Element.prototype.releasePointerCapture = function () {};
  const React = await import("react");
  const { render, screen, cleanup } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:8000";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "local-test";
  const { supabase } = await import("../lib/supabase");

  const calls: any[] = [];
  let records: any[] = [
    {
      id: "target",
      kind: "keyword",
      source_id: "brand design",
      title: "brand design",
      body: {
        page: "/info/",
        intent: "research",
        priority: "2",
        source: "Manual",
        next: "Write a case study",
      },
    },
  ];
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "test" } },
  });
  globalThis.fetch = async (_url: any, init: any) => {
    if (init?.method === "POST") {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ updated: true }));
    }
    return new Response(JSON.stringify({ records }));
  };
  const { SearchIntelligence } =
    await import("../components/search-intelligence");
  const ctx: any = {
    workspace: { id: "00000000-0000-0000-0000-000000000001" },
    data: { projects: [] },
    notify: () => {},
    refresh: async () => {},
  };
  const user = userEvent.setup();
  render(<SearchIntelligence ctx={ctx} />);
  await screen.findByText(/No search report yet/);
  await user.click(screen.getByRole("button", { name: "Keywords" }));
  await user.click(await screen.findByRole("button", { name: "brand design" }));
  assert.equal(
    (screen.getByLabelText("Target page") as HTMLInputElement).value,
    "/info/",
    "Editing retains saved target path",
  );
  assert.equal(
    (screen.getByLabelText("Intent") as HTMLSelectElement).value,
    "research",
  );
  await user.click(screen.getByRole("button", { name: "Save target" }));
  await screen.findByRole("button", { name: "Save target" });
  assert.equal(calls[0].query, "brand design");
  assert.equal(calls[0].page, "/info/");
  await user.type(screen.getByLabelText("Search seed"), "brand studio");
  await user.click(screen.getByRole("button", { name: "Find suggestions" }));
  assert.equal(calls[1].action, "discover");
  assert.equal(calls[1].seed, "brand studio");
  await user.click(screen.getByRole("button", { name: "AI visibility" }));
  await user.selectOptions(screen.getByLabelText("Engine"), "Kimi");
  assert.equal(
    (screen.getByLabelText("Engine") as HTMLSelectElement).value,
    "Kimi",
  );
  assert.ok(
    screen.getAllByText("Not measured").length > 0,
    "Missing AI answers never become a zero visibility score",
  );
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await user.type(
    screen.getByLabelText("Change title"),
    "Updated homepage title",
  );
  await user.click(
    screen.getByRole("button", { name: "Record change and baseline" }),
  );
  assert.equal(calls[2].action, "change");
  cleanup();
  records = [
    {
      id: "report",
      kind: "search_report",
      body: {
        windows: {
          current: { startDate: "2026-09-04", endDate: "2026-10-01" },
        },
        fetched_at: "2026-10-04T12:00:00Z",
        trend: [],
        pages: [],
        queries: [
          {
            keys: ["design studio"],
            clicks: 1,
            impressions: 8,
            ctr: 0.125,
            position: 5.5,
          },
        ],
        totals: {
          current: { clicks: 3, impressions: 105, ctr: 3 / 105, position: 8.8 },
          previous: {
            clicks: 1,
            impressions: 114,
            ctr: 1 / 114,
            position: 12.7,
          },
          year: { clicks: 0, impressions: 0, ctr: null, position: null },
        },
      },
    },
  ];
  render(<SearchIntelligence ctx={ctx} />);
  await screen.findByText("Where things stand");
  await user.click(await screen.findByRole("button", { name: "Save action" }));
  await screen.findByText("Saved actions");
  const review = calls.at(-1);
  assert.equal(review.action, "suggestion");
  assert.equal(review.key, "review:query:design studio");
  assert.ok(review.evidence.includes("8 impressions"));
  assert.ok(review.evidence.includes("Small sample"));
  assert.ok(review.evidence.includes("2026-09-04"));
  assert.equal(review.state, "Open");
  cleanup();
  console.log(
    "PASS: empty states, keyword edits, Autocomplete requests, Kimi selection and change capture.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
