import { homedir } from "node:os";

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
  if (typeof env.WEACPX_ORCHESTRATION_SOCKET === "string" && env.WEACPX_ORCHESTRATION_SOCKET.trim().length > 0) {
    return createOrchestrationEndpoint(env.WEACPX_ORCHESTRATION_SOCKET.trim(), platform);
  }

  const home = requireHome(env);
  const configPath =
    typeof env.WEACPX_CONFIG === "string" && env.WEACPX_CONFIG.trim().length > 0
      ? env.WEACPX_CONFIG.trim()
      : `${home}/.weacpx/config.json`;
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
