"use client";
import { Discussions } from "./discussions";
import { projectPeople } from "@/lib/project-people";
import { X } from "lucide-react";
import { Select } from "./select";
import { DeleteAction } from "./delete-action";
import { useState } from "react";
import { StudioContext } from "./studio";
import { Project, Member } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Field, Modal, Panel, Badge } from "./ui";
export const roleLabel = (role: string) =>
  ({
    owner: "Administrator",
    member: "Regular user",
    contractor: "Regular user",
    client: "Client / Guest",
  })[role] || role;
export const managesProject = (ctx: StudioContext, id: string) =>
  ctx.workspace.role === "owner" ||
  ctx.data.project_members.some(
    (m) =>
      m.project_id === id && m.user_id === ctx.userId && m.role === "owner",
  );
export function AccountMembers({
  ctx,
  onRefresh,
}: {
  ctx: StudioContext;
  onRefresh: () => Promise<void>;
}) {
  const [remove, setRemove] = useState<Member | null>(null),
    [busy, setBusy] = useState(false);
  async function change(m: Member, role?: string) {
    setBusy(true);
    const { error } = await supabase.rpc("manage_workspace_member", {
      w: ctx.workspace.id,
      target: m.user_id,
      new_role: role || null,
      remove_member: !role,
    });
    if (error) ctx.notify(error.message);
    else {
      setRemove(null);
      await ctx.refresh();
      await onRefresh();
      ctx.notify(
        role ? "Account role updated" : "Member removed from this workspace",
      );
    }
    setBusy(false);
  }
  return (
    <>
      <p className="muted">
        Administrators manage the account and see every project. Regular users
        need project access. Guests see only shared work.
      </p>
      <div className="members-list">
        {ctx.data.members.map((m) => (
          <div key={m.user_id} className="member-controls">
            <strong>
              {m.display_name}
              {m.user_id === ctx.userId ? " (you)" : ""}
            </strong>
            <Select
              aria-label={`Account role for ${m.display_name}`}
              value={m.role === "contractor" ? "member" : m.role}
              disabled={busy}
              onChange={(e) => change(m, e.target.value)}
            >
              <option value="owner">Administrator</option>
              <option value="member">Regular user</option>
              <option value="client">Client / Guest</option>
            </Select>
            <button
              className="button small"
              disabled={busy}
              onClick={() => setRemove(m)}
            >
              Remove<span className="sr-only"> {m.display_name}</span>
            </button>
          </div>
        ))}
      </div>
      <Modal
        title={`Remove ${remove?.display_name || "member"}?`}
        description="Their access to this workspace and its projects will end. Their messages and work history will stay, and their assigned tasks will become unassigned."
        open={!!remove}
        onClose={() => setRemove(null)}
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setRemove(null)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => remove && change(remove)}
          >
            Remove member
          </button>
        </div>
      </Modal>
    </>
  );
}
export function ProjectAccess({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const members = ctx.data.project_members.filter(
    (m) => m.project_id === project.id,
  );
  async function member(target: string, role: string, removeMember = false) {
    setBusy(true);
    const { error } = await supabase.rpc("manage_project_member", {
      w: ctx.workspace.id,
      p: project.id,
      target,
      project_role: role,
      remove_member: removeMember,
    });
    if (error) ctx.notify(error.message);
    else {
      setRemove(null);
      await ctx.refresh();
      ctx.notify("Project access updated");
    }
    setBusy(false);
  }
  return (
    <div className="settings-grid">
      <Panel
        title="Who can see this project?"
        subtitle="Administrators always have access."
      >
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            const saved = await ctx.mutate(
              "projects",
              {
                access_type: f.get("access_type"),
                client_tools: f.getAll("tools"),
                ...(ctx.workspace.role === "owner"
                  ? {
                      client_time_report_enabled: f.get("time_report") === "on",
                      client_retainer_report_enabled:
                        f.get("retainer_report") === "on",
                    }
                  : {}),
              },
              project.id,
            );
            if (saved) {
              const { error } = await supabase
                .from("project_shared_briefs")
                .upsert({
                  workspace_id: ctx.workspace.id,
                  project_id: project.id,
                  body: String(f.get("shared_brief") || ""),
                });
              if (error) ctx.notify(error.message);
              else {
                await ctx.refresh();
                ctx.notify("Access settings saved");
              }
            }
            setBusy(false);
          }}
        >
          <Field label="Project access">
            <Select name="access_type" defaultValue={project.access_type}>
              <option value="invite_only">Invite-only</option>
              <option value="workspace">
                All regular users in this workspace
              </option>
            </Select>
          </Field>
          <p>
            Guests always need an explicit invitation, including in
            workspace-wide projects.
          </p>
          <h3>Tools visible to guests</h3>
          <p>
            Turning on a tool shows only the items you have marked as shared.
            New content stays internal.
          </p>
          {["tasks", "discussions", "files", "approvals", "brief"].map((t) => (
            <label className="sharing-choice" key={t}>
              <input
                type="checkbox"
                name="tools"
                value={t}
                defaultChecked={project.client_tools.includes(t)}
              />
              <span>{t[0].toUpperCase() + t.slice(1)}</span>
            </label>
          ))}
          {ctx.workspace.role === "owner" && (
            <>
              <h3>Client time reporting</h3>
              <label className="sharing-choice">
                <input
                  type="checkbox"
                  name="time_report"
                  defaultChecked={project.client_time_report_enabled}
                />
                Share approved time on shared tasks
              </label>
              <label className="sharing-choice">
                <input
                  type="checkbox"
                  name="retainer_report"
                  defaultChecked={project.client_retainer_report_enabled}
                />
                Include retainer hours and shared covered usage
              </label>
              <p>
                Requires Tasks above. No internal notes, staff names, rates or
                margins are shared. Retainer usage shows the full month’s
                approved shared work, not the studio’s total balance.
              </p>
            </>
          )}
          <Field label="Guest-facing brief">
            <textarea
              name="shared_brief"
              rows={5}
              defaultValue={project.shared_brief}
              placeholder="Write the approved brief to share with guests."
            />
          </Field>
          <button className="button primary" disabled={busy}>
            Save access settings
          </button>
        </form>
      </Panel>
      <Panel
        title="Project people"
        subtitle="Project owners can manage invitations and guest sharing."
      >
        <div className="members-list">
          {members.map((m) => {
            const name =
              ctx.data.members.find((x) => x.user_id === m.user_id)
                ?.display_name || "Member";
            return (
              <div key={m.user_id} className="member-controls">
                <strong>{name}</strong>
                {m.role === "guest" ? (
                  <Badge>Guest</Badge>
                ) : (
                  <Select
                    aria-label={`Project role for ${name}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => member(m.user_id, e.target.value)}
                  >
                    <option value="member">Project member</option>
                    <option value="owner">Project owner</option>
                  </Select>
                )}
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => setRemove(m.user_id)}
                >
                  Remove<span className="sr-only"> {name}</span>
                </button>
              </div>
            );
          })}
        </div>
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const target = String(new FormData(e.currentTarget).get("person"));
            await member(
              target,
              ctx.data.members.find((m) => m.user_id === target)?.role ===
                "client"
                ? "guest"
                : "member",
            );
          }}
        >
          <Field label="Invite a workspace member">
            <Select name="person" required defaultValue="">
              <option value="" disabled>
                Choose a person
              </option>
              {ctx.data.members
                .filter((m) => !members.some((p) => p.user_id === m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name} · {roleLabel(m.role)}
                  </option>
                ))}
            </Select>
          </Field>
          <button className="button" disabled={busy}>
            Add to project
          </button>
        </form>
        <p className="muted">
          Removing a direct invitation does not remove administrator or
          workspace-wide access.
        </p>
      </Panel>
      <Panel
        title="Approved content for guests"
        bodyClassName="panel-body sharing-groups"
        subtitle="Sharing an item requires its tool to be enabled above. Discussion visibility is managed within each thread."
      >
        {(
          [
            ["tasks", ctx.data.tasks],
            ["approvals", ctx.data.approvals],
            ["project_files", ctx.data.project_files],
          ] as const
        ).map(([table, rows]) => (
          <div key={table} className="sharing-group">
            <h3>
              {table === "project_files"
                ? "Files"
                : table[0].toUpperCase() + table.slice(1)}
            </h3>
            {!rows.some((r) => r.project_id === project.id) && (
              <p className="muted">No items to share yet.</p>
            )}
            {rows
              .filter((r) => r.project_id === project.id)
              .map((r) => (
                <label className="sharing-choice" key={r.id}>
                  <input
                    type="checkbox"
                    checked={r.is_published}
                    disabled={busy}
                    onChange={async (e) => {
                      setBusy(true);
                      await ctx.mutate(
                        table,
                        { is_published: e.target.checked },
                        r.id,
                      );
                      setBusy(false);
                    }}
                  />
                  <span>
                    {"title" in r ? r.title : "label" in r ? r.label : r.name}
                  </span>
                  <Badge>{r.is_published ? "Shared" : "Internal"}</Badge>
                </label>
              ))}
          </div>
        ))}
      </Panel>
      <Modal
        title="Remove project invitation?"
        description="This removes their direct project access and unassigns their tasks in this project. Administrators and regular users in workspace-wide projects retain access."
        open={!!remove}
        onClose={() => setRemove(null)}
      >
        <div className="modal-actions">
          <button className="button" onClick={() => setRemove(null)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => remove && member(remove, "member", true)}
          >
            Remove invitation
          </button>
        </div>
      </Modal>
    </div>
  );
}
export function ProjectDiscussion({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  return <Discussions key={project.id} ctx={ctx} project={project} />;
}

export function ProjectFiles({
  ctx,
  project,
}: {
  ctx: StudioContext;
  project: Project;
}) {
  const [busy, setBusy] = useState(false);
  async function headers() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token}` };
  }
  return (
    <Panel
      title="Project files"
      bodyClassName="panel-body file-panel-body"
      action={
        ctx.workspace.role !== "client" && (
          <button
            className="button"
            onClick={() => ctx.selectProject(project.id, "Review")}
          >
            Go to reviews
          </button>
        )
      }
      subtitle={
        ctx.workspace.role === "client"
          ? "Files shared with you."
          : "Uploads stay internal until a project owner shares them."
      }
    >
      {ctx.data.project_files
        .filter((f) => f.project_id === project.id)
        .map((f) => (
          <div className="approval-row project-file-row" key={f.id}>
            <strong>{f.name}</strong>
            <Badge>{f.is_published ? "Shared" : "Internal"}</Badge>
            {(managesProject(ctx, project.id) ||
              (f.created_by === ctx.userId &&
                ctx.workspace.role !== "client")) && (
              <DeleteAction
                ctx={ctx}
                label={f.name}
                description="Delete this file from storage and remove it from the project. Downloaded copies cannot be recalled."
                action={async () => {
                  const r = await fetch(
                    `/api/storage?path=${encodeURIComponent(f.path)}`,
                    { method: "DELETE", headers: await headers() },
                  );
                  const b = await r.json();
                  if (!r.ok) throw Error(b.error);
                }}
              />
            )}
            <button
              className="button small"
              onClick={async () => {
                try {
                  const r = await fetch(
                    `/api/storage?path=${encodeURIComponent(f.path)}`,
                    { headers: await headers() },
                  );
                  const b = await r.json();
                  if (!r.ok) throw Error(b.error);
                  window.open(b.url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  ctx.notify((e as Error).message);
                }
              }}
            >
              Open file
            </button>
          </div>
        ))}
      {ctx.workspace.role !== "client" && (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            setBusy(true);
            try {
              const f = new FormData(form);
              f.set("workspace", ctx.workspace.id);
              f.set("project", project.id);
              const configResponse = await fetch(
                "/api/storage?configuration=true",
                { headers: await headers() },
              );
              const config = await configResponse.json();
              if (!configResponse.ok)
                throw Error(config.error || "Could not check file storage.");
              const chosen = f.get("file");
              if (
                !(chosen instanceof File) ||
                chosen.size > config.maxUploadMB * 1024 * 1024
              )
                throw Error(`Choose a file up to ${config.maxUploadMB} MB.`);
              if (
                config.provider === "supabase" &&
                process.env.NEXT_PUBLIC_DIRECT_STORAGE_UPLOAD === "true"
              ) {
                const file = f.get("file");
                if (
                  !(file instanceof File) ||
                  !file.size ||
                  file.size > 10 * 1024 * 1024
                )
                  throw Error("Choose a file up to 10 MB.");
                const path = `${ctx.workspace.id}/${project.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
                const bucket = supabase.storage.from("project-files");
                const upload = await bucket.upload(path, file);
                if (upload.error) throw upload.error;
                const record = await supabase.from("project_files").insert({
                  workspace_id: ctx.workspace.id,
                  project_id: project.id,
                  path,
                  name: file.name,
                  provider: "supabase",
                });
                if (record.error) {
                  await bucket.remove([path]);
                  throw record.error;
                }
              } else {
                const r = await fetch("/api/storage", {
                  method: "POST",
                  headers: await headers(),
                  body: f,
                });
                const b = await r.json();
                if (!r.ok) throw Error(b.error);
              }
              await ctx.refresh();
              form.reset();
              ctx.notify("File uploaded privately");
            } catch (e) {
              ctx.notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Choose a file (up to 10 MB; Dropbox up to 4 MB)">
            <input name="file" type="file" required />
          </Field>
          <button className="button" disabled={busy}>
            {busy ? "Uploading…" : "Upload file"}
          </button>
        </form>
      )}
    </Panel>
  );
}
