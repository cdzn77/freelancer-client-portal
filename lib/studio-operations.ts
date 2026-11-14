export type TaskFieldDefinition = {
  id: string;
  name: string;
  kind: "text" | "number" | "date" | "select" | "boolean";
  options: string[];
  required: boolean;
  archived: boolean;
};
export type ResourceBooking = {
  id: string;
  project_id: string;
  user_id: string;
  starts_on: string;
  ends_on: string;
  daily_minutes: number;
  tentative: boolean;
  note: string;
};
export type ScopeChange = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  amount: number;
  added_days: number;
  status: string;
  reviewer_id: string | null;
  estimate_id: string | null;
  created_at: string;
};
export type ProjectExpense = {
  task_id?: string | null;
  receipt_file_id?: string | null;
  reimbursable?: boolean;
  id: string;
  project_id: string;
  description: string;
  amount: number;
  expense_date: string;
};
export type InvoiceReceipt = {
  id: string;
  invoice_id: string;
  amount: number;
  received_on: string;
  reference: string;
};
export type ReviewStage = {
  id: string;
  version_id: string;
  position: number;
  reviewer_id: string;
  status: string;
  decided_at: string | null;
};
export type IntakeLink = {
  id: string;
  token: string;
  title: string;
  description: string;
  enabled: boolean;
  expires_on: string | null;
};
export type EmailPreference = { user_id: string; enabled: boolean };
export type EmailJob = {
  id: string;
  user_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};
