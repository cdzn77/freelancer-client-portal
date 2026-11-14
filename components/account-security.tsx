"use client";
import { brand } from "../lib/brand";

import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { PasswordReset } from "./password-reset";

type Security = {
  password_required: boolean;
  mfa_required: boolean;
  mfa_enrolled: boolean;
};
export function AccountSecurityGate({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Security | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    supabase.rpc("pms_security_status").then(({ data, error }) => {
      if (!active) return;
      if (error || !data)
        setError("Could not verify account security. Please retry.");
      else setStatus(data as Security);
    });
    return () => {
      active = false;
    };
  }, [session.access_token, revision]);
  const refresh = () => setRevision((v) => v + 1);
  if (status?.password_required)
    return <PasswordReset initialAccount onDone={refresh} />;
  if (status?.mfa_required)
    return (
      <main className="auth-form" style={{ minHeight: "100vh" }}>
        <section className="auth-form-inner">
          <TwoFactor onDone={refresh} challenge />
        </section>
      </main>
    );
  if (!status)
    return (
      <main className="auth-form" style={{ minHeight: "100vh" }}>
        <section className="auth-form-inner">
          <p role={error ? "alert" : "status"}>
            {error || "Checking account security…"}
          </p>
          {error && (
            <button className="button" onClick={refresh}>
              Retry
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              void supabase.auth.signOut();
            }}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  return children;
}

export function TwoFactor({
  challenge = false,
  onDone,
}: {
  challenge?: boolean;
  onDone?: () => void;
}) {
  const [factor, setFactor] = useState("");
  const [enrolled, setEnrolled] = useState(false);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error)
        setError("Could not load two-factor settings. Reload and try again.");
      else {
        const verified = data.totp.find((f) => f.status === "verified");
        setFactor(verified?.id || "");
        setEnrolled(!!verified);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const f of factors.data.all.filter(
        (f) => f.status === "unverified" && f.factor_type === "totp",
      )) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (removed.error) throw removed.error;
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "PMS authenticator",
        issuer: (brand.appName),
      });
      if (error) throw error;
      setFactor(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    } catch {
      setError("Could not start setup. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor,
        code,
      });
      if (error) throw error;
      setEnrolled(true);
      setQr("");
      setSecret("");
      setCode("");
      onDone?.();
    } catch {
      setError(
        "That code could not be verified. Enter the latest six-digit code from your authenticator.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-form" aria-label="Two-factor authentication">
      <h2>{challenge ? "Verify your sign-in" : "Two-factor authentication"}</h2>
      <p>
        {enrolled && !challenge
          ? "Your account is protected with an authenticator app. New sign-ins require your password and a verification code."
          : "Use an authenticator app to protect your account with a six-digit code in addition to your password."}
      </p>
      {!challenge && !enrolled && !qr && (
        <button
          type="button"
          className="button"
          disabled={!ready || busy}
          onClick={start}
        >
          {busy ? "Preparing…" : "Set up authenticator"}
        </button>
      )}
      {qr && (
        <>
          <img
            src={qr}
            alt="Scan this QR code with your authenticator app"
            width={220}
            height={220}
          />
          <details>
            <summary>Enter a setup key instead</summary>
            <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
          </details>
          <p>
            Keep your authenticator backed up. If you lose access, contact your
            administrator; account recovery requires identity verification.
          </p>
        </>
      )}
      {(challenge || qr) && factor && (
        <form onSubmit={verify}>
          <label className="field">
            <span>Authenticator code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Verifying…" : "Verify code"}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {challenge && (
        <button
          className="text-button"
          onClick={() => {
            void supabase.auth.signOut();
          }}
        >
          Sign out
        </button>
      )}
    </section>
  );
}
