import type { Locale } from "../i18n/resolve-locale";

export type PermissionMode = "approve-all" | "approve-reads" | "deny-all";
export type NonInteractivePermissions = "deny" | "fail";
export type ReplyMode = "stream" | "final" | "verbose";
/** @deprecated Use ReplyMode. */
export type WechatReplyMode = ReplyMode;

export interface ChannelConfig {
  type: string;
  replyMode: ReplyMode;
  options?: Record<string, unknown>;
}

/** @deprecated Legacy input shape only. Use ChannelConfig. */
export interface WechatConfig {
  replyMode: ReplyMode;
}

export interface TransportConfig {
  type: "acpx-cli" | "acpx-bridge";
  command?: string;
  sessionInitTimeoutMs?: number;
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
  permissionPolicy?: string;
  /**
   * Idle TTL (seconds) passed to acpx as `--ttl` on prompt commands. Governs how
   * long the acpx queue owner (and the warm ACP agent it holds) survives between
   * prompts, so follow-up messages in a conversation skip the agent cold start.
   * `0` keeps the owner alive forever. Defaults to 1800 (30 min).
   */
  queueOwnerTtlSeconds?: number;
}

export type LoggingLevel = "error" | "info" | "debug";

export interface PerfLogConfig {
  enabled: boolean;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays: number;
}

export interface LoggingConfig {
  level: LoggingLevel;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays: number;
  perf: PerfLogConfig;
}

export interface AgentConfig {
  driver: string;
  command?: string;
}

export interface WorkspaceConfig {
  cwd: string;
  description?: string;
}

export interface OrchestrationConfig {
  maxPendingAgentRequestsPerCoordinator: number;
  allowWorkerChainedRequests: boolean;
  allowedAgentRequestTargets: string[];
  allowedAgentRequestRoles: string[];
  progressHeartbeatSeconds: number;
  maxParallelTasksPerAgent: number;
}

export type LaterDefaultMode = "temp" | "bind";

export interface LaterConfig {
  defaultMode: LaterDefaultMode;
}

export interface ChannelRuntimeConfig {
  id: string;
  type: string;
  enabled: boolean;
  replyMode?: ReplyMode;
  options?: Record<string, unknown>;
}

export interface PluginConfig {
  name: string;
  version?: string;
  enabled: boolean;
}

export interface AppConfig {
  transport: TransportConfig;
  logging: LoggingConfig;
  channel: ChannelConfig;
  channels: ChannelRuntimeConfig[];
  plugins: PluginConfig[];
  agents: Record<string, AgentConfig>;
  workspaces: Record<string, WorkspaceConfig>;
  orchestration: OrchestrationConfig;
  later?: LaterConfig;
  language?: Locale;
}
