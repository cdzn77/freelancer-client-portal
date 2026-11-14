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

  const { TwoFactor, AccountSecurityGate } =
    await import("../components/account-security");
  const user = userEvent.setup({ document: dom.window.document });
  let done = 0;
  let level = "aal1";
  let nextLevel = "aal1";
  let assuranceError = false;
  (supabase.auth.mfa as any).getAuthenticatorAssuranceLevel = async () =>
    assuranceError
      ? { data: null, error: { message: "offline" } }
      : { data: { currentLevel: level, nextLevel }, error: null };
  (supabase.auth.mfa as any).listFactors = async () => ({
    data: { totp: [], all: [] },
    error: null,
  });
  (supabase.auth.mfa as any).enroll = async () => ({
    data: {
      id: "test-factor",
      totp: { qr_code: "data:image/svg+xml,test", secret: "TEST-ONLY" },
    },
    error: null,
  });
  (supabase.auth.mfa as any).challengeAndVerify = async ({ code }: any) => ({
    error: code === "123456" ? null : { message: "wrong" },
  });
  render(<TwoFactor onDone={() => done++} />);
  await user.click(
    await screen.findByRole("button", { name: "Set up authenticator" }),
  );
  await screen.findByAltText("Scan this QR code with your authenticator app");
  await user.type(screen.getByLabelText("Authenticator code"), "000000");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("alert");
  assert.equal(done, 0);
  await user.clear(screen.getByLabelText("Authenticator code"));
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByText(/Your account is protected/);
  assert.equal(done, 1);
  assert.equal(screen.queryByText("TEST-ONLY"), null);
  cleanup();
  (supabase as any).rpc = async () => ({
    data: null,
    error: { message: "offline" },
  });
  render(
    <AccountSecurityGate session={{ access_token: "fixture" } as any}>
      <p>Private workspace</p>
    </AccountSecurityGate>,
  );
  await screen.findByRole("alert");
  assert.equal(screen.queryByText("Private workspace"), null);
  cleanup();
  (supabase as any).rpc = async () => ({
    data: { password_required: true, mfa_required: false, mfa_enrolled: false },
    error: null,
  });
  render(
    <AccountSecurityGate session={{ access_token: "fixture" } as any}>
      <p>Private workspace</p>
    </AccountSecurityGate>,
  );
  await screen.findByRole("heading", { name: "Set your password." });
  assert.equal(screen.queryByText("Private workspace"), null);
  cleanup();
  const { PasswordReset } = await import("../components/password-reset");
  let updates = 0;
  (supabase.auth as any).updateUser = async () => {
    updates++;
    return { error: null };
  };
  nextLevel = "aal2";
  (supabase.auth.mfa as any).listFactors = async () => ({
    data: { totp: [{ id: "verified", status: "verified" }], all: [] },
    error: null,
  });
  (supabase.auth.mfa as any).challengeAndVerify = async ({ code }: any) => {
    if (code !== "123456") return { error: { message: "wrong" } };
    level = "aal2";
    return { error: null };
  };
  render(<PasswordReset onDone={() => {}} />);
  await user.type(await screen.findByLabelText("Authenticator code"), "000000");
  assert.equal(screen.queryByLabelText("New password"), null);
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("alert");
  assert.equal(updates, 0);
  await user.clear(screen.getByLabelText("Authenticator code"));
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  await user.type(
    await screen.findByLabelText("New password"),
    "Recovery-password-2026!",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "Recovery-password-2026!",
  );
  await user.click(screen.getByRole("button", { name: "Save new password" }));
  await screen.findByText("Your password is saved.");
  assert.equal(updates, 1);
  cleanup();
  // A security lookup failure must not reveal an actionable password form.
  assuranceError = true;
  render(<PasswordReset onDone={() => {}} />);
  await screen.findByRole("alert");
  assert.equal(screen.queryByLabelText("New password"), null);
  assuranceError = false;
  level = "aal1";
  nextLevel = "aal1";
  await user.click(
    screen.getByRole("button", { name: "Retry security check" }),
  );
  await screen.findByLabelText("New password");
  // Recheck before writing: a downgraded session returns to MFA without an update.
  nextLevel = "aal2";
  await user.type(
    screen.getByLabelText("New password"),
    "Recovery-password-2026!",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "Recovery-password-2026!",
  );
  await user.click(screen.getByRole("button", { name: "Save new password" }));
  await screen.findByLabelText("Authenticator code");
  assert.equal(updates, 1);
  cleanup();
  // Accounts without MFA still save directly.
  nextLevel = "aal1";
  render(<PasswordReset onDone={() => {}} />);
  await user.type(
    await screen.findByLabelText("New password"),
    "Recovery-password-2026!",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "Recovery-password-2026!",
  );
  await user.click(screen.getByRole("button", { name: "Save new password" }));
  await screen.findByText("Your password is saved.");
  assert.equal(updates, 2);
  cleanup();
  dom.window.close();
  console.log(
    "PASS: recovery MFA challenge, invalid code denial, AAL2 password save, lookup failure/retry, save-time assurance recheck, non-MFA recovery.",
  );
  console.log(
    "PASS: authenticator enrollment, invalid-code denial, valid-code completion, secret removal, fail-closed security gate, password gate.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
