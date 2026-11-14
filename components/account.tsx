"use client";
import { useAvatars } from "./avatar-provider";
import { prepareProfilePhoto } from "@/lib/profile-photo";
import { BotCheck, botCheckSiteKey } from "./bot-check";
import { Select } from "./select";
import { useEffect, useRef, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  UserRound,
  Mail,
  LockKeyhole,
  LogOut,
  ArrowUpRight,
  Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Avatar, Badge, Field, Panel } from "./ui";
export function accountName(session: Session) {
  return (
    session.user.user_metadata.full_name ||
    session.user.user_metadata.name ||
    session.user.email?.split("@")[0] ||
    "Your account"
  );
}
export function AccountView({
  session,
  onSaved,
}: {
  session: Session;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);
  const { urls: avatarUrls, refresh: refreshAvatars } = useAvatars();
  async function changePhoto(file: File | null) {
    setBusy("photo");
    setError("");
    setMessage("");
    try {
      const path = `${session.user.id}/avatar.jpg`;
      if (file) {
        const photo = await prepareProfilePhoto(file);
        const { error } = await supabase.storage
          .from("profile-photos")
          .upload(path, photo, {
            upsert: true,
            contentType: "image/jpeg",
            cacheControl: "0",
          });
        if (error)
          throw Error("Your photo could not be saved. Please try again.");
      } else {
        const { error } = await supabase.storage
          .from("profile-photos")
          .remove([path]);
        if (error)
          throw Error("Your photo could not be removed. Please try again.");
      }
      await refreshAvatars();
      setMessage(
        file
          ? "Your profile photo is updated."
          : "Your photo is removed. Your initials will appear instead.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This photo could not be processed.",
      );
    } finally {
      setBusy("");
      if (photoInput.current) photoInput.current.value = "";
    }
  }
  const [emailVerified, setEmailVerified] = useState(false);
  async function hasRecentEmailVerification() {
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return (
      !error &&
      !!data?.currentAuthenticationMethods.some(
        (method) =>
          typeof method !== "string" &&
          ["otp", "recovery", "magiclink", "invite"].includes(method.method) &&
          method.timestamp > Date.now() / 1000 - 3600,
      )
    );
  }
  useEffect(() => {
    void hasRecentEmailVerification().then(setEmailVerified);
  }, [session.access_token]);
  const meta = session.user.user_metadata;
  async function update(e: React.FormEvent<HTMLFormElement>, section: string) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(section);
    setError("");
    setMessage("");
    try {
      if (section === "profile") {
        const full_name = String(f.get("full_name")).trim();
        if (!full_name) throw Error("Add your name before saving.");
        const { error } = await supabase.auth.updateUser({
          data: {
            full_name,
            job_title: String(f.get("job_title")).trim(),
            company: String(f.get("company")).trim(),
            website: String(f.get("website")).trim(),
            bio: String(f.get("bio")).trim(),
            timezone: String(f.get("timezone")),
          },
        });
        if (error) throw error;
        await onSaved();
        setMessage("Your profile is saved.");
      } else {
        const current = String(f.get("current_password"));
        if (
          section === "password" &&
          f.get("new_password") !== f.get("confirm_password")
        )
          throw Error("The new passwords do not match.");
        if (section === "password" && String(f.get("new_password")).length < 12)
          throw Error("Use at least 12 characters.");
        // Email links establish an authenticated session; Supabase still authorizes the update.
        if (section !== "password" || !(await hasRecentEmailVerification())) {
          if (botCheckSiteKey && !captchaToken)
            throw Error("Complete the account security check below first.");
          // Verify the password without replacing the active (possibly MFA) session.
          const verifier = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:8000",
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "local-setup-required",
            {
              auth: {
                storageKey: `pms-password-verifier-${crypto.randomUUID()}`,
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
              },
            },
          );
          const auth = await verifier.auth.signInWithPassword({
            email: session.user.email!,
            password: current,
            options: { captchaToken: captchaToken || undefined },
          });
          if (auth.data.session)
            await verifier.auth.signOut({ scope: "local" });
          if (auth.error)
            throw Error(
              "Your current password is incorrect. Use the password reset link below if you do not know it.",
            );
        }
        const result = await supabase.auth.updateUser(
          section === "password"
            ? { password: String(f.get("new_password")) }
            : { email: String(f.get("email")).trim() },
        );
        if (result.error) throw result.error;
        form.reset();
        setMessage(
          section === "password"
            ? "Your password is updated."
            : "Email change requested. Check your current and new inboxes for confirmation.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (section !== "profile") {
        setCaptchaToken("");
        setCaptchaAttempt((v) => v + 1);
      }
      setBusy("");
    }
  }
  const timezone =
    meta.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = Array.from(
    new Set([timezone, "UTC", ...Intl.supportedValuesOf("timeZone")]),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE PERSON BEHIND THE GOOD WORK</div>
          <h1>
            Your profile<span className="coral-text">.</span>
          </h1>
          <p>
            Your details, your account, and how you show up in your workspaces.
          </p>
        </div>
        <button
          className="button"
          onClick={async () => {
            const { error } = await supabase.auth.signOut();
            if (error) setError(error.message);
          }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
      <section className="account-summary" aria-label="Account overview">
        <Avatar name={accountName(session)} userId={session.user.id} />
        <div>
          <h2>{accountName(session)}</h2>
          <p>
            {[meta.job_title, meta.company].filter(Boolean).join(" at ") ||
              "A little more about you."}
          </p>
          <span>{session.user.email}</span>
          <div className="profile-photo-actions">
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              aria-label="Choose profile photo"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void changePhoto(file);
              }}
            />
            <button
              type="button"
              className="button"
              disabled={!!busy}
              onClick={() => photoInput.current?.click()}
            >
              {busy === "photo"
                ? "Updating photo…"
                : avatarUrls[session.user.id]
                  ? "Change photo"
                  : "Upload photo"}
            </button>
            {avatarUrls[session.user.id] && (
              <button
                type="button"
                className="button"
                disabled={!!busy}
                onClick={() => void changePhoto(null)}
              >
                Remove photo
              </button>
            )}
          </div>
          <p className="profile-photo-help">
            JPG, PNG, or WebP, up to 5 MB. Photos are cropped to a square from
            the center.
          </p>
        </div>
        <Badge tone="green">
          {session.user.email_confirmed_at
            ? "Email verified"
            : "Email confirmation pending"}
        </Badge>
      </section>
      {message && (
        <div className="account-success" role="status">
          <Check size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="account-grid">
        <Panel
          title="Personal details"
          subtitle="Your name appears on tasks, comments, and the team list."
        >
          <form
            className="settings-form"
            onSubmit={(e) => update(e, "profile")}
          >
            <Field label="Full name">
              <input
                name="full_name"
                autoComplete="name"
                defaultValue={accountName(session)}
                maxLength={100}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Job title">
                <input
                  name="job_title"
                  autoComplete="organization-title"
                  defaultValue={meta.job_title || ""}
                  placeholder="Designer, founder, maker..."
                  maxLength={100}
                />
              </Field>
              <Field label="Company or studio">
                <input
                  name="company"
                  autoComplete="organization"
                  defaultValue={meta.company || ""}
                  maxLength={120}
                />
              </Field>
            </div>
            <Field label="Website">
              <input
                name="website"
                type="url"
                autoComplete="url"
                placeholder="https://yourstudio.com"
                defaultValue={meta.website || ""}
                maxLength={300}
              />
            </Field>
            <Field label="A little about you">
              <textarea
                name="bio"
                rows={3}
                defaultValue={meta.bio || ""}
                maxLength={500}
                placeholder="What you do, what you care about, what you’re making."
              />
            </Field>
            <Field label="Time zone">
              <Select name="timezone" defaultValue={timezone}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <button className="button primary" disabled={!!busy}>
              {busy === "profile" ? "Saving..." : "Save profile"}
              <ArrowUpRight size={15} />
            </button>
          </form>
        </Panel>
        <div className="account-security">
          <Panel title="Email address" subtitle="Use this address to sign in.">
            <form
              className="settings-form"
              onSubmit={(e) => update(e, "email")}
            >
              <Field label="New email address">
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={session.user.new_email || session.user.email}
                  required
                />
              </Field>
              <Field label="Current password for email change">
                <input
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <p>
                We’ll ask you to confirm the change by email. Your profile
                details stay with your account.
              </p>
              <button className="button" disabled={!!busy}>
                {busy === "email" ? "Updating..." : "Update email"}
              </button>
            </form>
          </Panel>
          <Panel
            title="Password"
            subtitle="Choose a password you don’t use elsewhere."
          >
            <form
              className="settings-form"
              onSubmit={(e) => update(e, "password")}
            >
              {!emailVerified && (
                <Field label="Current password">
                  <input
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
              )}
              {emailVerified && (
                <p>
                  Your email sign-in is verified. You can set a password without
                  entering an old one.
                </p>
              )}
              <Field label="New password">
                <input
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </Field>
              <p>Use at least 12 characters.</p>
              <button className="button" disabled={!!busy}>
                {busy === "password" ? "Updating..." : "Update password"}
              </button>
            </form>
            <button
              type="button"
              className="text-button"
              disabled={!!busy}
              onClick={async () => {
                setBusy("reset");
                setError("");
                setMessage("");
                try {
                  if (botCheckSiteKey && !captchaToken)
                    throw Error(
                      "Complete the account security check below first.",
                    );
                  const { error } = await supabase.auth.resetPasswordForEmail(
                    session.user.email!,
                    {
                      redirectTo: window.location.origin + "/",
                      captchaToken: captchaToken || undefined,
                    },
                  );
                  if (error) throw error;
                  setMessage(
                    "Check your email for a password reset link. Open the newest link to choose a new password.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setCaptchaToken("");
                  setCaptchaAttempt((v) => v + 1);
                  setBusy("");
                }
              }}
            >
              Forgot your current password? Send a reset link
            </button>
            {botCheckSiteKey && (
              <section
                className="account-bot-check"
                aria-label="Account security check"
              >
                <h3>Account security check</h3>
                <p>
                  Complete this check before changing your email, confirming
                  your current password, or requesting a reset link.
                </p>
                <BotCheck key={captchaAttempt} onToken={setCaptchaToken} />
              </section>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
