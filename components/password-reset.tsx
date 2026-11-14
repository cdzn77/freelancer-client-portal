"use client";
import { useEffect, useState } from "react";
import { TwoFactor } from "./account-security";
import { BrandLogo } from "./brand";
import { supabase } from "@/lib/supabase";

export function PasswordReset({
  onDone,
  initialAccount = false,
}: {
  onDone: () => void;
  initialAccount?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [assurance, setAssurance] = useState<
    "loading" | "ready" | "challenge" | "error"
  >("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setAssurance("loading");
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.currentLevel) setAssurance("error");
        else
          setAssurance(
            data.nextLevel === "aal2" && data.currentLevel !== "aal2"
              ? "challenge"
              : "ready",
          );
      })
      .catch(() => {
        if (active) setAssurance("error");
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assurance !== "ready" || busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    setError("");
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== data.get("confirm")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const checked = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (checked.error || !checked.data?.currentLevel) {
        setAssurance("error");
        return;
      }
      if (
        checked.data.nextLevel === "aal2" &&
        checked.data.currentLevel !== "aal2"
      ) {
        setAssurance("challenge");
        return;
      }
      const { error } = await supabase.auth.updateUser({
        password,
        ...(initialAccount ? { data: { pms_password_choice: false } } : {}),
      });
      if (error) throw error;
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-form" style={{ minHeight: "100vh" }}>
      <section className="auth-form-inner" aria-labelledby="reset-heading">
        <BrandLogo />
        <h1 id="reset-heading">
          {saved ? "Your password is saved." : "Set your password."}
        </h1>
        {saved ? (
          <>
            <p role="status">
              Use your email address and new password next time you sign in.
            </p>
            <button className="button primary wide" onClick={onDone}>
              Continue to workspace
            </button>
          </>
        ) : assurance === "loading" ? (
          <p role="status">Checking account security…</p>
        ) : assurance === "error" ? (
          <>
            <p role="alert">
              Could not verify account security. Retry before changing your
              password.
            </p>
            <button
              className="button"
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry security check
            </button>
          </>
        ) : assurance === "challenge" ? (
          <>
            <p>
              Verify with your authenticator before choosing a new password.
            </p>
            <TwoFactor
              challenge
              onDone={() => {
                setError("");
                setRevision((v) => v + 1);
              }}
            />
            <p>
              If you cannot access your authenticator, contact your workspace
              administrator for account recovery.
            </p>
          </>
        ) : (
          <>
            <p>
              {initialAccount
                ? "Your administrator created your account. Choose your own password before opening the workspace."
                : "Your email link has signed you in. Choose a new password. Your old password is not needed."}
            </p>
            <form onSubmit={save}>
              <label className="field">
                <span>New password</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <p>Use at least 12 characters.</p>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="button primary wide" disabled={busy}>
                {busy ? "Saving..." : "Save new password"}
              </button>
            </form>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={
                initialAccount
                  ? () => {
                      void supabase.auth.signOut();
                    }
                  : onDone
              }
            >
              {initialAccount
                ? "Sign out"
                : "Continue without changing password"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
