import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The per-user state directory name (`<home>/.xacpx/`). This is the SINGLE
 * source of truth for that name; every config / state / runtime / plugin path
 * is built on top of it.
 *
 * The project was renamed `weacpx` → `xacpx` at 0.8.0. New installs use
 * `~/.xacpx`; existing `~/.weacpx` directories are migrated once on first run
 * (see `migrate-core-home.ts`). Until that migration runs (or while it is
 * intentionally skipped because a legacy daemon is still alive),
 * {@link coreHomeDir} keeps resolving to the legacy directory so the process
 * operates on existing state rather than a fresh empty tree.
 */
export const CORE_HOME_DIR_NAME = ".xacpx";

/** The pre-rename state directory name, kept for one-time migration / fallback. */
export const CORE_HOME_LEGACY_DIR_NAME = ".weacpx";

/**
 * The core state root for a given user home.
 *
 * Resolution order: prefer `<home>/.xacpx` if it exists; otherwise fall back to
 * an existing legacy `<home>/.weacpx` (so we keep reading/writing pre-rename
 * state until it is migrated); otherwise return `<home>/.xacpx` for a fresh
 * install. Pass the home directory the caller already resolved — this helper
 * imposes no home-resolution policy of its own.
 */
export function coreHomeDir(home: string): string {
  const primary = join(home, CORE_HOME_DIR_NAME);
  if (existsSync(primary)) return primary;
  const legacy = join(home, CORE_HOME_LEGACY_DIR_NAME);
  if (existsSync(legacy)) return legacy;
  return primary;
}

/**
 * Display form for user-facing hints (e.g. "请查看日志：~/.xacpx/runtime/...").
 * Keeps printed paths single-sourced with the canonical directory name. Always
 * uses "/" separators since it is for display, not filesystem access.
 */
export function coreHomeDisplayPath(...segments: string[]): string {
  return ["~", CORE_HOME_DIR_NAME, ...segments].join("/");
}
