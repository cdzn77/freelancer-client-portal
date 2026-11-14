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

  const mailboxEmails = [
    "studio@example.com",
    "receipts@example.com",
    "billing@example.com",
  ];
  let rpcCall: any = null;
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "test" } },
  });
  (supabase as any).rpc = async (name: string, args: any) => {
    rpcCall = { name, args };
    return { error: null };
  };
  globalThis.fetch = async (url) => {
    const queueStatus =
      new URL(String(url), "https://pms.test").searchParams.get("status") ||
      "Review";
    return Response.json({
      configured: true,
      mailboxes: mailboxEmails,
      accounts: [],
      items: [
        {
          id: "receipt",
          status: queueStatus,
          subject: "Your tool receipt",
          sender: "Billing",
          account_email: mailboxEmails[0],
          received_on: "2026-09-30",
          excerpt: "Amount paid USD 20.00",
          gmail_id: "abc",
          suggestion: {
            kind: "payment",
            amount: 20,
            status: "Needs verification",
            warning: "Confirm payment details",
          },
        },
      ],
    });
  };
  const { ExpenseEmailSync } = await import("../components/expense-email-sync");
  const user = userEvent.setup({ document: dom.window.document });
  let changed = 0;
  render(
    <ExpenseEmailSync
      workspace="fixture"
      plans={[]}
      onChanged={() => changed++}
    />,
  );
  await screen.findByRole("button", {
    name: "Connect studio@example.com",
  });
  for (const email of mailboxEmails)
    assert.ok(screen.getByRole("button", { name: "Connect " + email }));
  assert.equal(rpcCall, null);
  await user.click(screen.getByRole("button", { name: "Review email" }));
  assert.equal(
    (screen.getByLabelText("Amount actually paid (USD)") as HTMLInputElement)
      .value,
    "20",
  );
  assert.equal(
    (screen.getByLabelText("Payment date on receipt") as HTMLInputElement)
      .value,
    "",
  );
  assert.equal(rpcCall, null);
  await user.type(screen.getByLabelText("Vendor"), "Example tool");
  await user.type(
    screen.getByLabelText("Payment date on receipt"),
    "2026-09-30",
  );
  await user.click(screen.getByRole("button", { name: "Approve update" }));
  assert.equal((rpcCall as any).name, "review_expense_mail");
  assert.equal((rpcCall as any).args.item, "receipt");
  assert.equal((rpcCall as any).args.details.amount, "20");
  assert.equal((rpcCall as any).args.details.paid_on, "2026-09-30");
  assert.equal(changed, 1);
  await user.click(screen.getByLabelText("Email history status"));
  await user.click(
    screen.getByRole("option", { name: "Dismissed", exact: true } as any),
  );
  await user.click(await screen.findByRole("button", { name: "View email" }));
  assert.equal(screen.queryByRole("button", { name: "Approve update" }), null);
  await user.click(screen.getByRole("button", { name: "Restore to review" }));
  assert.equal((rpcCall as any).args.action, "restore");
  await user.click(screen.getByLabelText("Email history status"));
  await user.click(
    screen.getByRole("option", { name: "Recorded", exact: true } as any),
  );
  await user.click(await screen.findByRole("button", { name: "View email" }));
  assert.equal(
    screen.queryByRole("button", { name: "Restore to review" }),
    null,
  );
  assert.equal(screen.queryByRole("button", { name: "Approve update" }), null);
  cleanup();
  await supabase.auth.stopAutoRefresh();
  dom.window.close();
  console.log(
    "PASS: three mailbox connection controls, review before posting, amount/date confirmation and atomic approval call.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
