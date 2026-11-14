import type { DiscussionThread } from "./collaboration";
import type { ScheduleDay, ScheduleStatus } from "./team-schedule";
import type {
  TaskFieldDefinition,
  ResourceBooking,
  ScopeChange,
  ProjectExpense,
  InvoiceReceipt,
  ReviewStage,
  IntakeLink,
  EmailPreference,
  EmailJob,
} from "./studio-operations";
import type {
  SavedTaskView,
  TaskRecurrence,
  TeamCapacity,
  TeamTimeOff,
} from "./work-planning";
import type {
  Blueprint,
  BlueprintApplication,
  WorkRequest,
  Deliverable,
  ReviewVersion,
  ReviewFeedback,
  StudioNotification,
} from "./studio-workflows";
export type Role = "owner" | "member" | "contractor" | "client";
export type Workspace = {
  id: string;
  name: string;
  workflow_states: string[];
  role: Role;
};
export type Project = {
  client_time_report_enabled?: boolean;
  client_retainer_report_enabled?: boolean;
  client_account_id?: string | null;
  workdays?: number[];
  holidays?: string[];
  archived_at: string | null;
  deleted_at: string | null;
  shape_id: number;
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  brief: string;
  access_type: "invite_only" | "workspace";
  client_tools: string[];
  shared_brief: string;
  type: string;
  status: string;
  color: string;
  start_date: string;
  due_date: string;
  client_name: string;
};
export type Task = {
  approval_required?: boolean;
  approval_version_id?: string | null;
  approval_document_id?: string | null;
  approval_opened_at?: string | null;
  reminder_workdays?: number | null;
  start_date?: string | null;
  schedule_pinned?: boolean;
  remaining_minutes?: number | null;
  estimated_minutes?: number;
  phase?: string;
  is_published: boolean;
  id: string;
  workspace_id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  assignee_id: string | null;
  custom_fields: Record<string, string>;
  created_at: string;
};
export type Entry = {
  task_id?: string | null;
  billing_treatment?: "review" | "invoice" | "covered";
  id: string;
  workspace_id: string;
  project_id: string;
  description: string;
  minutes: number;
  billable: boolean;
  cost_rate: number;
  bill_rate: number;
  status: string;
  entry_date: string;
  created_by: string;
};
export type Budget = {
  archived_at: string | null;
  deleted_at: string | null;
  id: string;
  workspace_id: string;
  project_id: string;
  amount: number;
};
export type Financial = {
  id: string;
  workspace_id: string;
  project_id: string;
  number: string;
  client_name: string;
  status: string;
  due_date: string;
  notes: string;
  lines: { description: string; quantity: number; rate: number }[];
};
export type Retainer = {
  id: string;
  workspace_id: string;
  project_id: string;
  period: string;
  hours: number;
  rollover: number;
  used: number;
};
export type Comment = {
  mentions?: string[];
  edited_at?: string;
  is_published: boolean;
  id: string;
  project_id: string;
  body: string;
  created_at: string;
  created_by: string;
};
export type Approval = {
  is_published: boolean;
  id: string;
  project_id: string;
  label: string;
  status: string;
  created_at: string;
};
export type Member = { user_id: string; role: Role; display_name: string };
export type Data = {
  discussion_threads: DiscussionThread[];
  task_allocations: {
    id: string;
    project_id: string;
    task_id: string;
    user_id: string;
    work_date: string;
    minutes: number;
  }[];
  invoice_sources: {
    id: string;
    invoice_id: string;
    time_entry_id: string | null;
    expense_id: string | null;
    released: boolean;
    snapshot: Record<string, unknown>;
  }[];
  client_accounts: { id: string; name: string }[];
  project_groups: {
    id: string;
    name: string;
    project_ids: string[];
    created_by: string;
  }[];
  task_code_links: {
    id: string;
    project_id: string;
    task_id: string;
    url: string;
    metadata: Record<string, unknown>;
    checked_at: string | null;
  }[];

  task_field_definitions: TaskFieldDefinition[];
  resource_bookings: ResourceBooking[];
  scope_changes: ScopeChange[];
  project_expenses: ProjectExpense[];
  invoice_receipts: InvoiceReceipt[];
  review_stages: ReviewStage[];
  intake_links: IntakeLink[];
  email_preferences: EmailPreference[];
  studio_email_jobs: EmailJob[];

  saved_task_views: SavedTaskView[];
  task_recurrences: TaskRecurrence[];
  team_schedule_days: ScheduleDay[];
  team_schedule_status: ScheduleStatus[];
  team_capacity: TeamCapacity[];
  team_time_off: TeamTimeOff[];
  studio_blueprints: Blueprint[];
  blueprint_applications: BlueprintApplication[];
  work_requests: WorkRequest[];
  deliverables: Deliverable[];
  deliverable_versions: ReviewVersion[];
  review_feedback: ReviewFeedback[];
  studio_notifications: StudioNotification[];
  project_shared_briefs: { project_id: string; body: string }[];
  project_members: {
    project_id: string;
    user_id: string;
    role: "owner" | "member" | "guest";
  }[];
  project_details: { project_id: string; brief: string }[];
  project_files: {
    created_by: string;
    id: string;
    project_id: string;
    name: string;
    path: string;
    is_published: boolean;
  }[];
  projects: Project[];
  tasks: Task[];
  time_entries: Entry[];
  budgets: Budget[];
  invoices: Financial[];
  estimates: Financial[];
  retainers: Retainer[];
  comments: Comment[];
  approvals: Approval[];
  members: Member[];
  dependencies: { task_id: string; depends_on_id: string }[];
  templates: { id: string; name: string; tasks: string[] }[];
};
export const emptyData: Data = {
  discussion_threads: [],
  task_allocations: [],
  invoice_sources: [],
  client_accounts: [],
  project_groups: [],
  task_code_links: [],
  task_field_definitions: [],
  resource_bookings: [],
  scope_changes: [],
  project_expenses: [],
  invoice_receipts: [],
  review_stages: [],
  intake_links: [],
  email_preferences: [],
  studio_email_jobs: [],
  saved_task_views: [],
  task_recurrences: [],
  team_schedule_days: [],
  team_schedule_status: [],
  team_capacity: [],
  team_time_off: [],
  studio_blueprints: [],
  blueprint_applications: [],
  work_requests: [],
  deliverables: [],
  deliverable_versions: [],
  review_feedback: [],
  studio_notifications: [],
  project_shared_briefs: [],
  project_members: [],
  project_details: [],
  project_files: [],
  projects: [],
  tasks: [],
  time_entries: [],
  budgets: [],
  invoices: [],
  estimates: [],
  retainers: [],
  comments: [],
  approvals: [],
  members: [],
  dependencies: [],
  templates: [],
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const dateLabel = (s: string) =>
  s
    ? new Date(s + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "No due date";
export const total = (f: Financial) =>
  f.lines.reduce((n, l) => n + l.quantity * l.rate, 0);
