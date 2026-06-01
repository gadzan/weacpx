import { join } from "node:path";

/**
 * The per-user state directory name (`<home>/.weacpx/`). This is the SINGLE
 * source of truth for that name; every config / state / runtime / plugin path
 * is built on top of it.
 *
 * The weacpx→xacpx rename (0.8.0) changes the name HERE — and adds any
 * legacy-directory fallback inside {@link coreHomeDir} (e.g. prefer
 * `~/.xacpx`, fall back to an existing `~/.weacpx`) — so the whole tree of
 * derived paths follows from one place rather than ~11 scattered literals.
 */
export const CORE_HOME_DIR_NAME = ".weacpx";

/**
 * The core state root for a given user home: `<home>/.weacpx`.
 *
 * Pass the home directory the caller already resolved — this helper imposes no
 * home-resolution policy of its own, so each caller's existing semantics are
 * preserved (this is a pure refactor of the directory-name literal). It is the
 * one function the 0.8.0 rename hooks into.
 */
export function coreHomeDir(home: string): string {
  return join(home, CORE_HOME_DIR_NAME);
}

/**
 * Display form for user-facing hints (e.g. "请查看日志：~/.weacpx/runtime/...").
 * Keeps printed paths single-sourced with the real directory name. Always uses
 * "/" separators since it is for display, not filesystem access.
 */
export function coreHomeDisplayPath(...segments: string[]): string {
  return ["~", CORE_HOME_DIR_NAME, ...segments].join("/");
}
