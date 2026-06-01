import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CORE_HOME_DIR_NAME, CORE_HOME_LEGACY_DIR_NAME } from "./core-home";

export type MigrateCoreHomeReason =
  | "already-current"
  | "no-legacy"
  | "daemon-running"
  | "copied"
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
 * - If `~/.xacpx` already exists → no-op (`already-current`).
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
  if (existsSync(primary)) {
    return { migrated: false, reason: "already-current" };
  }

  const legacy = join(home, CORE_HOME_LEGACY_DIR_NAME);
  if (!existsSync(legacy)) {
    return { migrated: false, reason: "no-legacy" };
  }

  const legacyPid = readLegacyDaemonPid(legacy);
  if (legacyPid !== null && isProcessAlive(legacyPid)) {
    log(
      `检测到运行中的旧守护进程 (pid ${legacyPid})，暂不迁移 ${legacy} → ${primary}；` +
        `请先停止守护进程（weacpx stop / xacpx stop）后重试，期间仍使用旧目录。`,
    );
    return { migrated: false, reason: "daemon-running", from: legacy };
  }

  try {
    cpSync(legacy, primary, { recursive: true });
    log(`已将状态目录从 ${legacy} 复制到 ${primary}（旧目录保留为备份，可手动删除）。`);
    return { migrated: true, reason: "copied", from: legacy, to: primary };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`迁移状态目录 ${legacy} → ${primary} 失败，继续使用旧目录：${detail}`);
    return { migrated: false, reason: "failed", from: legacy };
  }
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
