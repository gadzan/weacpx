/**
 * Centralized environment-variable access for the core (`xacpx`).
 *
 * The project was renamed `weacpx` → `xacpx` at 0.8.0. To keep existing
 * deployments working, every core environment variable is read through
 * {@link coreEnv}, which prefers the new `XACPX_` prefix but falls back to the
 * legacy `WEACPX_` one. This is the single seam the rename hooks into — callers
 * pass the bare suffix (e.g. `"CONFIG"`), never the full prefixed name.
 *
 * When the core *sets* an env var for one of its own subprocesses (daemon /
 * bridge / mcp handshakes), it writes the canonical {@link coreEnvName} (the
 * new `XACPX_` prefix); the same-generation reader resolves it via `coreEnv`,
 * while any externally-set legacy `WEACPX_` value still wins fallback.
 */

const PRIMARY_PREFIX = "XACPX_";
const LEGACY_PREFIX = "WEACPX_";

/**
 * Read a core env var by its suffix, preferring `XACPX_<suffix>` and falling
 * back to the legacy `WEACPX_<suffix>`. Returns `undefined` if neither is set.
 */
export function coreEnv(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`${PRIMARY_PREFIX}${suffix}`] ?? env[`${LEGACY_PREFIX}${suffix}`];
}

/**
 * The canonical (new-prefix) env var name for a suffix, e.g.
 * `coreEnvName("DAEMON_RUN")` → `"XACPX_DAEMON_RUN"`. Use this when the core
 * writes an env var for its own subprocess so the value is set under the
 * current name; readers still resolve it through {@link coreEnv}.
 */
export function coreEnvName(suffix: string): string {
  return `${PRIMARY_PREFIX}${suffix}`;
}

/** The legacy env var name for a suffix, e.g. `"WEACPX_CONFIG"`. */
export function legacyCoreEnvName(suffix: string): string {
  return `${LEGACY_PREFIX}${suffix}`;
}
