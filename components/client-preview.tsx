"use client";
import { ClientNavigation } from "./client-navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { emptyData, type Data, type Workspace } from "@/lib/types";
import { TaskDetail } from "./task-detail";
import type { Task } from "@/lib/types";
import { PortalView } from "./client-portal";
import type { StudioContext } from "./studio";
import { Select } from "./select";
import { Field } from "./ui";
export function ClientPreview() {
  const sequence = useRef(0);
  const [params, setParams] = useState<{
      project: string;
      workspace: string;
    } | null>(null),
    [clients, setClients] = useState<
      { user_id: string; display_name: string }[]
    >([]),
    [client, setClient] = useState(""),
    [data, setData] = useState<Data | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [view, setView] = useState("Project"),
    [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setParams({
      project: q.get("project") || "",
      workspace: q.get("workspace") || "",
    });
  }, []);
  useEffect(() => {
    if (!params) return;
    let active = true;
    void (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session)
          throw Error(
            "Sign in as an administrator in the main tab, then reload this preview",
          );
        const role = await supabase.rpc("workspace_role", {
          w: params.workspace,
        });
        if (role.error || role.data !== "owner")
          throw Error("Administrator access required");
        const [w, m, p] = await Promise.all([
          supabase
            .from("workspaces")
            .select("*")
            .eq("id", params.workspace)
            .single(),
          supabase
            .from("workspace_members")
            .select("user_id,display_name")
            .eq("workspace_id", params.workspace)
            .eq("role", "client"),
          supabase
            .from("project_members")
            .select("user_id")
            .eq("workspace_id", params.workspace)
            .eq("project_id", params.project)
            .eq("role", "guest"),
        ]);
        if (w.error || m.error || p.error)
          throw Error("Could not load invited clients");
        const allowed = m.data!.filter((c) =>
          p.data!.some((p) => p.user_id === c.user_id),
        );
        if (active) {
          setWorkspace({ ...w.data, role: "client" });
          setClients(allowed);
          setClient(allowed[0]?.user_id || "");
          if (!allowed.length)
            setError(
              "Invite a client to this project before previewing their access",
            );
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [params]);
  const refresh = useCallback(async () => {
    if (!params || !client) return;
    const current = ++sequence.current;
    setData(null);
    setError("");
    const r = await supabase.rpc("preview_client_project", {
      p_project: params.project,
      p_client: client,
    });
    if (current !== sequence.current) return;
    if (r.error) {
      setError(r.error.message);
      return;
    }
    const next: Data = { ...emptyData, ...r.data };
    next.projects = next.projects.map((p) => ({
      ...p,
      brief: "",
      shared_brief:
        next.project_shared_briefs.find((b) => b.project_id === p.id)?.body ||
        "",
    }));
    setData(next);
  }, [params, client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const returnUrl = params
    ? `/?workspace=${encodeURIComponent(params.workspace)}&page=Projects&project=${encodeURIComponent(params.project)}`
    : "/";
  const blocked = () =>
    setMessage("Preview is read-only. Return to admin to make changes.");
  const ctx: StudioContext | null =
    data && workspace
      ? {
          data,
          workspace,
          userId: client,
          readOnly: true,
          refresh,
          notify: setMessage,
          mutate: async () => {
            blocked();
            return false;
          },
          openTask: (t) => (t ? setTask(t) : blocked()),
          openProject: blocked,
          selectProject: blocked,
        }
      : null;
  return (
    <div className="app-shell client-shell client-preview-app">
      <div className="main-shell">
        <div className="client-preview-shell">
          <aside
            className="client-preview-banner"
            aria-label="Administrator client preview"
          >
            <strong>Client view preview · Read-only</strong>
            <span>
              Your administrator session is unchanged. Only this project's
              shared client content is shown. Home is limited to this project;
              account-wide documents, updates and profile are outside this
              preview.
            </span>
            <a className="button" href={returnUrl}>
              Return to admin
            </a>
            <button className="button" onClick={() => void refresh()}>
              Refresh client view
            </button>
          </aside>
          <div className="client-preview-controls">
            <Field label="Preview as invited client">
              <Select
                aria-label="Preview as invited client"
                value={client}
                onChange={(e) => {
                  setTask(null);
                  setClient(e.target.value);
                  setView("Project");
                }}
              >
                {clients.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.display_name}
                  </option>
                ))}
              </Select>
            </Field>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
          </div>
        </div>
        {ctx && (
          <ClientNavigation
            page="Client portal"
            view={view}
            name={
              clients.find((c) => c.user_id === client)?.display_name ||
              "Client"
            }
            onNavigate={(destination) => {
              if (["Home", "Projects", "Messages"].includes(destination)) {
                setTask(null);
                setView(destination);
                setMessage("");
              } else
                setMessage(
                  "This preview covers the selected project. Account-wide documents, updates and profile require the client’s own session.",
                );
            }}
          />
        )}
        <main id="main-content">
          {ctx ? (
            <div
              onSubmitCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
                blocked();
              }}
            >
              {task && (
                <TaskDetail
                  ctx={ctx}
                  task={ctx.data.tasks.find((t) => t.id === task.id) || task}
                  onClose={() => setTask(null)}
                />
              )}
              <PortalView
                key={client}
                ctx={ctx}
                view={view}
                onView={setView}
                onRequest={blocked}
                onNavigate={blocked}
              />
            </div>
          ) : (
            !error && <p>Loading client permissions…</p>
          )}
        </main>
      </div>
    </div>
  );
}
