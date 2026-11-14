import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const name of [
    "FormData",
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

  const { ServiceRequestForm } =
    await import("../components/service-request-form");
  const { serviceRequestSchema } = await import("../lib/service-catalog");
  const { totals } = await import("../lib/client-documents");
  const user = userEvent.setup({ document: dom.window.document });
  const submitted: any[] = [];
  let fail = true;
  let returns = 0;
  let confirmLeave = false;
  window.confirm = () => confirmLeave;
  render(
    <ServiceRequestForm
      onReturn={() => {
        returns++;
      }}
      submit={async (x) => {
        submitted.push(x);
        if (fail) throw Error("Temporary connection problem");
      }}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Return to client portal" }),
  );
  assert.equal(returns, 1);
  const fillRequest = async () => {
    await user.click(
      screen.getByRole("button", { name: /Interactive prototypes/ }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(
      screen.getByLabelText("Your name / company *"),
      "Example Client",
    );
    await user.type(
      screen.getByLabelText("Reply email *"),
      "client@example.com",
    );
    await user.type(
      screen.getByLabelText("Give this request a name *"),
      "Prototype brief",
    );
    await user.type(
      screen.getByLabelText("Brief and goals *"),
      "Explore the checkout flow",
    );
    for (const label of [
      "Which journeys or interactions should the prototype demonstrate? *",
      "What designs or research already exist? *",
      "Who will use the prototype and what decision will it support? *",
    ])
      await user.type(screen.getByLabelText(label), "A concrete answer");
  };
  await fillRequest();
  await user.click(screen.getByRole("button", { name: /Cancel request/ }));
  assert.equal(returns, 1, "Cancel does not navigate to portal");
  assert.equal(
    (screen.getByLabelText("Give this request a name *") as HTMLInputElement)
      .value,
    "Prototype brief",
  );
  confirmLeave = true;
  await user.click(screen.getByRole("button", { name: /Cancel request/ }));
  await screen.findByText("What can we help you with?");
  assert.equal(screen.queryByLabelText("Give this request a name *"), null);
  assert.equal(
    (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    returns,
    1,
    "Confirmed cancellation returns to services, not portal",
  );
  assert.equal(submitted.length, 0);
  await fillRequest();
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await user.click(screen.getByRole("button", { name: "Send request" }));
  await screen.findByRole("alert");
  assert.equal(submitted.length, 1);
  fail = false;
  await user.click(screen.getByRole("button", { name: "Send request" }));
  await screen.findByText("Your request is in.");
  assert.equal(submitted[0].submission_id, submitted[1].submission_id);
  assert.equal(submitted[0].service, "prototype");
  assert.equal(screen.queryByRole("button", { name: /Cancel request/ }), null);
  confirmLeave = false;
  await user.click(
    screen.getByRole("button", { name: "Return to client portal" }),
  );
  assert.equal(
    returns,
    2,
    "Completed requests return without a discard prompt",
  );
  await user.click(
    screen.getByRole("button", { name: "Request another service" }),
  );
  await screen.findByText("What can we help you with?");
  cleanup();
  assert.equal(
    serviceRequestSchema.safeParse({ ...submitted[0], answers: ["", "", ""] })
      .success,
    false,
  );
  assert.equal(
    serviceRequestSchema.safeParse({ ...submitted[0], service: "invented" })
      .success,
    false,
  );
  assert.deepEqual(
    totals({
      items: [{ description: "Design", quantity: 1, unit_cents: 10001 }],
      tax_rate: 0,
    } as any),
    { subtotal: 10001, tax: 0, total: 10001, deposit: 5001 },
  );
  assert.equal(
    totals({
      items: [{ description: "Taxed", quantity: 2, unit_cents: 10000 }],
      tax_rate: 6,
    } as any).total,
    21200,
  );
  console.log(
    "PASS: adaptive service questions, review, failure recovery, idempotent retry, repeat request, validation and exact deposit/tax calculations",
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
