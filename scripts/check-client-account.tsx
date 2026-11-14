import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
async function main() {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "https://example.test/",
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
    "HTMLTextAreaElement",
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
  (globalThis as any).requestAnimationFrame = (f: any) => setTimeout(f, 0);
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const React = await import("react");
  const { render, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  const { supabase } = await import("../lib/supabase");
  const { AccountView } = await import("../components/account");
  const { PasswordReset } = await import("../components/password-reset");
  const { MentionInput } = await import("../components/mention-input");
  let reauth = 0,
    updates: any[] = [],
    reset: any = null;
  (supabase.auth.mfa as any).getAuthenticatorAssuranceLevel = async () => ({
    data: { currentAuthenticationMethods: [] },
    error: null,
  });
  (supabase.auth as any).signInWithPassword = async () => {
    reauth++;
    return { error: null };
  };
  (supabase.auth as any).updateUser = async (data: any) => {
    updates.push(data);
    return { error: null };
  };
  (supabase.auth as any).resetPasswordForEmail = async (
    email: string,
    options: any,
  ) => {
    reset = { email, options };
    return { error: null };
  };
  const session: any = {
    access_token: "fixture",
    user: {
      id: "fixture",
      email: "client@example.test",
      user_metadata: { full_name: "Test Client" },
    },
  };
  const view = render(
    <AccountView session={session} onSaved={async () => {}} />,
  );
  const current = view.getByLabelText("Current password", {
    selector: "input[name=current_password]",
  });
  fireEvent.change(current, { target: { value: "old-fixture-password" } });
  fireEvent.change(view.getByLabelText("New password"), {
    target: { value: "new-fixture-password" },
  });
  fireEvent.change(view.getByLabelText("Confirm new password"), {
    target: { value: "mismatched-fixture" },
  });
  fireEvent.submit(
    view.getByRole("button", { name: "Update password" }).closest("form")!,
  );
  await waitFor(() =>
    assert.ok(view.getByText("The new passwords do not match.")),
  );
  assert.equal(updates.length, 0);
  fireEvent.change(view.getByLabelText("Confirm new password"), {
    target: { value: "new-fixture-password" },
  });
  fireEvent.submit(
    view.getByRole("button", { name: "Update password" }).closest("form")!,
  );
  await waitFor(() => assert.ok(view.getByText("Your password is updated.")));
  assert.equal(reauth, 1);
  assert.equal(updates.length, 1);
  fireEvent.click(
    view.getByRole("button", {
      name: "Forgot your current password? Send a reset link",
    }),
  );
  await waitFor(() => assert.ok(reset));
  assert.equal(reset.email, session.user.email);
  assert.equal(reset.options.redirectTo, "https://example.test/");
  cleanup();
  let done = 0;
  const recovery = render(<PasswordReset onDone={() => done++} />);
  fireEvent.change(recovery.getByLabelText("New password"), {
    target: { value: "recovery-fixture-password" },
  });
  fireEvent.change(recovery.getByLabelText("Confirm new password"), {
    target: { value: "recovery-fixture-password" },
  });
  fireEvent.submit(
    recovery
      .getByRole("button", { name: "Save new password" })
      .closest("form")!,
  );
  await waitFor(() => assert.ok(recovery.getByText("Your password is saved.")));
  assert.equal(reauth, 1);
  fireEvent.click(
    recovery.getByRole("button", { name: "Continue to workspace" }),
  );
  assert.equal(done, 1);
  cleanup();
  let tagged = "";
  const mention = render(
    <MentionInput
      aria-label="Feedback"
      people={[
        { user_id: "allowed", display_name: "Alex Client", role: "client" },
      ]}
      onMention={(id) => (tagged = id)}
    />,
  );
  fireEvent.change(mention.getByLabelText("Feedback"), {
    target: { value: "Hello @Al", selectionStart: 9 },
  });
  fireEvent.click(mention.getByRole("button", { name: /Alex Client/ }));
  assert.equal(tagged, "allowed");
  assert.ok(
    (mention.getByLabelText("Feedback") as HTMLTextAreaElement).value.includes(
      "@Alex Client",
    ),
  );
  cleanup();
  console.log(
    "PASS: password mismatch blocks write, current-password reauthentication, password update, reset redirect, recovery completion, permitted participant tagging. No live account calls.",
  );
  dom.window.close();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
