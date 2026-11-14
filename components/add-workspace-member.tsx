"use client";
import { brand } from "../lib/brand";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { StudioContext } from "./studio";
import { Field, Panel } from "./ui";
import { Select } from "./select";
export function AddWorkspaceMember({
  ctx,
  onRefresh,
}: {
  ctx: StudioContext;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState("create"),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const [invitation, setInvitation] = useState<{
    email: string;
    password: string;
    url: string;
  } | null>(null);
  if (ctx.workspace.role !== "owner") return null;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError("");
    setInvitation(null);
    setCopied(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw Error("Sign in again to continue.");
      const email = String(f.get("email")).trim().toLowerCase();
      const r = await fetch("/api/workspace/members", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace: ctx.workspace.id,
          mode,
          email,
          role: f.get("role"),
          project: f.get("project") || null,
          ...(mode === "create" ? { name: f.get("name"), password } : {}),
        }),
      });
      const result = await r.json();
      if (!r.ok) {
        if (result.created) {
          setMode("existing");
          setInvitation({ email, password, url: window.location.origin + "/" });
        }
        throw Error(result.error || "Could not add this person.");
      }
      if (result.created)
        setInvitation({ email, password, url: window.location.origin + "/" });
      form.reset();
      setPassword("");
      setShow(false);
      ctx.notify(
        result.created
          ? "Account created and workspace access added"
          : result.already_member
            ? "Existing membership kept; any selected project access added"
            : "Existing account added. Password unchanged.",
      );
      await ctx.refresh();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    setPassword(
      "Pms!" +
        Array.from(
          bytes,
          (b) =>
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[b % 55],
        ).join(""),
    );
  }
  return (
    <Panel
      title="Invite someone to the workspace"
      subtitle="Create their login here, then share their sign-in details. No signup required."
    >
      <form className="settings-form" onSubmit={submit}>
        <Field label="Account setup">
          <Select
            value={mode}
            disabled={busy}
            onChange={(e) => {
              setMode(e.target.value);
              setError("");
              setPassword("");
            }}
          >
            <option value="create">Create account</option>
            <option value="existing">Add existing account</option>
          </Select>
        </Field>
        {mode === "create" && (
          <Field label="Full name">
            <input
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
        )}
        <Field label="Email address">
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            disabled={busy}
          />
        </Field>
        <Field label="Workspace role">
          <Select name="role" defaultValue="member" disabled={busy}>
            <option value="member">Regular user / Team member</option>
            <option value="owner">Administrator</option>
            <option value="client">Client / Guest</option>
          </Select>
        </Field>
        <p className="muted">
          Administrators see all workspace projects. Clients see only projects
          and content explicitly shared with them.
        </p>
        <Field label="Add to a project (optional)">
          <Select name="project" defaultValue="" disabled={busy}>
            <option value="">Choose later</option>
            {ctx.data.projects
              .filter((p) => !p.deleted_at)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        {mode === "create" ? (
          <>
            <Field label="Initial password">
              <input
                name="initial_password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                maxLength={64}
                required
                autoComplete="new-password"
                disabled={busy}
              />
            </Field>
            <div className="expense-actions">
              <button
                className="button small"
                type="button"
                onClick={generate}
                disabled={busy}
              >
                Generate password
              </button>
              <button
                className="button small"
                type="button"
                onClick={() => setShow(!show)}
                disabled={busy}
              >
                {show ? "Hide password" : "Show password"}
              </button>
            </div>
            <p className="muted">
              Use at least 12 characters. They must change this temporary
              password at first sign-in. Share it directly with this person.
            </p>
          </>
        ) : (
          <p className="muted">
            Their existing password and any existing workspace role stay
            unchanged. Use the member list to change roles.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy
            ? "Saving…"
            : mode === "create"
              ? "Create account & add member"
              : "Add existing account"}
        </button>
      </form>
      {invitation && (
        <div className="account-success" role="status">
          <p>
            Sign-in details for {invitation.email} are ready. No email has been
            sent. Copy them before leaving this page.
          </p>
          <button
            className="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `Your ${brand.appName} login\n${invitation.url}\nEmail: ${invitation.email}\nInitial password: ${invitation.password}\nYou must choose your own password when you first sign in.`,
                );
                setCopied(true);
              } catch {
                setError(
                  "Clipboard unavailable. Use Show sign-in details to copy them manually.",
                );
              }
            }}
          >
            {copied ? "Copied" : "Copy invitation"}
          </button>
          <details>
            <summary>Show sign-in details</summary>
            <p>
              {invitation.url}
              <br />
              {invitation.email}
              <br />
              Initial password: <code>{invitation.password}</code>
            </p>
          </details>
          <button className="text-button" onClick={() => setInvitation(null)}>
            Dismiss sign-in details
          </button>
        </div>
      )}
    </Panel>
  );
}
