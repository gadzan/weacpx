import { readFile } from "node:fs/promises";

import { normalizeWorkspacePath } from "../commands/workspace-path";
import { resolveAgentCommand } from "./resolve-agent-command";
import type {
  AgentConfig,
  AppConfig,
  OrchestrationConfig,
  LoggingConfig,
  LoggingLevel,
  NonInteractivePermissions,
  PermissionMode,
  WechatReplyMode,
  WorkspaceConfig,
} from "./types";

const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  level: "info",
  maxSizeBytes: 2 * 1024 * 1024,
  maxFiles: 5,
  retentionDays: 7,
};
const DEFAULT_PERMISSION_MODE: PermissionMode = "approve-all";
const DEFAULT_NON_INTERACTIVE_PERMISSIONS: NonInteractivePermissions = "deny";
const DEFAULT_WECHAT_REPLY_MODE: WechatReplyMode = "verbose";
const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  maxPendingAgentRequestsPerCoordinator: 3,
  allowWorkerChainedRequests: false,
  allowedAgentRequestTargets: [],
  allowedAgentRequestRoles: [],
  progressHeartbeatSeconds: 300,
};

type ParsedAgentRecord = Record<string, AgentConfig & { command?: string }>;
type ParsedWorkspaceRecord = Record<string, WorkspaceConfig & { allowed_agents?: string[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadConfig(path: string): Promise<AppConfig>;
export async function loadConfig(path: string, options: { defaultLoggingLevel?: LoggingLevel }): Promise<AppConfig>;
export async function loadConfig(
  path: string,
  options: { defaultLoggingLevel?: LoggingLevel } = {},
): Promise<AppConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseConfig(raw, options);
}

export function parseConfig(
  raw: unknown,
  options: { defaultLoggingLevel?: LoggingLevel } = {},
): AppConfig {
  if (!isRecord(raw)) {
    throw new Error("config must be a JSON object");
  }

  const transport = raw.transport;
  if (!isRecord(transport)) {
    throw new Error("transport must be an object");
  }
  if (
    "type" in transport &&
    transport.type !== "acpx-cli" &&
    transport.type !== "acpx-bridge"
  ) {
    throw new Error("transport.type must be acpx-cli or acpx-bridge");
  }
  if (
    "sessionInitTimeoutMs" in transport &&
    (typeof transport.sessionInitTimeoutMs !== "number" ||
      !Number.isFinite(transport.sessionInitTimeoutMs) ||
      transport.sessionInitTimeoutMs <= 0)
  ) {
    throw new Error("transport.sessionInitTimeoutMs must be a positive number");
  }
  if (
    "permissionMode" in transport &&
    transport.permissionMode !== "approve-all" &&
    transport.permissionMode !== "approve-reads" &&
    transport.permissionMode !== "deny-all"
  ) {
    throw new Error("transport.permissionMode must be approve-all, approve-reads, or deny-all");
  }
  if (
    "nonInteractivePermissions" in transport &&
    transport.nonInteractivePermissions !== "deny" &&
    transport.nonInteractivePermissions !== "fail"
  ) {
    throw new Error("transport.nonInteractivePermissions must be deny or fail");
  }

  if (!isRecord(raw.agents)) {
    throw new Error("agents must be an object");
  }

  if (!isRecord(raw.workspaces)) {
    throw new Error("workspaces must be an object");
  }

  const logging = raw.logging;
  const wechat = raw.wechat;
  const orchestration = raw.orchestration;
  if (logging !== undefined && !isRecord(logging)) {
    throw new Error("logging must be an object");
  }
  if (wechat !== undefined && !isRecord(wechat)) {
    throw new Error("wechat must be an object");
  }
  if (orchestration !== undefined && !isRecord(orchestration)) {
    throw new Error("orchestration must be an object");
  }
  if (
    isRecord(logging) &&
    "level" in logging &&
    logging.level !== "error" &&
    logging.level !== "info" &&
    logging.level !== "debug"
  ) {
    throw new Error("logging.level must be error, info, or debug");
  }
  for (const field of ["maxSizeBytes", "maxFiles", "retentionDays"] as const) {
    if (
      isRecord(logging) &&
      field in logging &&
      (typeof logging[field] !== "number" || !Number.isFinite(logging[field]) || logging[field] <= 0)
    ) {
      throw new Error(`logging.${field} must be a positive number`);
    }
  }
  if (
    isRecord(wechat) &&
    "replyMode" in wechat &&
    wechat.replyMode !== "stream" &&
    wechat.replyMode !== "final" &&
    wechat.replyMode !== "verbose"
  ) {
    throw new Error("wechat.replyMode must be stream, final, or verbose");
  }

  for (const [name, agent] of Object.entries(raw.agents)) {
    if (!isRecord(agent) || typeof agent.driver !== "string" || agent.driver.length === 0) {
      throw new Error(`agent "${name}" must define a non-empty driver`);
    }
    if ("command" in agent && (typeof agent.command !== "string" || agent.command.length === 0)) {
      throw new Error(`agent "${name}" command must be a non-empty string`);
    }
  }

  for (const [name, workspace] of Object.entries(raw.workspaces)) {
    if (!isRecord(workspace) || typeof workspace.cwd !== "string" || workspace.cwd.length === 0) {
      throw new Error(`workspace "${name}" must define a non-empty cwd`);
    }
    if (
      "allowed_agents" in workspace &&
      (!Array.isArray(workspace.allowed_agents) || workspace.allowed_agents.some((value) => typeof value !== "string"))
    ) {
      throw new Error(`workspace "${name}" allowed_agents must be an array of strings`);
    }
  }

  const rawAgents = raw.agents as ParsedAgentRecord;
  const agents: Record<string, AgentConfig> = {};
  for (const [name, agent] of Object.entries(rawAgents)) {
    const driver = agent.driver;
    const command = typeof agent.command === "string" ? resolveAgentCommand(driver, agent.command) : undefined;
    agents[name] = {
      driver,
      ...(command ? { command } : {}),
    };
  }

  const rawWorkspaces = raw.workspaces as ParsedWorkspaceRecord;
  const workspaces: Record<string, WorkspaceConfig> = {};
  for (const [name, workspace] of Object.entries(rawWorkspaces)) {
    workspaces[name] = {
      cwd: normalizeWorkspacePath(workspace.cwd),
      ...(typeof workspace.description === "string" ? { description: workspace.description } : {}),
    };
  }

  const transportType = transport.type === "acpx-cli" || transport.type === "acpx-bridge"
    ? transport.type
    : "acpx-bridge";
  const permissionMode: PermissionMode =
    transport.permissionMode === "approve-all" ||
    transport.permissionMode === "approve-reads" ||
    transport.permissionMode === "deny-all"
      ? transport.permissionMode
      : DEFAULT_PERMISSION_MODE;
  const nonInteractivePermissions: NonInteractivePermissions =
    transport.nonInteractivePermissions === "deny" ||
    transport.nonInteractivePermissions === "fail"
      ? transport.nonInteractivePermissions
      : DEFAULT_NON_INTERACTIVE_PERMISSIONS;
  const loggingLevel = logging?.level;
  const resolvedLoggingLevel: LoggingLevel =
    loggingLevel === "error" || loggingLevel === "info" || loggingLevel === "debug"
      ? loggingLevel
      : (options.defaultLoggingLevel ?? DEFAULT_LOGGING_CONFIG.level);
  const replyMode: WechatReplyMode =
    wechat?.replyMode === "stream" || wechat?.replyMode === "final" || wechat?.replyMode === "verbose"
      ? wechat.replyMode
      : DEFAULT_WECHAT_REPLY_MODE;
  const orchestrationConfig = parseOrchestrationConfig(orchestration);

  return {
    transport: {
      ...(typeof transport.command === "string" ? { command: transport.command } : {}),
      ...(typeof transport.sessionInitTimeoutMs === "number"
        ? { sessionInitTimeoutMs: transport.sessionInitTimeoutMs }
        : {}),
      type: transportType,
      permissionMode,
      nonInteractivePermissions,
    },
    logging: {
      level: resolvedLoggingLevel,
      maxSizeBytes:
        typeof logging?.maxSizeBytes === "number" ? logging.maxSizeBytes : DEFAULT_LOGGING_CONFIG.maxSizeBytes,
      maxFiles: typeof logging?.maxFiles === "number" ? logging.maxFiles : DEFAULT_LOGGING_CONFIG.maxFiles,
      retentionDays:
        typeof logging?.retentionDays === "number" ? logging.retentionDays : DEFAULT_LOGGING_CONFIG.retentionDays,
    },
    wechat: {
      replyMode,
    },
    agents,
    workspaces,
    orchestration: orchestrationConfig,
  };
}

function parseOrchestrationConfig(raw: unknown): OrchestrationConfig {
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_ORCHESTRATION_CONFIG,
    };
  }

  return {
    maxPendingAgentRequestsPerCoordinator:
      typeof raw.maxPendingAgentRequestsPerCoordinator === "number" &&
      Number.isFinite(raw.maxPendingAgentRequestsPerCoordinator) &&
      raw.maxPendingAgentRequestsPerCoordinator > 0
        ? raw.maxPendingAgentRequestsPerCoordinator
        : DEFAULT_ORCHESTRATION_CONFIG.maxPendingAgentRequestsPerCoordinator,
    allowWorkerChainedRequests: raw.allowWorkerChainedRequests === true,
    allowedAgentRequestTargets: Array.isArray(raw.allowedAgentRequestTargets)
      ? raw.allowedAgentRequestTargets.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_ORCHESTRATION_CONFIG.allowedAgentRequestTargets],
    allowedAgentRequestRoles: Array.isArray(raw.allowedAgentRequestRoles)
      ? raw.allowedAgentRequestRoles.filter((value): value is string => typeof value === "string")
      : [...DEFAULT_ORCHESTRATION_CONFIG.allowedAgentRequestRoles],
    progressHeartbeatSeconds:
      typeof raw.progressHeartbeatSeconds === "number" &&
      Number.isFinite(raw.progressHeartbeatSeconds)
        ? raw.progressHeartbeatSeconds
        : DEFAULT_ORCHESTRATION_CONFIG.progressHeartbeatSeconds,
  };
}
