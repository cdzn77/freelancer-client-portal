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
    "NodeFilter",
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
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
  (window as any).matchMedia = () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const { supabase } = await import("../lib/supabase");
  const year = new Date().getFullYear();
  const rows = Array.from({ length: 13 }, (_, i) => ({
    id: `payment-${i}`,
    workspace_id: "fixture",
    name: `Expense ${i + 1}`,
    vendor: "Vendor",
    category: "AI services",
    amount: 10,
    frequency: "Monthly",
    paid_on: `${year}-01-02`,
    archived_at: null,
    deleted_at: null,
    notes: "",
  }));
  const subscriptions = [
    {
      id: "active",
      name: "Active tracked plan",
      status: "Active",
      amount: 20,
      starts_on: null,
    },
    {
      id: "unknown",
      name: "Unknown price plan",
      status: "Needs verification",
      amount: null,
      starts_on: null,
    },
    {
      id: "canceled",
      name: "Canceled plan",
      status: "Canceled",
      amount: 30,
      starts_on: `${year}-01-01`,
    },
  ].map((p) => ({
    ...p,
    workspace_id: "fixture",
    vendor: "Vendor",
    category: "AI services",
    frequency: "Monthly",
    include_in_forecast: false,
    next_renewal_on: null,
    ends_on: null,
    notes: "",
    archived_at: null,
    deleted_at: null,
  }));
  (supabase as any).from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      range: async () => ({
        data: table === "studio_cost_payments" ? rows : subscriptions,
        error: null,
      }),
    };
    return chain;
  };
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "test" } },
  });
  let exported: any = null;
  globalThis.fetch = async (_url, init) => {
    exported = JSON.parse(String(init?.body));
    return new Response("%PDF-test", {
      headers: { "Content-Type": "application/pdf" },
    });
  };
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  const { StudioExpenses } = await import("../components/studio-expenses");
  const user = userEvent.setup({ document: dom.window.document });
  render(
    <StudioExpenses
      ctx={{ workspace: { id: "fixture" }, notify: () => {} } as any}
    />,
  );
  await screen.findByText("1–6 of 13");
  assert.equal(
    screen.queryByRole("button", { name: "Expense 7" } as any),
    null,
  );
  await user.click(
    screen.getByRole("button", { name: "Select all 13 matching" }),
  );
  await user.click(screen.getByRole("button", { name: "Export selected PDF" }));
  assert.equal(exported.ids.length, 13);
  assert.equal(exported.from, `${year}-01-01`);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("7–12 of 13");
  await user.click(
    screen.getByRole("button", { name: "Record payment" } as any),
  );
  assert.ok(screen.getByLabelText("Amount paid (USD)"));
  assert.ok(screen.getByLabelText("Receipt reference or link"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(
    screen.getByRole("button", { name: "Subscriptions" } as any),
  );
  assert.ok(screen.getByText("0 selected"));
  assert.ok(screen.getByRole("button", { name: "Active tracked plan" }));
  assert.equal(screen.queryByRole("button", { name: "Canceled plan" }), null);
  assert.ok(screen.getByText("$0.00"));
  assert.equal(screen.getAllByText("$130.00").length, 2);
  await user.click(
    screen.getByRole("button", { name: "Needs verification (1)" }),
  );
  assert.ok(screen.getByRole("button", { name: "Unknown price plan" }));
  await user.click(screen.getByRole("button", { name: "Unknown price plan" }));
  const amount = screen.getByLabelText(
    "Amount per charge (USD)",
  ) as HTMLInputElement;
  assert.equal(amount.value, "");
  assert.equal(amount.required, false);
  assert.equal(
    (screen.getByLabelText("Include in forecast") as HTMLInputElement).checked,
    false,
  );
  assert.equal(
    (
      screen.getByLabelText(
        "First charge date (optional unless forecasting)",
      ) as HTMLInputElement
    ).value,
    "",
  );
  cleanup();
  await supabase.auth.stopAutoRefresh();
  dom.window.close();
  console.log(
    "PASS: six-card mobile pagination, select-all across pages, export selection, payment form and view selection reset.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
