import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

import { createDaemonController } from "../../daemon/create-daemon-controller";
import { resolveDaemonPaths, resolveRuntimeDirFromConfigPath, type DaemonPaths } from "../../daemon/daemon-files";
import type { DoctorCheckResult, DoctorFix } from "../doctor-types";

const CONSUMER_LOCK_FILENAME = "weixin-consumer.lock.json";

export interface DaemonCheckOptions {
  home?: string;
  resolveDaemonPaths?: (options: { home: string; runtimeDir?: string }) => DaemonPaths;
  configPath?: string;
  isProcessRunning?: (pid: number) => boolean;
  processExecPath?: string;
  cliEntryPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected so stale-lock detection never reads the real filesystem in tests. */
  readConsumerLock?: (path: string) => Promise<{ pid: number } | null>;
  /** Injected so the attached repair never touches the real filesystem in tests. */
  removeConsumerLock?: (path: string) => Promise<void>;
}

export async function checkDaemon(options: DaemonCheckOptions = {}): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const runtimeDir = options.configPath ? resolveRuntimeDirFromConfigPath(options.configPath) : undefined;
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({
    home,
    ...(runtimeDir ? { runtimeDir } : {}),
  });
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const readConsumerLock = options.readConsumerLock ?? defaultReadConsumerLock;
  const removeConsumerLock = options.removeConsumerLock ?? defaultRemoveConsumerLock;
  const controller = createDaemonController(paths, {
    processExecPath: options.processExecPath ?? process.execPath,
    cliEntryPath: options.cliEntryPath ?? resolveCliEntryPath(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    isProcessRunning,
  });

  try {
    const status = await controller.getStatus();
    // A stale consumer lock can only be safely cleared when there is genuinely
    // no live daemon. Only "stopped" qualifies: "running" obviously owns the
    // lock, and "indeterminate" is also a LIVE pid (getStatus reports it only
    // after confirming the daemon process is alive but status.json is missing),
    // so removing the lock there would race a live daemon.
    const staleLockFix =
      status.state === "stopped"
        ? await detectStaleConsumerLockFix(paths.runtimeDir, isProcessRunning, readConsumerLock, removeConsumerLock)
        : undefined;
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
          suggestions: ["run: xacpx start"],
          ...(staleLockFix ? { fixes: [staleLockFix] } : {}),
          metadata: {
            paths,
            status,
          },
        };
      case "indeterminate":
        // indeterminate = a LIVE daemon pid (status.json missing). Never offer
        // a lock removal here; it would race the live daemon.
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

/**
 * Detect a STALE Weixin consumer lock: the lock file exists and its recorded
 * pid is definitively NOT running. Conservative — a lock that is missing,
 * unreadable, or owned by a live pid yields no fix. Returns the removal repair
 * when (and only when) staleness is certain.
 */
async function detectStaleConsumerLockFix(
  runtimeDir: string,
  isProcessRunning: (pid: number) => boolean,
  readConsumerLock: (path: string) => Promise<{ pid: number } | null>,
  removeConsumerLock: (path: string) => Promise<void>,
): Promise<DoctorFix | undefined> {
  const lockPath = join(runtimeDir, CONSUMER_LOCK_FILENAME);
  const lock = await readConsumerLock(lockPath);
  if (!lock || isProcessRunning(lock.pid)) {
    return undefined;
  }

  return {
    id: "daemon.clear-stale-lock",
    title: "remove stale weixin consumer lock",
    run: async () => {
      await removeConsumerLock(lockPath);
      return { ok: true, message: `removed stale consumer lock ${lockPath} (owner pid ${lock.pid} not running)` };
    },
  };
}

async function defaultReadConsumerLock(path: string): Promise<{ pid: number } | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" ? { pid: parsed.pid } : null;
  } catch {
    return null;
  }
}

async function defaultRemoveConsumerLock(path: string): Promise<void> {
  await rm(path, { force: true });
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
