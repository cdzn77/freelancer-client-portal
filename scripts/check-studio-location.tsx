import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readStudioLocation, locationUrl } from "../lib/studio-location";
async function main() {
  const route = readStudioLocation(
    "?workspace=w&page=Projects&project=p&section=Files",
    "owner",
  );
  assert.deepEqual(route, {
    workspace: "w",
    page: "Projects",
    project: "p",
    section: "Files",
  });
  assert.equal(
    readStudioLocation("?page=Financials", "client").page,
    "Client portal",
  );
  assert.equal(readStudioLocation("?page=Settings", "member").page, "Overview");
  assert.equal(
    readStudioLocation("?page=Projects&section=Invalid", "owner").section,
    "Tasks",
  );
  assert.equal(
    locationUrl("http://localhost/?finance=Estimates", route).searchParams.get(
      "finance",
    ),
    "Estimates",
  );
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/?workspace=w&page=Projects&project=p&section=Files",
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "getComputedStyle",
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: (dom.window as any)[key],
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const React = await import("react");
  const { render, renderHook, cleanup, waitFor, fireEvent, act } =
    await import("@testing-library/react");
  const { supabase } = await import("../lib/supabase");
  const project = {
    id: "p",
    workspace_id: "w",
    name: "Resume project",
    type: "fixed_fee",
    access_type: "invite_only",
    client_tools: [],
    shape_id: 0,
    color: "#171717",
    start_date: "2026-09-01",
    due_date: "2026-10-30",
    client_name: "Sample client",
    status: "In progress",
    description: "",
    shared_brief: "",
    brief: "",
    archived_at: null,
    deleted_at: null,
  };
  (supabase as any).from = (table: string) => {
    let select = "";
    const q: any = {
      select: (s: string) => {
        select = s;
        return q;
      },
      eq: () => q,
      order: () => q,
      range: () => q,
      then: (resolve: any) =>
        Promise.resolve({
          error: null,
          data:
            table === "workspace_members"
              ? select.includes("workspaces")
                ? [
                    {
                      workspace_id: "w",
                      role: "owner",
                      workspaces: {
                        id: "w",
                        name: "Sample",
                        workflow_states: ["To do", "In progress", "Done"],
                        role: "owner",
                      },
                    },
                  ]
                : [
                    {
                      workspace_id: "w",
                      user_id: "u",
                      role: "owner",
                      display_name: "Sample User",
                    },
                  ]
              : table === "projects"
                ? [project]
                : [],
        }).then(resolve),
    };
    return q;
  };
  (supabase.storage as any).from = () => ({
    createSignedUrls: async () => ({ data: [], error: null }),
  });
  const { Studio } = await import("../components/studio");
  const session: any = {
    user: { id: "u", email: "sample@example.test", user_metadata: {} },
  };
  let v = render(<Studio session={session} />);
  await waitFor(() =>
    assert.equal(
      v.getByRole("button", { name: "Files" }).getAttribute("aria-pressed"),
      "true",
    ),
  );
  assert.equal(new URL(window.location.href).searchParams.get("project"), "p");
  fireEvent.click(v.getByRole("button", { name: "Brief" }));
  await waitFor(() =>
    assert.equal(
      new URL(window.location.href).searchParams.get("section"),
      "Brief",
    ),
  );
  cleanup();
  v = render(<Studio session={session} />);
  await waitFor(() =>
    assert.equal(
      v.getByRole("button", { name: "Brief" }).getAttribute("aria-pressed"),
      "true",
    ),
  );
  await act(async () => {
    window.history.replaceState(
      {},
      "",
      "/?workspace=w&page=Projects&project=p&section=Files",
    );
    window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
  });
  await waitFor(() =>
    assert.equal(
      v.getByRole("button", { name: "Files" }).getAttribute("aria-pressed"),
      "true",
    ),
  );
  cleanup();
  window.history.replaceState(
    {},
    "",
    "/?workspace=w&page=Projects&project=missing&section=Files",
  );
  v = render(<Studio session={session} />);
  await waitFor(() =>
    assert.equal(
      new URL(window.location.href).searchParams.has("project"),
      false,
    ),
  );
  cleanup();
  const { useLocationTab } = await import("../lib/use-location-tab");
  window.history.replaceState({}, "", "/?page=Financials&finance=Estimates");
  let tab = renderHook(() =>
    useLocationTab("finance", "Invoices", ["Invoices", "Estimates"]),
  );
  assert.equal(tab.result.current[0], "Estimates");
  act(() => tab.result.current[1]("Invoices"));
  assert.equal(
    new URL(window.location.href).searchParams.get("finance"),
    "Invoices",
  );
  tab.unmount();
  tab = renderHook(() =>
    useLocationTab("finance", "Invoices", ["Invoices", "Estimates"]),
  );
  assert.equal(tab.result.current[0], "Invoices");
  act(() => {
    window.history.replaceState({}, "", "/?page=Financials&finance=Estimates");
    window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
  });
  assert.equal(tab.result.current[0], "Estimates");
  cleanup();
  dom.window.close();
  console.log(
    "PASS: project/tab restoration through remount, tab URL updates, history restoration, role allowlist, missing-project fallback.",
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
