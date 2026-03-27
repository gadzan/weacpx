import { readFile } from "node:fs/promises";

import { resolveAgentCommand } from "./resolve-agent-command";
import type { AgentConfig, AppConfig, LoggingConfig, LoggingLevel, WorkspaceConfig } from "./types";

const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  level: "info",
  maxSizeBytes: 2 * 1024 * 1024,
  maxFiles: 5,
  retentionDays: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadConfig(path: string, options: { defaultLoggingLevel?: LoggingLevel }): Promise<AppConfig>;
export async function loadConfig(
  path: string,
  options: { defaultLoggingLevel?: LoggingLevel } = {},
): Promise<AppConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseConfig(raw, options);
}

function parseConfig(
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

  if (!isRecord(raw.agents)) {
    throw new Error("agents must be an object");
  }

  if (!isRecord(raw.workspaces)) {
    throw new Error("workspaces must be an object");
  }

  const logging = raw.logging;
  if (logging !== undefined && !isRecord(logging)) {
    throw new Error("logging must be an object");
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

  const agents: Record<string, AgentConfig> = {};
  for (const [name, agent] of Object.entries(raw.agents)) {
    const driver = agent.driver as string;
    const command = typeof agent.command === "string" ? resolveAgentCommand(driver, agent.command) : undefined;
    agents[name] = {
      driver,
      ...(command ? { command } : {}),
    };
  }

  const workspaces: Record<string, WorkspaceConfig> = {};
  for (const [name, workspace] of Object.entries(raw.workspaces)) {
    workspaces[name] = {
      cwd: workspace.cwd as string,
      ...(typeof workspace.description === "string" ? { description: workspace.description } : {}),
    };
  }

  return {
    transport: {
      ...(typeof transport.command === "string" ? { command: transport.command } : {}),
      ...(typeof transport.sessionInitTimeoutMs === "number"
        ? { sessionInitTimeoutMs: transport.sessionInitTimeoutMs }
        : {}),
      type: transport.type ?? "acpx-bridge",
    },
    logging: {
      level:
        typeof logging?.level === "string"
          ? logging.level
          : (options.defaultLoggingLevel ?? DEFAULT_LOGGING_CONFIG.level),
      maxSizeBytes:
        typeof logging?.maxSizeBytes === "number" ? logging.maxSizeBytes : DEFAULT_LOGGING_CONFIG.maxSizeBytes,
      maxFiles: typeof logging?.maxFiles === "number" ? logging.maxFiles : DEFAULT_LOGGING_CONFIG.maxFiles,
      retentionDays:
        typeof logging?.retentionDays === "number" ? logging.retentionDays : DEFAULT_LOGGING_CONFIG.retentionDays,
    },
    agents,
    workspaces,
  };
}
