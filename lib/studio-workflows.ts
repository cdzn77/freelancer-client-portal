import { z } from "zod";
export const blueprintStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  phase: z.string().max(80).default("Production"),
  description: z.string().max(2000).default(""),
  offset_days: z.number().int().min(0).max(3650),
  estimated_minutes: z.number().int().min(0).max(60000),
  after_previous: z.boolean().default(false),
  depends_on: z.array(z.number().int().min(1).max(50)).max(50).optional(),
  owner_role: z.enum(["unassigned", "lead", "client", "reviewer"]).optional(),
  shared: z.boolean().optional(),
  approval_gate: z.boolean().optional(),
});
export const planSchema = z.object({
  steps: z
    .array(blueprintStepSchema)
    .min(1)
    .max(50)
    .superRefine((steps, ctx) => {
      steps.forEach((s, i) => {
        if ((s.depends_on || []).some((n) => n > i))
          ctx.addIssue({
            code: "custom",
            message: "Dependencies must reference an earlier step",
            path: [i, "depends_on"],
          });
        if (s.owner_role === "client" && !s.shared)
          ctx.addIssue({
            code: "custom",
            message: "Client-owned steps must be shared",
            path: [i, "shared"],
          });
      });
    }),
});
export type BlueprintStep = z.infer<typeof blueprintStepSchema>;
export type Blueprint = StudioItemState & {
  setup?: { ux_audit?: boolean };
  revision: number;
  id: string;
  name: string;
  description: string;
  steps: BlueprintStep[];
};
export type WorkRequest = StudioItemState & {
  id: string;
  title: string;
  kind: string;
  brief: string;
  client_name: string;
  desired_date: string | null;
  details: Record<string, string>;
  status: string;
  project_id: string | null;
  created_by: string;
  created_at: string;
};
export type Deliverable = StudioItemState & {
  id: string;
  project_id: string;
  title: string;
  current_version_id: string;
};
export type ReviewVersion = {
  id: string;
  project_id: string;
  deliverable_id: string;
  file_id: string;
  version_number: number;
  status: string;
  is_published: boolean;
  note: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};
export type ReviewFeedback = {
  annotation:
    | { type: "image"; x: number; y: number }
    | {
        type: "pdf";
        page: number;
        rect?: { x: number; y: number; width: number; height: number };
      }
    | null;
  resolved_at: string | null;
  resolved_by: string | null;
  id: string;
  project_id: string;
  version_id: string;
  body: string;
  created_by: string;
  created_at: string;
};
export type BlueprintApplication = {
  setup?: { ux_audit?: boolean; workdays?: number[]; holidays?: string[] };
  id: string;
  project_id: string;
  blueprint_id: string;
  blueprint_name: string;
  blueprint_revision: number;
  steps: BlueprintStep[];
  starts_on: string;
  created_at: string;
};
export type StudioNotification = StudioItemState & {
  billing_document_id?: string | null;
  billing_reminder_group?: string | null;
  discussion_id?: string | null;
  task_id?: string | null;
  event_key: string;
  id: string;
  title: string;
  project_id: string | null;
  read_at: string | null;
  created_at: string;
};
export const starterSteps: BlueprintStep[] = [
  {
    title: "Confirm the brief",
    phase: "Discovery",
    description: "Agree scope, deliverables, and success criteria.",
    offset_days: 0,
    estimated_minutes: 60,
    after_previous: false,
  },
  {
    title: "Develop the first direction",
    phase: "Design",
    description: "Prepare the first creative direction for review.",
    offset_days: 3,
    estimated_minutes: 240,
    after_previous: true,
  },
  {
    title: "Client review",
    phase: "Review",
    description: "Share a versioned deliverable and record a decision.",
    offset_days: 5,
    estimated_minutes: 60,
    after_previous: true,
  },
  {
    title: "Prepare final delivery",
    phase: "Delivery",
    description: "Package approved assets and complete handoff.",
    offset_days: 7,
    estimated_minutes: 120,
    after_previous: true,
  },
];

export function notificationDestination(n: StudioNotification) {
  if (n.billing_document_id)
    return { kind: "document" as const, id: n.billing_document_id };
  const [kind, id] = n.event_key.split(":");
  if (["request", "request-converted", "request-declined"].includes(kind))
    return { kind: "request" as const, id };
  if (n.project_id)
    return {
      kind: "project" as const,
      id: n.project_id,
      section:
        n.discussion_id && !n.task_id
          ? "Discussions"
          : kind === "scope"
            ? "Scope changes"
            : kind.startsWith("review")
              ? "Review"
              : "Tasks",
    };
  return null;
}

export type StudioItemState = {
  archived_at: string | null;
  deleted_at: string | null;
};
export type StudioItemView = "Active" | "Archived" | "Trash";
export function inStudioView(item: StudioItemState, view: StudioItemView) {
  return view === "Trash"
    ? !!item.deleted_at
    : view === "Archived"
      ? !!item.archived_at && !item.deleted_at
      : !item.archived_at && !item.deleted_at;
}
