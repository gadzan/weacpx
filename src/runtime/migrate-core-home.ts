import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CORE_HOME_DIR_NAME, CORE_HOME_LEGACY_DIR_NAME } from "./core-home";
import { t } from "../i18n/index.js";

export type MigrateCoreHomeReason =
  | "already-current"
  | "no-legacy"
  | "daemon-running"
  | "copied"
  | "supplemented"
  | "failed";

export interface MigrateCoreHomeResult {
  migrated: boolean;
  reason: MigrateCoreHomeReason;
  from?: string;
  to?: string;
}

export interface MigrateCoreHomeDeps {
  /** Emit a one-line user-facing notice. Defaults to console.error. */
  log?: (message: string) => void;
  /** Liveness probe for the legacy daemon pid. Defaults to `process.kill(pid, 0)`. */
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * One-time `~/.weacpx` → `~/.xacpx` state-directory migration for the
 * weacpx→xacpx rename (0.8.0).
 *
 * Behavior (idempotent — safe to call on every CLI invocation):
 * - If `~/.xacpx` already exists → supplement missing top-level state files
 *   from `~/.weacpx` without overwriting current files (`supplemented`), or
 *   no-op when nothing is missing (`already-current`).
 * - If there is no legacy `~/.weacpx` → no-op (`no-legacy`, fresh install).
 * - If a legacy daemon still appears to be running → skip and warn
 *   (`daemon-running`); the caller keeps operating on `~/.weacpx` via
 *   {@link coreHomeDir} until the daemon is stopped and a later run migrates.
 * - Otherwise COPY (not move) the tree to `~/.xacpx`, leaving `~/.weacpx` as a
 *   backup (`copied`). A copy failure degrades safely (`failed`) — the legacy
 *   directory is untouched and startup continues on it.
 */
export function migrateCoreHome(home: string, deps: MigrateCoreHomeDeps = {}): MigrateCoreHomeResult {
  const log = deps.log ?? ((message: string) => console.error(message));
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;

  const primary = join(home, CORE_HOME_DIR_NAME);
  const legacy = join(home, CORE_HOME_LEGACY_DIR_NAME);
  if (!existsSync(legacy)) {
    return existsSync(primary)
      ? { migrated: false, reason: "already-current" }
      : { migrated: false, reason: "no-legacy" };
  }

  const legacyPid = readLegacyDaemonPid(legacy);
  if (legacyPid !== null && isProcessAlive(legacyPid)) {
    log(t().migrate.daemonRunning(legacyPid, legacy, primary));
    return { migrated: false, reason: "daemon-running", from: legacy };
  }

  if (existsSync(primary)) {
    return supplementMissingCoreFiles({ legacy, primary, log });
  }

  try {
    cpSync(legacy, primary, { recursive: true });
    log(t().migrate.copied(legacy, primary));
    return { migrated: true, reason: "copied", from: legacy, to: primary };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(t().migrate.failed(legacy, primary, detail));
    return { migrated: false, reason: "failed", from: legacy };
  }
}

function supplementMissingCoreFiles(input: {
  legacy: string;
  primary: string;
  log: (message: string) => void;
}): MigrateCoreHomeResult {
  const copied: string[] = [];
  for (const fileName of ["config.json", "state.json"]) {
    const from = join(input.legacy, fileName);
    const to = join(input.primary, fileName);
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      mkdirSync(input.primary, { recursive: true });
      copyFileSync(from, to);
      copied.push(fileName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.log(t().migrate.supplementFailed(from, to, detail));
    }
  }

  if (copied.length === 0) {
    return { migrated: false, reason: "already-current" };
  }

  input.log(t().migrate.supplemented(copied.join(", "), input.primary));
  return { migrated: true, reason: "supplemented", from: input.legacy, to: input.primary };
}

function readLegacyDaemonPid(legacyHome: string): number | null {
  try {
    const content = readFileSync(join(legacyHome, "runtime", "daemon.pid"), "utf8");
    const pid = Number(content.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
