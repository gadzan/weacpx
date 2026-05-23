export const LATER_MIN_DELAY_MS = 10_000;
export const LATER_MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const LATER_MESSAGE_PREVIEW_CHARS = 120;

export type ScheduledTaskStatus =
  | "pending"
  | "triggering"
  | "executed"
  | "cancelled"
  | "missed"
  | "failed";

export interface ScheduledTaskRecord {
  id: string;
  chat_key: string;
  session_alias: string;
  execute_at: string;
  message: string;
  status: ScheduledTaskStatus;
  created_at: string;
  account_id?: string;
  reply_context_token?: string;
  source_label?: string;
  triggered_at?: string;
  executed_at?: string;
  cancelled_at?: string;
  missed_at?: string;
  failed_at?: string;
  last_error?: string;
}
