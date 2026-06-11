import { homedir } from "node:os";

import { createDaemonController } from "../../daemon/create-daemon-controller";
import {
  isProcessAlive,
  resolveDaemonPaths,
  resolveRuntimeDirFromConfigPath,
  type DaemonPaths,
} from "../../daemon/daemon-files";
import { canConnectToEndpoint } from "../../orchestration/endpoint-probe";
import {
  resolveOrchestrationEndpoint,
  type OrchestrationIpcEndpoint,
} from "../../orchestration/orchestration-ipc";
import type { DoctorCheckResult } from "../doctor-types";

/**
 * Minimal view of the daemon lifecycle states this check cares about. Mirrors
 * DaemonController.getStatus() but kept narrow so the seam can be injected in
 * tests without constructing a real controller. "running" and "indeterminate"
 * are both LIVE daemons (getStatus reports "indeterminate" only after confirming
 * the pid is alive); "stopped" is the only non-live state.
 */
export type DaemonStatusSummary =
  | { state: "stopped" }
  | { state: "running"; pid: number }
  | { state: "indeterminate"; pid: number }
  | { state: string; pid?: number };

export interface OrchestrationSocketCheckOptions {
  home?: string;
  configPath?: string;
  resolveDaemonPaths?: (options: { home: string; runtimeDir?: string }) => DaemonPaths;
  /** Daemon liveness seam. Injected so tests never touch real processes. */
  getDaemonStatus?: (paths: DaemonPaths) => Promise<DaemonStatusSummary>;
  resolveOrchestrationEndpoint?: (runtimeDir: string) => OrchestrationIpcEndpoint;
  /** IPC liveness probe seam. Injected so tests never open a real socket. */
  canConnectToEndpoint?: (path: string) => Promise<boolean>;
  processExecPath?: string;
  cliEntryPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  isProcessRunning?: (pid: number) => boolean;
}

/**
 * Confirm the orchestration IPC endpoint is actually accepting connections when
 * the daemon is running. This catches the case where the daemon process is alive
 * (fresh heartbeat) but its orchestration server has died, leaving MCP
 * coordinators unable to reach it.
 *
 * The check is meaningful only for a LIVE daemon, so a stopped daemon yields a
 * skip. A live daemon (running or indeterminate) is probed.
 */
export async function checkOrchestrationSocket(
  options: OrchestrationSocketCheckOptions = {},
): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const runtimeDir = options.configPath ? resolveRuntimeDirFromConfigPath(options.configPath) : undefined;
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({
    home,
    ...(runtimeDir ? { runtimeDir } : {}),
  });
  const getDaemonStatus = options.getDaemonStatus ?? ((p) => defaultGetDaemonStatus(p, options));
  const probe = options.canConnectToEndpoint ?? canConnectToEndpoint;
  const resolveEndpoint = options.resolveOrchestrationEndpoint ?? ((dir) => resolveOrchestrationEndpoint(dir));

  let status: DaemonStatusSummary;
  try {
    status = await getDaemonStatus(paths);
  } catch (error) {
    return {
      id: "orchestration-socket",
      label: "Orchestration IPC",
      severity: "skip",
      summary: "daemon status could not be read",
      details: [`runtime dir: ${paths.runtimeDir}`, `error: ${formatError(error)}`],
    };
  }

  // Only a stopped daemon is non-live. "running" and "indeterminate" are both
  // live pids, so the orchestration endpoint should be reachable.
  if (status.state === "stopped") {
    return {
      id: "orchestration-socket",
      label: "Orchestration IPC",
      severity: "skip",
      summary: "daemon stopped",
    };
  }

  const endpoint = resolveEndpoint(paths.runtimeDir);
  const reachable = await probe(endpoint.path);

  // The probe is conservative: it returns false ONLY when the endpoint
  // definitively has no listener (ECONNREFUSED/ENOENT). A successful connect OR
  // any ambiguous result (timeout / other error) returns true. So "pass" also
  // covers the ambiguous/busy-server case, which guarantees we never falsely
  // fail a daemon that is merely slow or transiently unreachable.
  if (reachable) {
    return {
      id: "orchestration-socket",
      label: "Orchestration IPC",
      severity: "pass",
      summary: "orchestration IPC is accepting connections",
      details: [`endpoint: ${endpoint.path}`],
    };
  }

  return {
    id: "orchestration-socket",
    label: "Orchestration IPC",
    severity: "fail",
    summary: "daemon is running but orchestration IPC is not accepting connections",
    details: [`endpoint: ${endpoint.path}`],
    // Restart is a user action (it stops and respawns the daemon), so this is a
    // suggestion only — no automated DoctorFix is attached.
    suggestions: ["run: xacpx restart"],
  };
}

async function defaultGetDaemonStatus(
  paths: DaemonPaths,
  options: OrchestrationSocketCheckOptions,
): Promise<DaemonStatusSummary> {
  const controller = createDaemonController(paths, {
    processExecPath: options.processExecPath ?? process.execPath,
    cliEntryPath: options.cliEntryPath ?? process.argv[1] ?? "",
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    isProcessRunning: options.isProcessRunning ?? isProcessAlive,
  });
  return await controller.getStatus();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
