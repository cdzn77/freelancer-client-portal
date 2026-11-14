"use client";
import { brand } from "../lib/brand";
import { BotCheck, botCheckSiteKey } from "@/components/bot-check";
import { AccountSecurityGate } from "@/components/account-security";
import { BrandLogo } from "@/components/brand";
import { useEffect, useState } from "react";
import { PasswordReset } from "@/components/password-reset";
import { supabase, passwordLinkFlow, authLinkError } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Studio } from "@/components/studio";
import { ArrowRight } from "lucide-react";
export default function Page() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [forgot, setForgot] = useState(false),
    [resetting, setResetting] = useState(false),
    [message, setMessage] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  useEffect(() => {
    setError(authLinkError);
    setResetting(
      passwordLinkFlow ||
        sessionStorage.getItem("pms-password-reset") === "yes",
    );
    if (passwordLinkFlow) sessionStorage.setItem("pms-password-reset", "yes");
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem("pms-password-reset", "yes");
        setResetting(true);
      }
      if (event === "SIGNED_OUT") {
        sessionStorage.removeItem("pms-password-reset");
        setResetting(false);
      }
      setSession(s);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (botCheckSiteKey && !captchaToken) {
      setError("Complete bot verification first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    if (forgot) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(
          String(f.get("email")).trim(),
          {
            redirectTo: window.location.origin + "/",
            captchaToken: captchaToken || undefined,
          },
        );
        if (error) throw error;
        setMessage(
          "If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder, then open the newest link.",
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCaptchaToken("");
        setCaptchaAttempt((v) => v + 1);
        setBusy(false);
      }
      return;
    }
    const credentials = {
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: { captchaToken: captchaToken || undefined },
    };
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error)
      setError(
        error.message.includes("fetch")
          ? "Cannot reach the workspace server. Check that the local stack is running."
          : error.message,
      );
    setCaptchaToken("");
    setCaptchaAttempt((v) => v + 1);
    setBusy(false);
  }
  if (!ready)
    return (
      <main className="loading">
        <BrandLogo />
        <p>Opening your workspace...</p>
      </main>
    );
  if (session && resetting)
    return (
      <PasswordReset
        initialAccount={
          session.user.app_metadata.pms_password_change_required === true
        }
        onDone={() => {
          sessionStorage.removeItem("pms-password-reset");
          setResetting(false);
        }}
      />
    );
  if (session)
    return (
      <AccountSecurityGate session={session}>
        <Studio key={session.user.id} session={session} />
      </AccountSecurityGate>
    );
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <div className="brand-lockup">
            <BrandLogo />
            <small>STUDIO WORKSPACE</small>
          </div>
        </div>
        <div>
          <span className="eyebrow">{brand.name} / PROJECT MANAGEMENT</span>
          <h1>
            Strategy.
            <br />
            Design.
            <br />
            <em>Delivery.</em>
          </h1>
          <p>
            Your projects, people, and the details in between.
            <br />
            One workspace, from brief to delivery.
          </p>
        </div>
        <span className="auth-footer">
          {brand.tagline}
        </span>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">YOUR NEXT GOOD THING STARTS HERE</span>
          <h2>{forgot ? "Reset your password." : "Welcome back."}</h2>
          <p>
            {forgot
              ? "We’ll email you a link to choose a new password."
              : "Sign in with the account provided by your workspace administrator."}
          </p>
          <form onSubmit={login}>
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@yourstudio.com"
                required
              />
            </label>
            {!forgot && (
              <label className="field">
                <span>Password</span>
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete="current-password"
                  required
                />
              </label>
            )}
            <BotCheck key={captchaAttempt} onToken={setCaptchaToken} />
            {message && (
              <div className="account-success" role="status">
                {message}
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="button primary wide"
              disabled={busy || (!!botCheckSiteKey && !captchaToken)}
            >
              {busy
                ? "Connecting..."
                : forgot
                  ? "Send reset link"
                  : "Open workspace"}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setForgot(!forgot);
              setError("");
              setMessage("");
            }}
          >
            {forgot ? "Back to sign in" : "Forgot password?"}
          </button>
          <nav
            aria-label="About this application"
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              marginTop: 24,
            }}
          >
            <a href="/about">About the portal</a>
            <a href="/privacy">Privacy policy</a>
            <a href="/terms">Terms of service</a>
              <a href="/help/guide.pdf" target="_blank" rel="noreferrer">User guide (PDF)</a>
          </nav>
          <div className="local-note">
            <span className="online-dot" /> Your work stays in your own
            workspace.
          </div>
        </div>
      </section>
    </main>
  );
}
