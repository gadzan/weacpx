import type { AgentCatalogEntryDto, AgentDto, ControlEventDto, OrchestrationTaskDto, ScheduledTaskDto, SessionDto, WorkspaceDto } from "./dtos.js";

// Instance <-> relay message types. Convention: chatKey for relay-driven chats
// is `relay:<accountId>`; the relay server stamps chatKey/senderId/isOwner on
// chat-scoped requests server-side (clients cannot forge them).
export const MSG = {
  instanceRegister: "instance.register",
  instanceAuth: "instance.auth",
  instanceEvent: "instance.event",
  instanceNotice: "instance.notice",
  sessionsList: "control.sessions.list",
  sessionsCreate: "control.sessions.create",
  sessionsRemove: "control.sessions.remove",
  agentsList: "control.agents.list",
  workspacesList: "control.workspaces.list",
  workspacesCreate: "control.workspaces.create",
  agentsCatalog: "control.agents.catalog",
  agentsCreate: "control.agents.create",
  agentsRemove: "control.agents.remove",
  workspacesRemove: "control.workspaces.remove",
  prompt: "control.prompt",
  promptCancel: "control.prompt.cancel",
  commandExecute: "control.command.execute",
  scheduledList: "control.scheduled.list",
  scheduledCreate: "control.scheduled.create",
  scheduledCancel: "control.scheduled.cancel",
  orchestrationList: "control.orchestration.list",
  orchestrationGet: "control.orchestration.get",
  orchestrationCancel: "control.orchestration.cancel",
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface ErrorPayload {
  error: { code: string; message: string };
}

export function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } };
}

export function isErrorPayload(payload: unknown): payload is ErrorPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = (payload as Record<string, unknown>).error;
  if (typeof candidate !== "object" || candidate === null) return false;
  const error = candidate as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}

// --- handshake ---
export interface InstanceRegisterPayload {
  pairingToken: string;
  name?: string;
  coreVersion?: string;
}
export interface InstanceRegisterResult {
  instanceId: string;
  credential: string;
}
export interface InstanceAuthPayload {
  instanceId: string;
  credential: string;
  coreVersion?: string;
}
export interface InstanceAuthResult {
  ok: true;
}

// --- instance push ---
export interface InstanceEventPayload {
  event: ControlEventDto;
}
export interface InstanceNoticePayload {
  kind: "task-completion" | "task-progress" | "coordinator-message";
  text: string;
  taskId?: string;
  chatKey?: string;
}

// --- control RPCs (relay -> instance req; instance res) ---
export interface SessionsListPayload {
  /** Server-stamped `relay:<accountId>`; scopes the listing to that channel. */
  chatKey: string;
}
export interface SessionsListResult {
  sessions: SessionDto[];
}
export interface SessionsCreatePayload {
  /** Server-stamped `relay:<accountId>`; scopes the new session to that channel. */
  chatKey: string;
  alias: string;
  agent: string;
  workspace: string;
}
export type SessionsCreateResult = SessionDto;
export interface SessionsRemovePayload {
  /** Server-stamped `relay:<accountId>`; scopes the alias to that channel. */
  chatKey: string;
  alias: string;
}
export interface SessionsRemoveResult {
  wasActive: boolean;
}
export interface AgentsListResult {
  agents: AgentDto[];
}
export interface WorkspacesListResult {
  workspaces: WorkspaceDto[];
}
export interface WorkspacesCreatePayload {
  name: string;
  cwd: string;
  description?: string;
}
export interface WorkspacesCreateResult {
  workspace: WorkspaceDto;
}
export interface AgentsCatalogResult {
  agents: AgentCatalogEntryDto[];
}
export interface AgentsCreatePayload {
  name: string;
  driver: string;
}
export interface AgentsCreateResult {
  agent: AgentDto;
}
export interface AgentsRemovePayload {
  name: string;
}
export interface WorkspacesRemovePayload {
  name: string;
}
export interface OkResult {
  ok: true;
}
export interface PromptPayload {
  chatKey: string;
  sessionAlias: string;
  text: string;
  senderId: string;
  isOwner?: boolean;
}
export interface PromptResult {
  ok: boolean;
  text?: string;
  errorMessage?: string;
}
export interface PromptCancelPayload {
  chatKey: string;
  sessionAlias: string;
}
export interface PromptCancelResult {
  cancelled: boolean;
}
export interface CommandExecutePayload {
  chatKey: string;
  text: string;
  senderId: string;
  isOwner?: boolean;
}
export interface CommandExecuteResult {
  output: string;
}
export interface ScheduledListPayload {
  chatKey: string;
}
export interface ScheduledListResult {
  tasks: ScheduledTaskDto[];
}
export interface ScheduledCreatePayload {
  chatKey: string;
  sessionAlias: string;
  /** ISO timestamp. */
  executeAt: string;
  message: string;
}
export type ScheduledCreateResult = ScheduledTaskDto;
export interface ScheduledCancelPayload {
  id: string;
  chatKey: string;
}
export interface ScheduledCancelResult {
  cancelled: boolean;
}
export interface OrchestrationListResult {
  tasks: OrchestrationTaskDto[];
}
export interface OrchestrationGetPayload {
  taskId: string;
}
export interface OrchestrationGetResult {
  task: OrchestrationTaskDto | null;
}
export interface OrchestrationCancelPayload {
  taskId: string;
}
export type OrchestrationCancelResult = OrchestrationTaskDto;
