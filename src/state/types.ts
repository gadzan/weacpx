import { createEmptyOrchestrationState, type OrchestrationState } from "../orchestration/orchestration-types";

export interface LogicalSession {
  alias: string;
  agent: string;
  workspace: string;
  transport_session: string;
  transport_agent_command?: string;
  mode_id?: string;
  reply_mode?: "stream" | "final" | "verbose";
  created_at: string;
  last_used_at: string;
}

export interface ChatContextState {
  current_session: string;
}

export interface AppState {
  sessions: Record<string, LogicalSession>;
  chat_contexts: Record<string, ChatContextState>;
  orchestration: OrchestrationState;
}

export function createEmptyState(): AppState {
  return {
    sessions: {},
    chat_contexts: {},
    orchestration: createEmptyOrchestrationState(),
  };
}
