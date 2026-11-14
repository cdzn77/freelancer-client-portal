// Fictional records for the public, browser-only demonstration.
export type Row = Record<string, any>;
export const workspaceId = "10000000-0000-4000-8000-000000000001";
export const ownerId = "20000000-0000-4000-8000-000000000001";
export const clientId = "20000000-0000-4000-8000-000000000004";
export const date = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const id = (group: number, n: number) => `${group}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function createDemoData(): Record<string, Row[]> {
  const common = { workspace_id: workspaceId, created_at: new Date().toISOString(), archived_at: null, deleted_at: null };
  const projects = [
    ["Brand, with a fresh perspective", "Forma Studio", "A thoughtful identity for a new chapter.", "coral", "fixed_fee"],
    ["A better digital experience", "Northstar", "A clearer path from discovery to booking.", "lilac", "time_materials"],
    ["Everyday, a little brighter", "Bloom & Co.", "Creative support for a growing brand.", "green", "retainer"],
  ].map(([name, client_name, description, color, type], i) => ({
    ...common, id: id(3, i + 1), name, client_name, description, color, type,
    status: "Active", start_date: date(-20 + i * 3), due_date: date(12 + i * 8),
    brief: description, shared_brief: description, access_type: "invite_only", shape_id: i + 1,
    client_tools: ["tasks", "files", "discussions", "approvals", "timeline"],
    client_time_report_enabled: true, client_retainer_report_enabled: true,
  }));
  const members = [
    { user_id: ownerId, display_name: "Alex Freelancer", role: "owner" },
    { user_id: id(2, 2), display_name: "Mia Chen", role: "member" },
    { user_id: id(2, 3), display_name: "Jules Rivera", role: "member" },
    { user_id: clientId, display_name: "Alex Morgan", role: "client" },
  ].map(m => ({ ...m, workspace_id: workspaceId }));
  const titles = [
    ["Review brand direction", "Build the visual identity", "Finalize the brand guidelines", "Explore type and color", "Define the creative brief", "Present the initial concepts"],
    ["Map the booking journey", "Design the homepage", "Refine the mobile experience", "Prototype the key flows", "Review accessibility", "Audit the current experience"],
    ["Design the seasonal campaign", "Update the social templates", "Create the monthly newsletter", "Align on campaign goals"],
  ];
  const tasks = titles.flatMap((names, p) => names.map((title, n) => ({
    ...common, id: id(4, p * 10 + n + 1), project_id: projects[p].id, title,
    description: "Bring the latest feedback into the next iteration. Keep the work clear, useful, and considered.",
    status: n > 2 ? "Done" : n === 0 ? "In review" : n === 1 ? "In progress" : "To do",
    priority: n === 0 ? "High" : "Medium", due_date: date(n + p), start_date: date(-3),
    assignee_id: n % 3 ? ownerId : members[1].user_id, parent_task_id: null,
    custom_fields: {}, is_published: true, estimated_minutes: 240, approval_required: false,
  })));
  const time_entries = Array.from({ length: 21 }, (_, n) => ({
    ...common, id: id(5, n + 1), project_id: projects[n % 3].id,
    description: ["Brand exploration", "Experience design", "Campaign creative"][n % 3],
    minutes: [90, 120, 150][n % 3], entry_date: date(-Math.floor(n / 3)),
    billable: true, bill_rate: 150, cost_rate: 65, status: "Approved", created_by: ownerId,
  }));
  const invoices = projects.map((p, i) => ({
    ...common, id: id(6, i + 1), project_id: p.id, number: `INV-00${i + 1}`,
    client_name: p.client_name, status: i === 0 ? "Paid" : "Sent", due_date: date(14),
    notes: "Fictional demonstration invoice. No payment is requested.",
    lines: [{ description: "Design services, first milestone", quantity: 1, rate: [3600, 5400, 2400][i] }],
  }));
  const documents = projects.map((p, i) => ({
    ...common, id: id(7, i + 1), project_id: p.id, client_id: clientId,
    kind: "Project agreement", title: `${p.client_name} / Creative partnership`, version: 1,
    status: "Shared", due_date: date(14), signature_name: null, decided_at: null, decision_note: null,
    total_cents: [1200000, 1800000, 450000][i], deposit_cents: [600000, 900000, 225000][i],
    content: { business: "Example Studio", client: p.client_name, email: "client@example.com",
      service: "Design services", start: date(-14), end: p.due_date, scope: p.description,
      deliverables: "Discovery, creative direction, design exploration, and a final handoff.",
      terms: "This is a fictional demo document. It creates no agreement or payment obligation.",
      tax_note: "Demonstration only", tax_rate: 0,
      items: [{ description: "Creative direction and design", quantity: 1, unit_cents: [1200000, 1800000, 450000][i] }],
    },
  }));
  const threads = projects.map((p, i) => ({ ...common, id: id(8, i + 1), project_id: p.id,
    task_id: null, title: "The first direction is ready", description: "A place to share feedback and next steps.",
    hidden_from_clients: false, pinned: true, created_by: ownerId, updated_at: new Date().toISOString() }));
  return {
    workspaces: [{ id: workspaceId, name: "Example Studio", workflow_states: ["To do", "In progress", "In review", "Done"] }],
    workspace_members: members, projects, tasks, time_entries, invoices, client_documents: documents,
    project_members: projects.flatMap(p => members.map(m => ({ ...common, project_id: p.id, user_id: m.user_id, role: m.role === "client" ? "guest" : m.role }))),
    project_details: projects.map(p => ({ ...common, project_id: p.id, brief: p.description })),
    project_shared_briefs: projects.map(p => ({ ...common, project_id: p.id, body: p.description })),
    budgets: projects.map((p, i) => ({ ...common, id: id(9, i + 1), project_id: p.id, amount: [12000, 18000, 4500][i] })),
    estimates: invoices.map((r, i) => ({ ...r, id: id(6, i + 11), number: `EST-00${i + 1}`, status: "Draft" })),
    retainers: [{ ...common, id: id(9, 11), project_id: projects[2].id, period: date(0).slice(0, 7) + "-01", hours: 30, rollover: 5, used: 18 }],
    approvals: projects.map((p, i) => ({ ...common, id: id(9, i + 21), project_id: p.id, label: "Visual direction, round one", status: "Pending", is_published: true })),
    discussion_threads: threads,
    discussion_posts: threads.map((t, i) => ({ id: id(8, i + 11), thread_id: t.id, body: "The first round is ready for your review. What feels right, and what would you like to explore further?", created_by: ownerId, created_at: new Date().toISOString(), edited_at: null, reply_to: null, mentions: [], mention_tags: [], can_edit: true })),
    client_accounts: projects.map((p, i) => ({ ...common, id: id(9, i + 31), name: p.client_name })),
    templates: [{ ...common, id: id(9, 41), name: "A thoughtful project kickoff", tasks: ["Gather the brief", "Align on goals", "Define deliverables", "Plan the first review"] }],
    team_capacity: members.filter(m => m.role !== "client").map(m => ({ ...common, user_id: m.user_id, daily_minutes: 480, weekdays: [1, 2, 3, 4, 5] })),
  };
}
