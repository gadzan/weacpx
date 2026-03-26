import { readFile } from "node:fs/promises";

import { resolveAgentCommand } from "./resolve-agent-command";
import type { AgentConfig, AppConfig, WorkspaceConfig } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
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
    agents,
    workspaces,
  };
}
