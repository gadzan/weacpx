import { readFile } from "node:fs/promises";

import { ConfigStore } from "./config-store";
import { loadConfig, parseConfig } from "./load-config";
import { resolveAgentCommand } from "./resolve-agent-command";
import type { AppConfig } from "./types";

interface EnsureConfigOptions {
  readDefaultConfigTemplate?: () => Promise<unknown>;
}

const BUILTIN_DEFAULT_CONFIG_TEMPLATE = {
  transport: {
    type: "acpx-bridge",
    sessionInitTimeoutMs: 120000,
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  },
  logging: {
    level: "info",
    maxSizeBytes: 2 * 1024 * 1024,
    maxFiles: 5,
    retentionDays: 7,
  },
  wechat: {
    replyMode: "stream",
  },
  agents: {
    codex: { driver: "codex" },
    claude: { driver: "claude" },
  },
  workspaces: {},
} satisfies unknown;

export async function ensureConfigExists(path: string, options: EnsureConfigOptions = {}): Promise<void> {
  try {
    await loadConfig(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const store = new ConfigStore(path);
    await store.save(await loadDefaultConfigTemplate(options));
  }
}

async function loadDefaultConfigTemplate(options: EnsureConfigOptions = {}): Promise<AppConfig> {
  if (options.readDefaultConfigTemplate) {
    try {
      return normalizeDefaultConfigTemplate(await options.readDefaultConfigTemplate());
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  const candidates = [
    new URL("../../config.example.json", import.meta.url),
    new URL("../config.example.json", import.meta.url),
  ];

  let raw: string | undefined;
  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, "utf8");
      break;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  if (!raw) {
    return normalizeDefaultConfigTemplate(BUILTIN_DEFAULT_CONFIG_TEMPLATE);
  }

  return normalizeDefaultConfigTemplate(JSON.parse(raw) as unknown);
}

export function normalizeDefaultConfigTemplate(raw: unknown): AppConfig {
  const template = parseConfig(raw);

  return {
    ...template,
    agents: Object.fromEntries(
      Object.entries(template.agents).map(([name, agent]) => [
        name,
        {
          driver: agent.driver,
          ...(resolveAgentCommand(agent.driver, agent.command)
            ? { command: resolveAgentCommand(agent.driver, agent.command) }
            : {}),
        },
      ]),
    ),
    workspaces: {},
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
