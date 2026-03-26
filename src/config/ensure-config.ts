import { readFile } from "node:fs/promises";

import { ConfigStore } from "./config-store";
import { loadConfig } from "./load-config";
import { resolveAgentCommand } from "./resolve-agent-command";
import type { AppConfig } from "./types";

export async function ensureConfigExists(path: string): Promise<void> {
  try {
    await loadConfig(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const store = new ConfigStore(path);
    await store.save(await loadDefaultConfigTemplate());
  }
}

async function loadDefaultConfigTemplate(): Promise<AppConfig> {
  const templatePath = new URL("../../config.example.json", import.meta.url);
  const template = JSON.parse(await readFile(templatePath, "utf8")) as AppConfig;

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
