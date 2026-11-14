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
  const rows = [
    {
      id: "h",
      source: "pms-monitor",
      kind: "website_report",
      source_id: "health",
      body: {
        checked_at: new Date().toISOString(),
        complete: true,
        pages: [{ label: "Home", status: 200 }],
        findings: [],
      },
    },
    {
      id: "a",
      source: "pms-monitor",
      kind: "website_report",
      source_id: "analytics-7",
      body: {
        fetched_at: new Date().toISOString(),
        reports: {
          overview: {
            rows: [
              {
                dateRange: "current",
                activeUsers: 12,
                sessions: 16,
                screenPageViews: 24,
                engagementRate: 0.5,
              },
              {
                dateRange: "previous",
                activeUsers: 6,
                sessions: 8,
                screenPageViews: 12,
              },
            ],
          },
          trend: { rows: [{ date: "20260929", activeUsers: 12 }] },
          pages: {
            rows: [{ pagePath: "/", screenPageViews: 24, activeUsers: 12 }],
          },
        },
      },
    },
  ];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
  };
  (supabase as any).from = () => chain;
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "test" } },
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ configured: true }), {
      headers: { "Content-Type": "application/json" },
    });
  const { MonitorView } = await import("../components/monitor");
  const user = userEvent.setup({ document: dom.window.document });
  render(
    <MonitorView
      ctx={{ workspace: { id: "test" }, notify: () => {} } as any}
    />,
  );
  await screen.findByText("Today's briefing");
  await user.click(screen.getByRole("button", { name: "Analytics" }));
  await screen.findByText("50.0%");
  assert.equal(screen.getAllByText("+100% vs previous period").length, 3);
  await user.click(screen.getByRole("button", { name: "Show data" }));
  assert.ok(screen.getByRole("columnheader", { name: "Date" }));
  await user.click(screen.getByRole("button", { name: "Operations" }));
  await screen.findByText("No findings in the latest check");
  await user.click(screen.getByRole("button", { name: "Pages" }));
  assert.ok(screen.getByRole("columnheader", { name: "HTTP status" }));
  assert.equal(screen.queryByText("Traffic & discovery"), null);
  cleanup();
  await supabase.auth.stopAutoRefresh();
  dom.window.close();
  console.log(
    "PASS: monitor navigation, metrics, comparison, chart/data toggle, page results, focused views.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
