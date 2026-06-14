/** Wire mirror of the core control session listing. */
export interface SessionDto {
  alias: string;
  agent: string;
  workspace: string;
  transportSession: string;
  running: boolean;
}

/** Wire DTO for a configured agent on an instance. */
export interface AgentDto {
  name: string;
  driver: string;
}

/** Wire DTO for a machine-available agent driver and its readiness. */
export interface AgentCatalogEntryDto {
  driver: string;
  configured: boolean;
  installed: "builtin" | "yes" | "unknown";
}

/** Wire DTO for a configured workspace on an instance. */
export interface WorkspaceDto {
  name: string;
  cwd: string;
  description?: string;
}

// Keep in sync with ScheduledTaskStatus in src/scheduled/scheduled-types.ts
export type ScheduledTaskStatusDto =
  | "pending"
  | "triggering"
  | "executed"
  | "cancelled"
  | "missed"
  | "failed";

/** Wire DTO for a scheduled task; maps from core ScheduledTaskRecord. */
export interface ScheduledTaskDto {
  id: string;
  sessionAlias: string;
  executeAt: string;
  message: string;
  status: ScheduledTaskStatusDto;
  createdAt: string;
}

// Keep in sync with OrchestrationTaskStatus in src/orchestration/orchestration-types.ts
export type OrchestrationTaskStatusDto =
  | "needs_confirmation"
  | "queued"
  | "running"
  | "blocked"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

/** Wire DTO for an orchestration task; projected from core OrchestrationTaskRecord. */
export interface OrchestrationTaskDto {
  taskId: string;
  status: OrchestrationTaskStatusDto;
  targetAgent: string;
  workspace: string;
  task: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** Wire mirror of src/control ControlEvent. */
export type ControlEventDto =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };
