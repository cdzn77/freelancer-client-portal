"use client";
import { brand } from "../lib/brand";

import { readStudioLocation, locationUrl } from "@/lib/studio-location";
import { TaskDetail } from "./task-detail";
import { StudioMark } from "./studio-mark";
import { ClientDocuments } from "./client-documents";
import { DashboardBoard } from "./dashboard-board";
import { Select } from "./select";
import { IntakeLinks } from "./intake-links";
import { EmailSettings } from "./email-settings";
import { TaskFieldInputs, TaskFieldsView } from "./task-fields";
import { ClientProfitability } from "./client-profitability";
import { TeamCapacityView } from "./team-capacity";
import { RequestsView, BlueprintsView } from "./studio-intake";
import { InboxView, InsightsView } from "./studio-insights";
import { ProjectColorPicker, ProjectShape, ShapePicker } from "./project-shape";
import { MonitorView } from "./monitor";
import { ClientNavigation } from "./client-navigation";
import { BrandLogo } from "@/components/brand";
import { useCallback, useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  CheckCheck,
  FolderClosed,
  Clock3,
  CalendarDays,
  ReceiptText,
  UsersRound,
  Settings2,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Bell,
  Menu,
  X,
  LogOut,
  Sparkles,
  PanelLeftClose,
  CircleHelp,
  Command,
  Sun,
  Grid2X2,
  List,
  SlidersHorizontal,
  Check,
  Play,
  Square,
  MoreHorizontal,
  MessageSquare,
  FileText,
  Download,
  Send,
  Link2,
  CornerDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/lib/supabase";
import {
  Data,
  Workspace,
  Task,
  Project,
  Financial,
  emptyData,
  money,
  dateLabel,
  total,
} from "@/lib/types";
import {
  Avatar,
  Badge,
  Empty,
  Field,
  Modal,
  Panel,
  Progress,
  Stat,
  statusTone,
} from "./ui";
import { AvatarProvider } from "./avatar-provider";
import { AccountView, accountName } from "./account";
import { WorkView } from "./work";
import { ProjectView } from "./projects";
import { roleLabel } from "./access";
import { useLocationTab } from "@/lib/use-location-tab";
import { TimeView, FinanceView, PortalView, SettingsView } from "./modules";
export type StudioContext = {
  readOnly?: boolean;
  data: Data;
  workspace: Workspace;
  userId: string;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  mutate: (
    table: string,
    values: Record<string, unknown>,
    id?: string,
  ) => Promise<boolean>;
  openTask: (task?: Task, projectId?: string, parentId?: string) => void;
  editTask?: (task: Task) => void;
  openProject: (project?: Project) => void;
  selectProject: (id: string, section?: string) => void;
};
function activeContext(ctx: StudioContext): StudioContext {
  const projects = ctx.data.projects.filter(
    (p) => !p.archived_at && !p.deleted_at,
  );
  const ids = new Set(projects.map((p) => p.id));
  return {
    ...ctx,
    data: {
      ...ctx.data,
      projects,
      tasks: ctx.data.tasks.filter((t) => ids.has(t.project_id)),
      resource_bookings: ctx.data.resource_bookings.filter((b) =>
        ids.has(b.project_id),
      ),
    },
  };
}
const nav = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Projects", icon: FolderClosed },
  { label: "Inbox", icon: Bell },
  { label: "Requests", icon: FileText },
  { label: "Documents & payments", icon: FileText },
  { label: "Blueprints", icon: Grid2X2 },
  { label: "Studio insights", icon: SlidersHorizontal },
  { label: "Team capacity", icon: UsersRound },
  { label: "Custom fields", icon: SlidersHorizontal },
  { label: "Client profitability", icon: ReceiptText },
  { label: "My tasks", icon: CheckCheck },
  { label: "Calendar", icon: CalendarDays },
  { label: "Time tracking", icon: Clock3 },
  { label: "Financials", icon: ReceiptText },
  { label: "Website Monitor", icon: LayoutDashboard },
];
function groupNavigation<T extends { label: string }>(
  items: T[],
): [string, T[]][] {
  const groups: [string, string[]][] = [
    ["Start", ["Overview", "Client portal", "Projects", "Requests", "Inbox"]],
    ["Work", ["My tasks", "Calendar", "Time tracking"]],
    [
      "Business",
      ["Documents & payments", "Financials", "Client profitability"],
    ],
    [
      "Studio",
      [
        "Blueprints",
        "Studio insights",
        "Team capacity",
        "Custom fields",
        "Website Monitor",
      ],
    ],
  ];
  return groups
    .map(
      ([label, keys]) =>
        [label, items.filter((i) => keys.includes(i.label))] as [string, T[]],
    )
    .filter(([, entries]) => entries.length > 0);
}
export function Studio({ session }: { session: Session }) {
  const [requestComposer, setRequestComposer] = useState(false);
  const [clientView, setClientView] = useLocationTab("clientView", "Home", [
    "Home",
    "Projects",
    "Project",
    "Messages",
  ]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [data, setData] = useState<Data>(emptyData),
    [page, setPage] = useState("Overview"),
    [selectedProject, setSelectedProject] = useState(""),
    [projectSection, setProjectSection] = useState("Tasks"),
    [requestToOpen, setRequestToOpen] = useState(""),
    [requestProject, setRequestProject] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [modal, setModal] = useState<"task" | "project" | "workspace" | null>(null),
    [editTask, setEditTask] = useState<Task | undefined>(),
    [viewTask, setViewTask] = useState<Task | null>(null),
    [editProject, setEditProject] = useState<Project | undefined>(),
    [taskProject, setTaskProject] = useState(""),
    [parent, setParent] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const [locationReady, setLocationReady] = useState("");
  const active = useRef("");
  const refreshSequence = useRef(0);
  const notify = useCallback((message: string) => {
    setNotice(message);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const loadWorkspaces = useCallback(async () => {
    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("workspace_id,role,workspaces(*)")
      .eq("user_id", session.user.id);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const items = (members || []).map((m) => ({
      ...(m.workspaces as unknown as Workspace),
      role: m.role,
    }));
    setWorkspaces(items);
    setWorkspace((w) => {
      const requested = new URLSearchParams(window.location.search).get(
        "workspace",
      );
      const next =
        items.find((i) => i.id === w?.id) ||
        items.find((i) => i.id === requested) ||
        items[0] ||
        null;
      return JSON.stringify(w) === JSON.stringify(next) ? w : next;
    });
    if (!items.length) setLoading(false);
  }, [session.user.id]);
  useEffect(() => {
    loadWorkspaces();
    const channel = new BroadcastChannel("pms-workspaces-changed");
    channel.onmessage = () => loadWorkspaces();
    window.addEventListener("focus", loadWorkspaces);
    const timer = setInterval(loadWorkspaces, 30000);
    return () => {
      channel.close();
      window.removeEventListener("focus", loadWorkspaces);
      clearInterval(timer);
    };
  }, [loadWorkspaces]);
  const refresh = useCallback(async () => {
    if (!workspace) return;
    const id = workspace.id;
    const sequence = ++refreshSequence.current;
    active.current = id;
    setError("");
    const tables = [
      "scope_changes",
      "review_stages",
      "email_preferences",
      "studio_email_jobs",
      "work_requests",
      "deliverables",
      "deliverable_versions",
      "review_feedback",
      "studio_notifications",
      ...(workspace.role === "client"
        ? []
        : [
            "studio_blueprints",
            "blueprint_applications",
            "saved_task_views",
            "task_recurrences",
            "team_capacity",
            "team_schedule_days",
            "team_schedule_status",
            "team_time_off",
            "task_field_definitions",
            "resource_bookings",
            "task_allocations",
            "invoice_sources",
            "client_accounts",
            "project_groups",
            "task_code_links",
            "project_expenses",
            "invoice_receipts",
            "intake_links",
          ]),
      "projects",
      "project_shared_briefs",
      "project_members",
      "project_files",
      ...(workspace.role === "client" ? [] : ["project_details"]),
      "tasks",
      "comments",
      "discussion_threads",
      "approvals",
      ...(workspace.role === "client"
        ? []
        : [
            "time_entries",
            "budgets",
            "invoices",
            "estimates",
            "retainers",
            "dependencies",
            "templates",
          ]),
    ];
    const results = await Promise.all(
      tables.map(async (t) => {
        const rows: Record<string, unknown>[] = [];
        const keys: Record<string, string[]> = {
          team_capacity: ["user_id"],
          team_schedule_days: ["user_id", "work_date"],
          project_members: ["project_id", "user_id"],
          project_details: ["project_id"],
          project_shared_briefs: ["project_id"],
          dependencies: ["task_id", "depends_on_id"],
          email_preferences: ["user_id"],
        };
        for (let offset = 0; ; offset += 500) {
          let query = supabase.from(t).select("*").eq("workspace_id", id);
          for (const key of keys[t] || ["id"]) query = query.order(key);
          const result = await query.range(offset, offset + 499);
          if (result.error) return { data: null, error: result.error };
          rows.push(...(result.data ?? []));
          if ((result.data?.length ?? 0) < 500)
            return { data: rows, error: null };
        }
      }),
    );
    const members = await supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", id);
    if (active.current !== id || sequence !== refreshSequence.current) return;
    const err = results.find((r) => r.error)?.error || members.error;
    if (err) setError(err.message);
    const next = { ...emptyData, members: members.data || [] };
    tables.forEach((t, i) => {
      Object.assign(next, { [t]: results[i].data || [] });
    });
    next.projects = next.projects.map((p) => ({
      ...p,
      shared_brief:
        next.project_shared_briefs.find((d) => d.project_id === p.id)?.body ||
        "",
      brief:
        next.project_details.find((d) => d.project_id === p.id)?.brief || "",
    }));
    setData(next);
    setLoading(false);
  }, [workspace]);
  useEffect(() => {
    active.current = workspace?.id || "";
    setData(emptyData);
    setLoading(true);
    if (workspace) {
      const route = readStudioLocation(window.location.search, workspace.role);
      const matches = route.workspace === workspace.id;
      setPage(
        matches
          ? route.page
          : workspace.role === "client"
            ? "Client portal"
            : "Overview",
      );
      setSelectedProject(matches ? route.project : "");
      setProjectSection(matches ? route.section : "Tasks");
      setLocationReady(workspace.id);
    }
    if (workspace) refresh();
    else setLoading(false);
  }, [workspace, refresh]);
  useEffect(() => {
    if (!workspace || loading || locationReady !== workspace.id || error)
      return;
    const validProject =
      page === "Projects" &&
      data.projects.some(
        (p) =>
          p.id === selectedProject &&
          (!p.deleted_at || workspace.role === "owner"),
      )
        ? selectedProject
        : "";
    if (page === "Projects" && selectedProject && !validProject)
      setSelectedProject("");
    const url = locationUrl(window.location.href, {
      workspace: workspace.id,
      page,
      project: validProject,
      section: projectSection,
    });
    if (url.href !== window.location.href) {
      const sameWorkspace =
        new URLSearchParams(window.location.search).get("workspace") ===
        workspace.id;
      if (sameWorkspace)
        window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
    }
  }, [
    workspace,
    loading,
    locationReady,
    page,
    selectedProject,
    projectSection,
    data.projects,
    error,
  ]);
  useEffect(() => {
    const restore = () => {
      const requested = new URLSearchParams(window.location.search).get(
        "workspace",
      );
      const target = workspaces.find((w) => w.id === requested) || workspace;
      if (!target) return;
      if (target.id !== workspace?.id) {
        setWorkspace(target);
        return;
      }
      const route = readStudioLocation(window.location.search, target.role);
      setPage(route.page);
      setSelectedProject(route.project);
      setProjectSection(route.section);
      setModal(null);
      setMobile(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [workspaces, workspace]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!workspace) return;
    const channel = new BroadcastChannel("pms-records-changed");
    channel.onmessage = () => {
      setModal(null);
      refresh();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      channel.close();
      window.removeEventListener("focus", refresh);
    };
  }, [workspace, refresh]);
  const mutate = async (
    table: string,
    values: Record<string, unknown>,
    id?: string,
  ) => {
    if (!workspace) return false;
    const payload = { ...values, workspace_id: workspace.id };
    const result = id
      ? await supabase
          .from(table)
          .update(payload)
          .eq("id", id)
          .eq("workspace_id", workspace.id)
          .select("id")
      : await supabase.from(table).insert(payload).select("id");
    if (result.error || !result.data?.length) {
      notify(
        result.error?.message ||
          "You no longer have access to change this record.",
      );
      return false;
    }
    if (table === "projects" && "brief" in values) {
      const { error } = await supabase.from("project_details").upsert({
        workspace_id: workspace.id,
        project_id: result.data[0].id,
        brief: values.brief,
      });
      if (error) {
        notify(error.message);
        await refresh();
        return false;
      }
    }
    await refresh();
    return true;
  };
  useEffect(() => {
    setViewTask(null);
  }, [workspace?.id]);
  useEffect(() => {
    if (loading || !workspace || locationReady !== workspace.id) return;
    const url = new URL(window.location.href),
      id = url.searchParams.get("task");
    const task = data.tasks.find((t) => t.id === id);
    if (task) {
      setViewTask(task);
      url.searchParams.delete("task");
      history.replaceState(history.state, "", url);
    }
  }, [loading, workspace, locationReady, data.tasks]);
  const openTaskEditor = (
    task?: Task,
    projectId?: string,
    parentId?: string,
  ) => {
    setEditTask(task);
    setTaskProject(
      task?.project_id ||
        projectId ||
        selectedProject ||
        data.projects.find((p) => !p.archived_at && !p.deleted_at)?.id ||
        "",
    );
    setParent(task?.parent_task_id || parentId || null);
    setModal("task");
  };
  const openTask = (task?: Task, projectId?: string, parentId?: string) => {
    if (task) {
      setViewTask(task);
      setModal(null);
    } else openTaskEditor(undefined, projectId, parentId);
  };
  const openProject = (project?: Project) => {
    setEditProject(project);
    setModal("project");
  };
  const selectProject = (id: string, section = "Tasks") => {
    if (workspace?.role === "client") {
      const url = new URL(window.location.href);
      url.searchParams.set("clientProject", id);
      url.searchParams.set(
        "clientSection",
        (
          {
            Tasks: "Tasks",
            Review: "Feedback",
            Discussions: "Messages",
            Files: "Files",
            Timeline: "Timeline",
            Calendar: "Timeline",
          } as Record<string, string>
        )[section] || "Overview",
      );
      url.searchParams.set("clientView", "Project");
      window.history.pushState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      setClientView("Project");
      setSelectedProject("");
      setPage("Client portal");
      setMobile(false);
      return;
    }
    setProjectSection(section);
    setSelectedProject(id);
    setPage("Projects");
    setMobile(false);
  };
  const ctx: StudioContext | null = workspace
    ? {
        data,
        workspace,
        userId: session.user.id,
        refresh,
        notify,
        mutate,
        openTask,
        editTask: (task: Task) => {
          setViewTask(null);
          openTaskEditor(task);
        },
        openProject,
        selectProject,
      }
    : null;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      if (modal === "workspace") {
        const { error } = await supabase.rpc("create_workspace", {
          workspace_name: f.get("name"),
        });
        if (error) throw error;
        await loadWorkspaces();
        notify("Workspace created");
        setModal(null);
      } else if (modal === "project") {
        const ok = await mutate(
          "projects",
          {
            name: f.get("name"),
            client_name: f.get("client_name"),
            description: f.get("description"),
            brief: f.get("brief"),
            type: f.get("type"),
            due_date: f.get("due_date") || null,
            start_date:
              f.get("start_date") || new Date().toISOString().slice(0, 10),
            color: f.get("color"),
            shape_id: Number(f.get("shape_id") || 1),
          },
          editProject?.id,
        );
        if (ok) {
          setModal(null);
          notify(editProject ? "Project updated" : "Project created");
        }
      } else {
        const fields: Record<string, string> = { ...editTask?.custom_fields };
        for (const d of data.task_field_definitions.filter(
          (d) => !d.archived,
        )) {
          const value = String(f.get(`custom_${d.id}`) || "");
          if (value) fields[`field:${d.id}`] = value;
          else delete fields[`field:${d.id}`];
        }
        const ok = await mutate(
          "tasks",
          {
            title: f.get("title"),
            description: f.get("description"),
            project_id: editTask?.project_id || f.get("project_id"),
            parent_task_id: parent,
            status: f.get("status"),
            priority: f.get("priority"),
            assignee_id: f.get("assignee_id") || null,
            due_date: f.get("due_date") || null,
            start_date: f.get("task_start") || null,
            schedule_pinned: f.get("schedule_pinned") === "on",
            custom_fields: fields,
            remaining_minutes:
              f.get("remaining_minutes") === ""
                ? null
                : Number(f.get("remaining_minutes")),
            phase: String(f.get("phase") || ""),
            estimated_minutes: Number(f.get("estimated_minutes") || 0),
          },
          editTask?.id,
        );
        if (ok) {
          setModal(null);
          notify(editTask ? "Task updated" : "Task added");
        }
      }
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : String((e as { message?: string }).message || e),
      );
    } finally {
      setSaving(false);
    }
  }
  const canEdit =
    !!workspace && ["owner", "member", "contractor"].includes(workspace.role);
  return (
    <AvatarProvider
      userIds={[session.user.id, ...data.members.map((m) => m.user_id)]}
    >
      <div
        className={`app-shell ${workspace?.role === "client" ? "client-shell" : ""}`}
      >
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
          <div className="brand">
            <div className="brand-lockup">
              <BrandLogo />
              <small>STUDIO WORKSPACE</small>
            </div>
            <button
              className="icon-button mobile-only"
              onClick={() => setMobile(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>
          <div className="workspace-switch">
            <Select
              aria-label="Workspace"
              className="workspace-select"
              value={workspace?.id || ""}
              onChange={(e) => {
                const next = workspaces.find((w) => w.id === e.target.value);
                if (next) setWorkspace(next);
              }}
              triggerContent={
                <>
                  <span className="workspace-icon" aria-hidden="true">
                    C
                  </span>
                  <span className="workspace-copy">
                    <span>{workspace?.name || "Choose workspace"}</span>
                    <small>
                      {workspace?.role === "client"
                        ? "Client space"
                        : "Creative studio"}
                    </small>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </>
              }
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              {!workspaces.length && (
                <option value="" disabled>
                  Create a workspace
                </option>
              )}
            </Select>
          </div>
          <button
            className="sidebar-search"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} />
            <span>Find anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="Main navigation">
            {groupNavigation(
              workspace?.role === "client"
                ? [
                    { label: "Client portal", icon: UsersRound },
                    { label: "Requests", icon: FileText },
                    { label: "Documents & payments", icon: FileText },
                    { label: "Inbox", icon: Bell },
                  ]
                : nav.filter(
                    (n) =>
                      ![
                        "Financials",
                        "Website Monitor",
                        "Studio insights",
                        "Custom fields",
                        "Client profitability",
                      ].includes(n.label) || workspace?.role === "owner",
                  ),
            ).map(([group, entries]) => (
              <details
                className="nav-group"
                key={group}
                open={
                  group === "Start" || entries.some((n) => n.label === page)
                }
              >
                <summary>{group}</summary>
                {entries.map((n) => (
                  <button
                    key={n.label}
                    aria-label={n.label}
                    aria-current={page === n.label ? "page" : undefined}
                    className={`nav-item ${page === n.label ? "active" : ""}`}
                    onClick={() => {
                      setRequestToOpen("");
                      setRequestProject("");
                      setPage(n.label);
                      setSelectedProject("");
                      setMobile(false);
                    }}
                  >
                    <n.icon size={18} />
                    <span>{n.label}</span>
                    {n.label === "Inbox" &&
                      data.studio_notifications.some(
                        (n) => !n.read_at && !n.archived_at && !n.deleted_at,
                      ) && (
                        <span className="nav-count">
                          {
                            data.studio_notifications.filter(
                              (n) =>
                                !n.read_at && !n.archived_at && !n.deleted_at,
                            ).length
                          }
                        </span>
                      )}
                    {n.label === "My tasks" && (
                      <span className="nav-count">
                        {
                          data.tasks.filter(
                            (t) =>
                              data.projects.some(
                                (p) =>
                                  p.id === t.project_id &&
                                  !p.archived_at &&
                                  !p.deleted_at,
                              ) &&
                              t.assignee_id === session.user.id &&
                              t.status !== "Done",
                          ).length
                        }
                      </span>
                    )}
                  </button>
                ))}
              </details>
            ))}
          </nav>
          <div className="nav-label projects-label">
            <span>PINNED PROJECTS</span>
            {workspace?.role === "owner" && (
              <button
                className="icon-button"
                aria-label="Create project"
                onClick={() => openProject()}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
          <div className="pinned-projects">
            {data.projects
              .filter((p) => !p.archived_at && !p.deleted_at)
              .slice(0, 4)
              .map((p) => (
                <button
                  key={p.id}
                  className="pinned"
                  onClick={() =>
                    workspace?.role === "client"
                      ? setPage("Client portal")
                      : selectProject(p.id)
                  }
                >
                  <ProjectShape shape={p.shape_id} className="sidebar-shape" />
                  {p.name}
                  <ChevronRight size={13} />
                </button>
              ))}
          </div>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setModal("workspace")}>
              <Plus size={18} />
              New workspace
            </button>
            {workspace?.role === "owner" && (
              <button
                className={`nav-item ${page === "Settings" ? "active" : ""}`}
                onClick={() => {
                  setPage("Settings");
                  setMobile(false);
                }}
              >
                <Settings2 size={18} />
                Workspace settings
              </button>
            )}
            <button
              className="profile"
              onClick={() => {
                setPage("Profile");
                setSelectedProject("");
                setMobile(false);
              }}
              aria-label="My profile"
              title="My profile"
            >
              <Avatar name={accountName(session)} userId={session.user.id} />
              <span>
                <strong>{accountName(session)}</strong>
                <small>{roleLabel(workspace?.role || "Studio member")}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>
        {mobile && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <div className="main-shell">
          {workspace?.role === "client" && (
            <ClientNavigation
              page={page}
              view={clientView}
              name={accountName(session)}
              userId={session.user.id}
              onNavigate={(destination) => {
                setSelectedProject("");
                if (destination === "Documents")
                  setPage("Documents & payments");
                else if (["Inbox", "Profile"].includes(destination))
                  setPage(destination);
                else {
                  setPage("Client portal");
                  setClientView(destination);
                }
              }}
            />
          )}
          <header className="topbar">
            <button
              className="header-brand"
              aria-label="Workspace overview"
              onClick={() => {
                setPage(
                  workspace?.role === "client" ? "Client portal" : "Overview",
                );
                setSelectedProject("");
              }}
            >
              <BrandLogo />
            </button>
            <div className="breadcrumbs">
              <button
                className="icon-button mobile-only"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={22} />
              </button>
              <strong>
                {selectedProject
                  ? data.projects.find((p) => p.id === selectedProject)?.name
                  : page}
              </strong>
            </div>
            <button
              className="workspace-command"
              aria-label="Search workspace"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={18} />
              <span>Find anything in your workspace…</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="top-actions">
              <button
                className="icon-button mobile-only"
                aria-label="Search workspace"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={22} />
              </button>
              <button
                className="icon-button"
                aria-label="Open my profile"
                onClick={() => {
                  setPage("Profile");
                  setSelectedProject("");
                }}
              >
                <Avatar name={accountName(session)} userId={session.user.id} />
              </button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {error && (
              <div role="alert" className="error banner">
                {error}
                <button onClick={() => refresh()}>Try again</button>
              </div>
            )}
            {page === "Profile" ? (
              <AccountView session={session} onSaved={refresh} />
            ) : loading || (!!workspace && locationReady !== workspace.id) ? (
              <div className="loading">
                <BrandLogo />
                <p>Gathering your workspace...</p>
              </div>
            ) : !ctx ? (
              <Empty title="A fresh start for your studio">
                <p>Create a workspace to bring your projects together.</p>
                <button
                  className="button primary"
                  onClick={() => setModal("workspace")}
                >
                  <Plus size={16} />
                  Create workspace
                </button>
              </Empty>
            ) : (
              <>
                {page === "Requests" && workspace?.role === "owner" && (
                  <IntakeLinks ctx={ctx} />
                )}
                {page === "Requests" && (
                  <RequestsView
                    key={`${workspace?.id}-${requestToOpen}-${requestProject}-${requestComposer}`}
                    ctx={ctx}
                    initialCreate={requestComposer && !requestToOpen}
                    initialRequestId={requestToOpen}
                    initialProjectId={requestProject}
                    onReturn={() => {
                      setRequestProject("");
                      setPage(
                        workspace?.role === "client"
                          ? "Client portal"
                          : "Overview",
                      );
                    }}
                  />
                )}
                {page === "Team capacity" && workspace?.role !== "client" && (
                  <TeamCapacityView ctx={activeContext(ctx)} />
                )}
                {page === "Custom fields" && workspace?.role === "owner" && (
                  <TaskFieldsView ctx={ctx} />
                )}
                {page === "Client profitability" &&
                  workspace?.role === "owner" && (
                    <ClientProfitability ctx={ctx} />
                  )}
                {page === "Blueprints" && (
                  <BlueprintsView key={workspace?.id} ctx={ctx} />
                )}
                {page === "Inbox" && (
                  <>
                    {" "}
                    <EmailSettings ctx={ctx} />
                    <InboxView
                      ctx={ctx}
                      onOpenRequest={(id) => {
                        setRequestToOpen(id);
                        setPage("Requests");
                      }}
                    />
                  </>
                )}
                {page === "Studio insights" && workspace?.role === "owner" && (
                  <InsightsView ctx={activeContext(ctx)} />
                )}
                {page === "Overview" && (
                  <DashboardBoard key={workspace?.id} ctx={activeContext(ctx)}>
                    <Dashboard ctx={activeContext(ctx)} onPage={setPage} />
                  </DashboardBoard>
                )}
                {page === "My tasks" && (
                  <WorkView ctx={activeContext(ctx)} personal />
                )}
                {page === "Projects" && (
                  <ProjectView
                    ctx={ctx}
                    selectedId={selectedProject}
                    initialSection={projectSection}
                    onSectionChange={setProjectSection}
                  />
                )}
                {page === "Calendar" && (
                  <ProjectView ctx={activeContext(ctx)} calendarOnly />
                )}
                {page === "Time tracking" && <TimeView ctx={ctx} />}
                {page === "Documents & payments" && (
                  <ClientDocuments
                    key={workspace?.id}
                    ctx={ctx}
                    onReturn={() =>
                      setPage(
                        workspace?.role === "client"
                          ? "Client portal"
                          : "Overview",
                      )
                    }
                  />
                )}
                {page === "Financials" && workspace?.role === "owner" && (
                  <FinanceView ctx={ctx} />
                )}
                {page === "Website Monitor" && workspace?.role === "owner" && (
                  <MonitorView key={workspace.id} ctx={ctx} />
                )}
                {page === "Client portal" && (
                  <PortalView
                    view={clientView}
                    onView={setClientView}
                    onNavigate={(next) => {
                      setRequestComposer(false);
                      if (next === "Requests") {
                        setRequestProject("");
                        setRequestToOpen("");
                      }
                      setPage(next);
                    }}
                    ctx={ctx}
                    onRequest={(id) => {
                      setRequestComposer(true);
                      setRequestToOpen("");
                      setRequestProject(id);
                      setPage("Requests");
                    }}
                  />
                )}
                {page === "Settings" && workspace?.role === "owner" && (
                  <SettingsView ctx={ctx} onWorkspaceRefresh={loadWorkspaces} />
                )}
              </>
            )}
          </main>
          <footer className="app-footer">
            <a href="/help/guide.pdf" target="_blank" rel="noreferrer">User guide (PDF)</a>
            <span>
              {brand.name}{" "}
              <span className="footer-star">
                <StudioMark />
              </span>
            </span>
          </footer>
        </div>
        <div className="toast" role="status" aria-live="polite">
          {notice && (
            <span>
              <Check size={16} />
              {notice}
            </span>
          )}
        </div>
        <Modal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          title="Find your next thing"
          description="Search projects and tasks in this workspace."
        >
          <label className="search-box workspace-search-field">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Search projects and tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Try a project or task name..."
            />
          </label>
          <div className="search-results">
            {data.projects
              .filter(
                (p) =>
                  !p.archived_at &&
                  !p.deleted_at &&
                  p.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    selectProject(p.id);
                    setSearchOpen(false);
                  }}
                >
                  <FolderClosed size={18} />
                  <span>
                    {p.name}
                    <small>Project</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            {data.tasks
              .filter(
                (t) =>
                  data.projects.some(
                    (p) =>
                      p.id === t.project_id && !p.archived_at && !p.deleted_at,
                  ) && t.title.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(0, 12)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (canEdit) openTask(t);
                    else selectProject(t.project_id);
                    setSearchOpen(false);
                  }}
                >
                  <CheckCheck size={18} />
                  <span>
                    {t.title}
                    <small>Task</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
        </Modal>
        {viewTask && ctx && (
          <TaskDetail
            ctx={ctx}
            task={data.tasks.find((t) => t.id === viewTask.id) || viewTask}
            onClose={() => setViewTask(null)}
            onEdit={() => {
              setViewTask(null);
              openTaskEditor(
                data.tasks.find((t) => t.id === viewTask.id) || viewTask,
              );
            }}
          />
        )}
        {modal && (modal === "workspace" || ctx) && (
          <Modal
            open
            onClose={() => setModal(null)}
            title={
              modal === "workspace"
                ? "A new space to work"
                : modal === "project"
                  ? editProject
                    ? "Project details"
                    : "Make room for a new project"
                  : editTask
                    ? "Edit task"
                    : parent
                      ? "Add a subtask"
                      : "One step closer"
            }
          >
            <form
              onSubmit={save}
              className="edit-form"
              key={`${modal}-${editTask?.id}-${editProject?.id}`}
            >
              {modal === "workspace" ? (
                <Field label="Workspace name">
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder="Your studio or client name"
                  />
                </Field>
              ) : modal === "project" ? (
                <>
                  <Field label="Project name">
                    <input
                      name="name"
                      required
                      defaultValue={editProject?.name}
                      placeholder="Something worth making"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Client">
                      <input
                        name="client_name"
                        defaultValue={editProject?.client_name}
                        required
                      />
                    </Field>
                    <Field label="Project type">
                      <Select
                        name="type"
                        defaultValue={editProject?.type || "fixed_fee"}
                      >
                        <option value="fixed_fee">Fixed fee</option>
                        <option value="time_materials">
                          Time and materials
                        </option>
                        <option value="retainer">Retainer</option>
                      </Select>
                    </Field>
                    <Field label="Start date">
                      <input
                        type="date"
                        name="start_date"
                        defaultValue={
                          editProject?.start_date ||
                          new Date().toISOString().slice(0, 10)
                        }
                      />
                    </Field>
                    <Field label="Due date">
                      <input
                        type="date"
                        name="due_date"
                        defaultValue={editProject?.due_date}
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Short description">
                    <input
                      name="description"
                      defaultValue={editProject?.description}
                    />
                  </Field>
                  <Field label="Project brief">
                    <textarea
                      name="brief"
                      rows={4}
                      defaultValue={editProject?.brief}
                      placeholder="The goal, the audience, and what success looks like."
                    />
                  </Field>
                  <ShapePicker initial={editProject?.shape_id || 1} />
                  <ProjectColorPicker initial={editProject?.color || "coral"} />
                </>
              ) : (
                <>
                  <Field label="Task name">
                    <input
                      name="title"
                      required
                      defaultValue={editTask?.title}
                      placeholder="What needs to happen?"
                    />
                  </Field>
                  <Field label="Project">
                    <Select
                      name="project_id"
                      value={taskProject}
                      onChange={(e) => setTaskProject(e.target.value)}
                      required
                      disabled={!!editTask}
                    >
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="form-grid">
                    <Field label="Status">
                      <Select
                        name="status"
                        defaultValue={
                          editTask?.status || workspace?.workflow_states[0]
                        }
                      >
                        {workspace?.workflow_states.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Priority">
                      <Select
                        name="priority"
                        defaultValue={editTask?.priority || "Medium"}
                      >
                        {["Low", "Medium", "High"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Due date">
                      <input
                        type="date"
                        name="due_date"
                        defaultValue={editTask?.due_date}
                      />
                    </Field>
                    <Field label="Assigned to">
                      <Select
                        name="assignee_id"
                        defaultValue={editTask?.assignee_id || session.user.id}
                      >
                        <option value="">Unassigned</option>
                        {data.members
                          .filter(
                            (m) =>
                              m.role === "owner" ||
                              (m.role === "client"
                                ? (workspace?.role === "owner" ||
                                    data.project_members.some(
                                      (pm) =>
                                        pm.project_id === taskProject &&
                                        pm.user_id === session.user.id &&
                                        pm.role === "owner",
                                    )) &&
                                  data.project_members.some(
                                    (pm) =>
                                      pm.project_id === taskProject &&
                                      pm.user_id === m.user_id &&
                                      pm.role === "guest",
                                  )
                                : data.projects.find(
                                    (p) => p.id === taskProject,
                                  )?.access_type === "workspace" ||
                                  data.project_members.some(
                                    (pm) =>
                                      pm.project_id === taskProject &&
                                      pm.user_id === m.user_id &&
                                      pm.role !== "guest",
                                  )),
                          )
                          .map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.display_name}
                              {m.role === "client" ? " · Client" : ""}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  </div>
                  <p className="muted">
                    Assigning an invited client shares this task with project
                    clients and enables their Tasks view.
                  </p>
                  <Field label="Description">
                    <textarea
                      name="description"
                      rows={3}
                      defaultValue={editTask?.description}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Phase">
                      <input
                        name="phase"
                        defaultValue={editTask?.phase || ""}
                        maxLength={80}
                      />
                    </Field>
                    <Field label="Estimated minutes">
                      <input
                        name="estimated_minutes"
                        type="number"
                        min={0}
                        max={60000}
                        step={1}
                        defaultValue={editTask?.estimated_minutes || 0}
                      />
                    </Field>
                  </div>
                  <Field label="Task start date">
                    <input
                      type="date"
                      name="task_start"
                      defaultValue={editTask?.start_date || ""}
                    />
                  </Field>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="schedule_pinned"
                      defaultChecked={editTask?.schedule_pinned}
                    />
                    Pin dates against dependency shifts
                  </label>
                  <Field label="Remaining effort (minutes)">
                    <input
                      name="remaining_minutes"
                      type="number"
                      min={0}
                      max={60000}
                      step={1}
                      defaultValue={editTask?.remaining_minutes ?? ""}
                      placeholder="Use original estimate"
                    />
                  </Field>
                  {ctx && (
                    <TaskFieldInputs
                      ctx={ctx}
                      values={editTask?.custom_fields || {}}
                    />
                  )}
                  {editTask && (
                    <a
                      className="button"
                      href={`/?workspace=${workspace?.id}&page=Time%20tracking&timerTask=${editTask.id}`}
                    >
                      Track time for this task
                    </a>
                  )}
                  {editTask && (
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        openTask(undefined, editTask.project_id, editTask.id)
                      }
                    >
                      <CornerDownRight size={16} />
                      Add subtask
                    </button>
                  )}
                </>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={
                    saving || (modal === "task" && !data.projects.length)
                  }
                >
                  {saving ? "Saving..." : "Save changes"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </AvatarProvider>
  );
}
export function Dashboard({
  ctx,
  onPage,
}: {
  ctx: StudioContext;
  onPage: (p: string) => void;
}) {
  const { data, openTask, selectProject, userId } = ctx;
  const hours = data.time_entries.reduce((s, t) => s + t.minutes / 60, 0),
    billable = data.time_entries
      .filter((t) => t.billable)
      .reduce((s, t) => s + t.minutes / 60, 0),
    burn = data.time_entries.reduce(
      (s, t) => s + (t.minutes / 60) * t.bill_rate * (t.billable ? 1 : 0),
      0,
    ),
    cost = data.time_entries.reduce(
      (s, t) => s + (t.minutes / 60) * t.cost_rate,
      0,
    ),
    budget = data.budgets
      .filter((b) => !b.archived_at && !b.deleted_at)
      .reduce((s, b) => s + Number(b.amount), 0),
    budgetBurn = data.time_entries
      .filter(
        (t) =>
          t.billable &&
          data.budgets.some(
            (b) =>
              b.project_id === t.project_id && !b.archived_at && !b.deleted_at,
          ),
      )
      .reduce((sum, t) => sum + (t.minutes / 60) * t.bill_rate, 0),
    done = data.tasks.filter((t) => t.status === "Done").length;
  const upcoming = data.tasks
    .filter((t) => t.status !== "Done")
    .sort((a, b) => (a.due_date || "z").localeCompare(b.due_date || "z"))
    .slice(0, 4);
  const canEdit = ["owner", "member", "contractor"].includes(
    ctx.workspace.role,
  );
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = d.toISOString().slice(0, 10);
    const rows = data.time_entries.filter((t) => t.entry_date === key);
    return {
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      billable: rows
        .filter((t) => t.billable)
        .reduce((s, t) => s + t.minutes / 60, 0),
      total: rows.reduce((s, t) => s + t.minutes / 60, 0),
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Sun size={14} /> YOUR STUDIO, AT A GLANCE
          </div>
          <h1>
            Workspace overview<span className="coral-text">.</span>
          </h1>
          <p>Projects, time, and budgets across your workspace.</p>
        </div>
        {ctx.workspace.role === "owner" && (
          <button className="button primary" onClick={() => ctx.openProject()}>
            <Plus size={17} />
            New project
          </button>
        )}
      </div>
      <div className="dashboard-stats">
        <Stat
          label="Active projects"
          value={String(
            data.projects.filter((p) => p.status !== "Done").length,
          ).padStart(2, "0")}
          note="Good things in the making"
          tone="highlight"
        >
          <span className="mini-spark">
            <StudioMark />
          </span>
        </Stat>
        <Stat
          label="Tasks completed"
          value={`${done}`}
          note={`${data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0}% of all tasks`}
        >
          <div className="mini-bars">
            {[35, 50, 43, 65, 58, 85, 100].map((v, i) => (
              <i key={i} style={{ height: v + "%" }} />
            ))}
          </div>
        </Stat>
        <Stat
          label="Billable utilization"
          value={`${hours ? Math.round((billable / hours) * 100) : 0}%`}
          note={`${billable.toFixed(1)} of ${hours.toFixed(1)} hours`}
        >
          <span className="stat-pill">Tracked time</span>
        </Stat>
        {ctx.workspace.role === "owner" ? (
          <Stat
            label="Budget remaining"
            value={money(budget - budgetBurn)}
            note={`${money(budgetBurn)} used of ${money(budget)}`}
          >
            <div
              className="tiny-ring"
              style={
                {
                  "--value": `${budget ? (budgetBurn / budget) * 100 : 0}%`,
                } as React.CSSProperties
              }
            />
          </Stat>
        ) : (
          <Stat
            label="Open tasks"
            value={String(data.tasks.length - done)}
            note="Across projects you can access"
          />
        )}
      </div>
      <div className="dashboard-main">
        <Panel
          title="Projects in motion"
          subtitle="Current projects and delivery progress."
          action={
            <button className="text-button" onClick={() => onPage("Projects")}>
              All projects
              <ArrowUpRight size={15} />
            </button>
          }
        >
          <div className="project-cards">
            {data.projects.slice(0, 3).map((p, i) => {
              const tasks = data.tasks.filter((t) => t.project_id === p.id),
                progress = tasks.length
                  ? (tasks.filter((t) => t.status === "Done").length /
                      tasks.length) *
                    100
                  : 0;
              return (
                <button
                  className="project-card"
                  key={p.id}
                  onClick={() => selectProject(p.id)}
                >
                  <div className="project-card-top">
                    <span className={`project-symbol ${p.color}`}>
                      <ProjectShape shape={p.shape_id} />
                    </span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </div>
                  <small>{p.client_name.toUpperCase()}</small>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <div className="progress-label">
                    <span>Progress</span>
                    <strong>{Math.round(progress)}%</strong>
                  </div>
                  <Progress value={progress} color={p.color} />
                  <div className="project-card-foot">
                    <div className="avatar-stack">
                      {data.members.slice(0, 3).map((m, i) => (
                        <Avatar
                          key={m.user_id}
                          userId={m.user_id}
                          name={m.display_name}
                          index={i}
                        />
                      ))}
                    </div>
                    <span>
                      <CalendarDays size={13} />
                      {dateLabel(p.due_date)}
                    </span>
                  </div>
                </button>
              );
            })}
            {!data.projects.length && (
              <Empty title="Your next project starts here" />
            )}
          </div>
        </Panel>
        <Panel
          title="Your week, in focus"
          subtitle="Time well spent."
          action={<span className="subtle-tag">Last 7 days</span>}
          className="week-panel"
        >
          <div className="hours-summary">
            <strong>
              {week.reduce((s, d) => s + d.total, 0).toFixed(1)}
              <span> hrs</span>
            </strong>
            <span>
              <i className="legend-dot coral" />
              Billable
            </span>
          </div>
          <div
            className="chart"
            role="img"
            aria-label={`Time tracked over the last seven days, ${week.reduce((s, d) => s + d.total, 0).toFixed(1)} total hours`}
          >
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart
                data={week}
                margin={{ top: 10, right: 0, bottom: 0, left: -30 }}
              >
                <defs>
                  <linearGradient id="hoursFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1b1b1b" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#1b1b1b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#6c6c68" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#6c6c68" }}
                />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="billable"
                  stroke="#1b1b1b"
                  strokeWidth={2}
                  fill="url(#hoursFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {ctx.workspace.role === "owner" && (
            <div className="week-bottom">
              <span>Estimated contribution</span>
              <strong>{money(burn - cost)}</strong>
            </div>
          )}
        </Panel>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="Up next"
          subtitle="Small steps. Meaningful work."
          action={
            <button className="text-button" onClick={() => onPage("My tasks")}>
              View tasks
              <ArrowUpRight size={15} />
            </button>
          }
        >
          <div className="task-list">
            {upcoming.map((t) => (
              <div className="task-row" key={t.id}>
                <button
                  className="check-circle"
                  disabled={!canEdit}
                  aria-label={`Complete ${t.title}`}
                  onClick={() => ctx.mutate("tasks", { status: "Done" }, t.id)}
                >
                  <Check size={12} />
                </button>
                <button
                  className="task-name"
                  onClick={() =>
                    canEdit ? openTask(t) : selectProject(t.project_id)
                  }
                >
                  <strong>{t.title}</strong>
                  <small>
                    {data.projects.find((p) => p.id === t.project_id)?.name}
                  </small>
                </button>
                <Badge
                  tone={
                    t.priority === "High"
                      ? "rose"
                      : t.priority === "Medium"
                        ? "amber"
                        : "green"
                  }
                >
                  {t.priority}
                </Badge>
                <span className="task-date">{dateLabel(t.due_date)}</span>
                <Avatar
                  userId={t.assignee_id}
                  name={
                    data.members.find((m) => m.user_id === t.assignee_id)
                      ?.display_name || "Unassigned"
                  }
                />
              </div>
            ))}
          </div>
          {canEdit && (
            <button className="add-task-inline" onClick={() => openTask()}>
              <Plus size={16} />
              Add a task
            </button>
          )}
        </Panel>
        <section className="focus-card">
          <div className="focus-label">
            <span>
              <Sparkles size={16} /> ROOM TO FOCUS
            </span>
            <span>
              <StudioMark />
            </span>
          </div>
          <h2>
            One thing at a time.
            <br />
            Make it a good one.
          </h2>
          <p>
            {upcoming.length
              ? `Start with “${upcoming[0].title}”. A little momentum goes a long way.`
              : "Your list is clear. Take a breath, then make room for something new."}
          </p>
          <button
            className="button dark"
            onClick={() => onPage("Time tracking")}
          >
            <Play size={14} />
            Start a focus session
            <ArrowUpRight size={16} />
          </button>
          <div className="focus-orbit" aria-hidden="true" />
        </section>
      </div>
      <div className="dashboard-end">
        <span className="online-dot" />
        <span>
          Your workspace is up to date. You’re right where you need to be.
        </span>
      </div>
    </>
  );
}
