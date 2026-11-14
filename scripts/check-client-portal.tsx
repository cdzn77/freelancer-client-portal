import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { emptyData } from "../lib/types";
async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/?clientView=Project&clientProject=a&clientSection=Files",
  });
  for (const k of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Node",
    "MutationObserver",
    "getComputedStyle",
    "HTMLTextAreaElement",
    "FormData",
    "Element",
    "Event",
  ])
    Object.defineProperty(globalThis, k, {
      value: (dom.window as any)[k],
      configurable: true,
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import("react");
  const { render, fireEvent, cleanup, waitFor } =
    await import("@testing-library/react");
  const { PortalView } = await import("../components/client-portal");
  const { supabase } = await import("../lib/supabase");
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "test" } },
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ documents: [], payments: [] }), {
      status: 200,
    });
  let decision: any;
  (supabase as any).rpc = async (name: string, args: any) => {
    decision = { name, args };
    return { error: null };
  };
  const project = (id: string, name: string, tools: string[]) => ({
    id,
    name,
    client_tools: tools,
    status: "In progress",
    workspace_id: "w",
    shared_brief: `${name} shared brief`,
    description: "",
    due_date: "2026-11-01",
    archived_at: null,
    deleted_at: null,
  });
  const ctx: any = {
    workspace: { id: "w", role: "client" },
    userId: "client",
    data: {
      ...emptyData,
      projects: [
        project("a", "Brand identity", [
          "files",
          "brief",
          "approvals",
          "tasks",
        ]),
        project("b", "Website", ["brief"]),
      ],
      tasks: [
        {
          id: "shared",
          project_id: "a",
          title: "Client-visible concept",
          status: "In progress",
          is_published: true,
        },
        {
          id: "internal",
          project_id: "a",
          title: "Private team task",
          status: "Done",
          is_published: false,
        },
      ],
      approvals: [
        {
          id: "approval",
          project_id: "a",
          label: "Confirm creative direction",
          status: "Pending",
          is_published: true,
        },
      ],
    },
    notify: () => {},
    refresh: async () => {},
  };
  const { documentActions } = await import("../components/client-attention");
  const sampleDoc: any = {
    id: "doc",
    title: "Identity agreement",
    kind: "Contract",
    status: "Approved",
    deposit_cents: 50000,
  };
  assert.equal(
    documentActions([sampleDoc], [])[0].detail,
    "$500.00 remaining toward your 50% deposit",
  );
  assert.equal(
    documentActions(
      [sampleDoc],
      [{ document_id: "doc", amount_cents: 50000, refunded_cents: 0 }],
    ).length,
    0,
  );
  assert.equal(
    documentActions([{ ...sampleDoc, status: "Draft" }], []).length,
    0,
  );
  assert.equal(
    documentActions([{ ...sampleDoc, status: "Shared" }], [])[0].action,
    "Review document",
  );
  assert.equal(
    documentActions(
      [sampleDoc],
      [{ document_id: "doc", amount_cents: 50000, refunded_cents: 10000 }],
    )[0].detail,
    "$100.00 remaining toward your 50% deposit",
  );
  assert.equal(
    documentActions(
      [sampleDoc],
      [],
      [{ document_id: "doc", paid_cents: 50000, unverified_paid: false }],
    ).length,
    0,
    "Reconciled legacy receipts satisfy the deposit on Home",
  );
  assert.equal(
    documentActions(
      [sampleDoc],
      [],
      [{ document_id: "doc", paid_cents: 0, unverified_paid: true }],
    )[0].detail,
    "Payment status needs studio verification",
  );
  const { csvCell } = await import("../lib/csv");
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(
    csvCell(' \t=HYPERLINK("https://example.invalid")'),
    '"\' \t=HYPERLINK(""https://example.invalid"")"',
  );
  assert.equal(csvCell('Review, "A"'), '"Review, ""A"""');
  let requested = "",
    page = "";
  const props = {
    ctx,
    onRequest: (id: string) => (requested = id),
    onNavigate: (p: string) => (page = p),
  };
  dom.window.confirm = () => true;
  let view = render(<PortalView {...props} />);
  assert.equal(
    view.getByRole("button", { name: "Files" }).getAttribute("aria-current"),
    "page",
  );
  fireEvent.change(view.getByRole("combobox", { name: "Switch project" }), {
    target: { value: "b" },
  });
  assert.equal(view.queryByRole("button", { name: "Files" }), null);
  assert.ok(view.getByText("Website shared brief"));
  fireEvent.click(view.getByRole("button", { name: "Request a service" }));
  assert.equal(requested, "b");
  fireEvent.change(view.getByRole("combobox", { name: "Switch project" }), {
    target: { value: "a" },
  });
  fireEvent.click(view.getByRole("button", { name: "Timeline" }));
  assert.equal(view.queryByText("Private team task"), null);
  fireEvent.click(view.getByRole("button", { name: "Review work" }));
  fireEvent.click(view.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    assert.deepEqual(decision, {
      name: "decide_approval",
      args: { approval_id: "approval", decision: "Approved" },
    }),
  );
  cleanup();
  view = render(<PortalView {...props} />);
  assert.equal(
    view
      .getByRole("button", { name: "Review work" })
      .getAttribute("aria-current"),
    "page",
  );
  fireEvent.click(view.getByRole("button", { name: "All projects" }));
  assert.equal(view.getAllByRole("button", { name: "Open project" }).length, 2);
  cleanup();
  dom.window.history.replaceState(null, "", "/?clientView=Home");
  view = render(<PortalView {...props} />);
  fireEvent.click(view.getByRole("button", { name: "Open documents" }));
  assert.equal(page, "Documents & payments");
  await waitFor(() => assert.ok(view.getByText("Confirm creative direction")));
  cleanup();
  view = render(<PortalView {...props} ctx={{ ...ctx, data: emptyData }} />);
  fireEvent.click(view.getByRole("button", { name: "View your projects" }));
  assert.ok(view.getByText("Your next project starts here"));
  cleanup();
  dom.window.close();
  console.log(
    "PASS: project and section restoration, cross-project isolation, enabled-tool gating, mobile picker, service/document navigation, approvals, and empty state.",
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
