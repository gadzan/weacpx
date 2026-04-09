import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { createDaemonController } from "../../daemon/create-daemon-controller";
import { resolveDaemonPaths, type DaemonPaths } from "../../daemon/daemon-files";
import type { DoctorCheckResult } from "../doctor-types";

export interface DaemonCheckOptions {
  home?: string;
  resolveDaemonPaths?: (options: { home: string }) => DaemonPaths;
  isProcessRunning?: (pid: number) => boolean;
  processExecPath?: string;
  cliEntryPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function checkDaemon(options: DaemonCheckOptions = {}): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({ home });
  const controller = createDaemonController(paths, {
    processExecPath: options.processExecPath ?? process.execPath,
    cliEntryPath: options.cliEntryPath ?? resolveCliEntryPath(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    isProcessRunning: options.isProcessRunning ?? defaultIsProcessRunning,
  });

  try {
    const status = await controller.getStatus();
    switch (status.state) {
      case "running":
        return {
          id: "daemon",
          label: "Daemon",
          severity: "pass",
          summary: "daemon is running",
          details: [`pid: ${status.pid}`],
          metadata: {
            paths,
            status,
          },
        };
      case "stopped":
        return {
          id: "daemon",
          label: "Daemon",
          severity: "warn",
          summary: status.stale ? "daemon was stopped and stale runtime files were cleared" : "daemon is not running",
          details: status.stale ? ["stale runtime files were cleared"] : undefined,
          suggestions: ["run: weacpx start"],
          metadata: {
            paths,
            status,
          },
        };
      case "indeterminate":
        return {
          id: "daemon",
          label: "Daemon",
          severity: "fail",
          summary: "daemon status is indeterminate",
          details: [`pid: ${status.pid}`, `reason: ${status.reason}`],
          metadata: {
            paths,
            status,
          },
        };
    }

    return {
      id: "daemon",
      label: "Daemon",
      severity: "fail",
      summary: "daemon status lookup returned an unknown state",
      details: [`state: ${(status as { state?: string }).state ?? "unknown"}`],
      metadata: {
        paths,
      },
    };
  } catch (error) {
    return {
      id: "daemon",
      label: "Daemon",
      severity: "fail",
      summary: "daemon status could not be read",
      details: [
        `runtime dir: ${paths.runtimeDir}`,
        `pid file: ${paths.pidFile}`,
        `status file: ${paths.statusFile}`,
        `error: ${formatError(error)}`,
      ],
      metadata: {
        paths,
      },
    };
  }
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCliEntryPath(): string {
  return process.argv[1] ?? fileURLToPath(import.meta.url);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
