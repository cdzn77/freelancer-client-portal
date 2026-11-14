import { createDemoData, ownerId, clientId, workspaceId, type Row } from "./data";

export const demoNotice = "This action needs your own installed portal. Email, payments, uploads, account changes, AI, and external integrations are off in this demo.";
export let database = createDemoData();
let clientView = false;
const ok = (data: any = null) => ({ data, error: null });
const blocked = () => ({ data: null, error: { message: demoNotice } });
export function resetDemo() { database = createDemoData(); }
export function setDemoRole(client: boolean) { clientView = client; }
export function demoSession(): any {
  return { access_token: "demo-only-no-server-access", token_type: "bearer", expires_in: 3600,
    user: { id: clientView ? clientId : ownerId, email: clientView ? "client@example.com" : "studio@example.com",
      user_metadata: { name: clientView ? "Alex Morgan" : "Alex Freelancer" }, app_metadata: {} } };
}
type Filter = (row: Row) => boolean;
class Query implements PromiseLike<any> {
  private filters: Filter[] = [];
  private operation = "read";
  private values: Row[] = [];
  private columns = "*";
  private one = false;
  private orders: [string, boolean][] = [];
  private start = 0;
  private end = Infinity;
  constructor(private table: string) {}
  select(columns = "*") { this.columns = columns; return this; }
  eq(k: string, v: any) { this.filters.push(r => r[k] === v); return this; }
  neq(k: string, v: any) { this.filters.push(r => r[k] !== v); return this; }
  is(k: string, v: any) { this.filters.push(r => (r[k] ?? null) === v); return this; }
  in(k: string, v: any[]) { this.filters.push(r => v.includes(r[k])); return this; }
  gte(k: string, v: any) { this.filters.push(r => r[k] >= v); return this; }
  lte(k: string, v: any) { this.filters.push(r => r[k] <= v); return this; }
  gt(k: string, v: any) { this.filters.push(r => r[k] > v); return this; }
  lt(k: string, v: any) { this.filters.push(r => r[k] < v); return this; }
  not(k: string, op: string, v: any) { this.filters.push(r => op === "is" ? (r[k] ?? null) !== v : r[k] !== v); return this; }
  ilike(k: string, v: string) { this.filters.push(r => String(r[k]).toLowerCase().includes(v.replaceAll("%", "").toLowerCase())); return this; }
  match(values: Row) { Object.entries(values).forEach(([k, v]) => this.eq(k, v)); return this; }
  order(k: string, options?: { ascending?: boolean }) { this.orders.push([k, options?.ascending !== false]); return this; }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  limit(n: number) { this.end = n - 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  insert(values: Row | Row[]) { this.operation = "insert"; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values: Row) { this.operation = "update"; this.values = [values]; return this; }
  upsert(values: Row | Row[]) { this.operation = "upsert"; this.values = Array.isArray(values) ? values : [values]; return this; }
  delete() { this.operation = "delete"; return this; }
  private execute() {
    const table = database[this.table] ||= [];
    let rows = table.filter(r => this.filters.every(f => f(r)));
    if (this.operation !== "read") {
      if (clientView || !["tasks", "projects", "time_entries", "comments", "invoices", "estimates", "budgets", "retainers", "project_details", "project_shared_briefs", "saved_task_views"].includes(this.table)) return blocked();
      if (this.operation === "delete") database[this.table] = table.filter(r => !rows.includes(r));
      else if (this.operation === "update") rows.forEach(r => Object.assign(r, this.values[0]));
      else rows = this.values.map(value => {
        if (this.operation === "upsert") {
          const old = table.find(r => value.id ? r.id === value.id : value.project_id && r.project_id === value.project_id);
          if (old) return Object.assign(old, value);
        }
        const row = { id: crypto.randomUUID(), workspace_id: workspaceId, created_at: new Date().toISOString(),
          created_by: ownerId, archived_at: null, deleted_at: null, parent_task_id: null,
          custom_fields: {}, is_published: true, status: this.table === "projects" ? "Active" : "To do",
          priority: "Medium", client_tools: ["tasks", "files", "discussions", "approvals", "timeline"],
          access_type: "workspace", shape_id: 1, ...value };
        table.push(row); return row;
      });
    }
    if (this.table === "workspace_members" && this.columns.includes("workspaces("))
      rows = rows.map(r => ({ ...r, workspaces: database.workspaces.find(w => w.id === r.workspace_id) }));
    if (clientView && this.table === "tasks") rows = rows.filter(r => r.is_published);
    rows = [...rows].sort((a, b) => {
      for (const [k, asc] of this.orders) { const n = String(a[k] ?? "").localeCompare(String(b[k] ?? "")); if (n) return asc ? n : -n; }
      return 0;
    });
    const count = rows.length;
    rows = rows.slice(this.start, this.end + 1);
    return { ...ok(structuredClone(this.one ? rows[0] ?? null : rows)), count };
  }
  then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }
}
function collaboration(args: Row) {
  const threads = (database.discussion_threads || []).filter(t => t.project_id === args.p_project && (!clientView || !t.hidden_from_clients));
  const thread = threads.find(t => t.id === args.p_thread || (args.p_task && t.task_id === args.p_task)) || null;
  return { threads, thread, has_more_threads: false, has_more_posts: false,
    posts: (database.discussion_posts || []).filter(p => p.thread_id === thread?.id),
    people: database.workspace_members.map(m => ({ ...m, unavailable: false })),
    subscribers: [], reactions: [], attachments: [], typing: [], views: [], reminders: [], teams: [], edit_minutes: null, manager: !clientView };
}
async function rpc(name: string, args: Row = {}) {
  if (["collaboration_snapshot", "preview_client_collaboration"].includes(name)) return ok(collaboration(args));
  if (name === "collaboration_command") {
    const p = args.p_payload || {};
    if (["typing", "view", "open", "subscribe", "ensure_task"].includes(args.p_action)) return ok({ thread: args.p_thread || null });
    if (["create", "create_thread"].includes(args.p_action)) {
      const thread = { id: crypto.randomUUID(), workspace_id: workspaceId, project_id: args.p_project, task_id: null,
        title: p.title, description: p.description || "", hidden_from_clients: !!p.hidden_from_clients, pinned: false,
        created_by: demoSession().user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null };
      database.discussion_threads.push(thread); return ok({ thread: thread.id });
    }
    if (["post", "create_post"].includes(args.p_action)) {
      database.discussion_posts.push({ id: crypto.randomUUID(), thread_id: args.p_thread, body: p.body,
        created_by: demoSession().user.id, created_at: new Date().toISOString(), edited_at: null,
        reply_to: p.reply_to || null, mentions: [], mention_tags: [], can_edit: true });
      return ok({ thread: args.p_thread });
    }
    return blocked();
  }
  if (name === "billing_workspace") return ok({ groups: [], profiles: [] });
  if (name === "task_checkpoint_snapshot") return ok({ required: false, approved: false, manager: !clientView, version: null, document: null, reviews: [], documents: [] });
  if (name === "workspace_role") return ok(clientView ? "client" : "owner");
  if (name === "pms_security_status") return ok({ must_change_password: false, mfa_required: false });
  if (name === "client_time_report") return ok({ entries: database.time_entries.filter(r => r.project_id === args.p_project).map(r => ({ task_id: r.task_id || null, task: r.description, date: r.entry_date, minutes: r.minutes, billable: r.billable, billing_treatment: "covered" })), retainers: database.retainers.filter(r => r.project_id === args.p_project).map(r => ({ ...r, shared_covered_minutes: r.used * 60 })) });
  if (name === "get_project_planning") return ok({ fingerprint: "demo" });
  if (name === "preview_project_registers") return ok(database.project_registers || []);
  if (name === "decide_approval") {
    const row = database.approvals.find(r => r.id === (args.approval_id || args.p_approval || args.a));
    if (row) { row.status = args.decision || args.p_decision || "Approved"; return ok(); }
  }
  return blocked();
}
const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: async () => {}, send: async () => "ok", track: async () => {}, presenceState: () => ({}) };
export const supabase: any = {
  from: (table: string) => new Query(table), rpc,
  channel: () => channel, removeChannel: async () => {},
  auth: { getSession: async () => ok({ session: demoSession() }), getUser: async () => ok({ user: demoSession().user }),
    signOut: async () => { window.dispatchEvent(new Event("demo-exit")); return ok(); },
    updateUser: async () => blocked(), resetPasswordForEmail: async () => blocked(),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: { listFactors: async () => ok({ all: [], totp: [] }), getAuthenticatorAssuranceLevel: async () => ok({ currentLevel: "aal1", nextLevel: "aal1" }), enroll: async () => blocked(), unenroll: async () => blocked(), challengeAndVerify: async () => blocked() } },
  storage: { from: () => ({ createSignedUrls: async () => ok([]), createSignedUrl: async () => blocked(), upload: async () => blocked(), remove: async () => blocked(), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
};
export const passwordLinkFlow = false;
export const authLinkError = "";
// Account reauthentication also resolves to this isolated adapter in demo builds.
export const createClient = () => supabase;

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://demo.invalid");
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const response = (body: any, status = 200) => Response.json(body, { status });
  if (url.pathname === "/api/client-documents" && method === "GET")
    return response({ documents: database.client_documents, payments: [], balances: [], square_ready: false, settings: { cash_app: "", venmo: "", zelle: "" } });
  // No real backend or external provider is contacted, even for unknown actions.
  return response({ error: demoNotice }, 403);
}
