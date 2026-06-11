import { dirname, join } from "node:path";

import { coreHomeDir } from "../runtime/core-home";
import { resolveOrchestrationEndpoint } from "../orchestration/orchestration-ipc";

export interface DaemonPaths {
  runtimeDir: string;
  pidFile: string;
  statusFile: string;
  stdoutLog: string;
  stderrLog: string;
  appLog: string;
}

interface ResolveDaemonPathsOptions {
  home: string;
  runtimeDir?: string;
  configPath?: string;
}

export function resolveDaemonPaths(options: ResolveDaemonPathsOptions): DaemonPaths {
  const runtimeDir = options.runtimeDir ?? (options.configPath ? resolveRuntimeDirFromConfigPath(options.configPath) : join(coreHomeDir(options.home), "runtime"));

  return {
    runtimeDir,
    pidFile: join(runtimeDir, "daemon.pid"),
    statusFile: join(runtimeDir, "status.json"),
    stdoutLog: join(runtimeDir, "stdout.log"),
    stderrLog: join(runtimeDir, "stderr.log"),
    appLog: join(runtimeDir, "app.log"),
  };
}

export function resolveRuntimeDirFromConfigPath(configPath: string): string {
  return join(dirname(configPath), "runtime");
}

export function resolveDaemonOrchestrationSocketPath(
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolveOrchestrationEndpoint(runtimeDir, platform).path;
}

/**
 * Liveness probe via signal 0: returns true when the pid can be signalled,
 * false when process.kill throws. Note this treats any throw (including EPERM,
 * which actually means the process exists but is owned by another user) as "not
 * alive"; matches the behaviour of the other isProcessRunning copies.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
