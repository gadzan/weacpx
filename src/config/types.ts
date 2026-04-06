export type PermissionMode = "approve-all" | "approve-reads" | "deny-all";
export type NonInteractivePermissions = "deny" | "fail";
export type WechatReplyMode = "stream" | "final";

export interface TransportConfig {
  type: "acpx-cli" | "acpx-bridge";
  command?: string;
  sessionInitTimeoutMs?: number;
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
}

export type LoggingLevel = "error" | "info" | "debug";

export interface LoggingConfig {
  level: LoggingLevel;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays: number;
}

export interface WechatConfig {
  replyMode: WechatReplyMode;
}

export interface AgentConfig {
  driver: string;
  command?: string;
}

export interface WorkspaceConfig {
  cwd: string;
  description?: string;
}

export interface AppConfig {
  transport: TransportConfig;
  logging: LoggingConfig;
  wechat: WechatConfig;
  agents: Record<string, AgentConfig>;
  workspaces: Record<string, WorkspaceConfig>;
}
