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
  const { supabase } = await import("../lib/supabase");

  const { AddWorkspaceMember } =
    await import("../components/add-workspace-member");
  const { PasswordReset } = await import("../components/password-reset");
  const user = userEvent.setup({ document: dom.window.document });
  let payload: any;
  let updates: any[] = [];
  (supabase.auth as any).getSession = async () => ({
    data: { session: { access_token: "fixture" } },
  });
  (supabase.auth.mfa as any).getAuthenticatorAssuranceLevel = async () => ({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  (supabase.auth as any).updateUser = async (value: any) => {
    updates.push(value);
    return { error: null };
  };
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ created: true });
  };
  const ctx: any = {
    workspace: { id: "workspace", role: "owner" },
    data: { projects: [] },
    refresh: async () => {},
    notify: () => {},
  };
  render(<AddWorkspaceMember ctx={ctx} onRefresh={async () => {}} />);
  await user.type(screen.getByLabelText("Full name"), "Alex Client");
  await user.type(screen.getByLabelText("Email address"), "alex@example.test");
  await user.click(screen.getByRole("button", { name: "Generate password" }));
  const pw = (screen.getByLabelText("Initial password") as HTMLInputElement)
    .value;
  assert.ok(pw.length >= 16);
  await user.click(
    screen.getByRole("button", { name: "Create account & add member" }),
  );
  await screen.findByRole("button", { name: "Copy invitation" });
  assert.equal(payload.password, pw);
  assert.equal(payload.mode, "create");
  assert.equal(payload.email, "alex@example.test");
  assert.ok(screen.getByText(/No email has been sent/));
  assert.equal(
    (screen.getByLabelText("Initial password") as HTMLInputElement).value,
    "",
  );
  cleanup();
  render(
    <AddWorkspaceMember
      ctx={{ ...ctx, workspace: { id: "workspace", role: "client" } }}
      onRefresh={async () => {}}
    />,
  );
  assert.equal(
    screen.queryByRole("button", { name: "Create account & add member" }),
    null,
  );
  cleanup();
  let done = 0;
  render(<PasswordReset initialAccount onDone={() => done++} />);
  assert.equal(
    screen.queryByRole("button", { name: "Keep my initial password" }),
    null,
  );
  assert.ok(await screen.findByRole("button", { name: "Sign out" }));
  cleanup();
  render(<PasswordReset initialAccount onDone={() => done++} />);
  await user.type(
    await screen.findByLabelText("New password", { exact: true }),
    "Updated-fixture-2026!",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "Updated-fixture-2026!",
  );
  await user.click(screen.getByRole("button", { name: "Save new password" }));
  await screen.findByRole("heading", { name: "Your password is saved." });
  assert.deepEqual(updates.pop(), {
    password: "Updated-fixture-2026!",
    data: { pms_password_choice: false },
  });
  cleanup();
  dom.window.close();
  console.log(
    "PASS: admin account form, generated password, sign-in handoff, client exclusion, required first-login password change.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
