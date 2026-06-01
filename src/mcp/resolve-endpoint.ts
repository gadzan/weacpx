import { homedir } from "node:os";
import { join } from "node:path";

import { coreHomeDir } from "../runtime/core-home";
import { coreEnv } from "../runtime/core-env";
import { resolveRuntimeDirFromConfigPath } from "../daemon/daemon-files";
import {
  createOrchestrationEndpoint,
  resolveOrchestrationEndpoint,
  type OrchestrationIpcEndpoint,
} from "../orchestration/orchestration-ipc";

export function resolveDefaultOrchestrationEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): OrchestrationIpcEndpoint {
  const orchestrationSocket = coreEnv("ORCHESTRATION_SOCKET", env);
  if (typeof orchestrationSocket === "string" && orchestrationSocket.trim().length > 0) {
    return createOrchestrationEndpoint(orchestrationSocket.trim(), platform);
  }

  const home = requireHome(env);
  const configOverride = coreEnv("CONFIG", env);
  const configPath =
    typeof configOverride === "string" && configOverride.trim().length > 0
      ? configOverride.trim()
      : join(coreHomeDir(home), "config.json");
  const runtimeDir = resolveRuntimeDirFromConfigPath(configPath);
  return resolveOrchestrationEndpoint(runtimeDir, platform);
}

function requireHome(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? homedir();
  if (!home) {
    throw new Error("Unable to resolve the current user home directory");
  }
  return home;
}
