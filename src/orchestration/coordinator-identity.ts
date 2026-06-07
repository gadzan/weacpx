/**
 * The orchestration coordinator identity is derived from a session's transport
 * name. `/clear` rotates that name from `workspace:alias` to
 * `workspace:alias:reset-<timestamp>` (see session-reset-handler), which would
 * otherwise orphan every task delegated before the reset. Stripping the
 * volatile `:reset-<digits>` suffix yields the stable `workspace:alias` identity
 * so ownership survives `/clear`.
 *
 * Pure leaf module: do not add imports, so it can be used from sessions/,
 * commands/, and orchestration/ without risking an import cycle.
 *
 * No-op on any value lacking a trailing `:reset-<digits>` segment, so external
 * coordinators (`external_*`) and normal sessions pass through unchanged.
 */
export function stableCoordinatorSession(transportSession: string): string {
  return transportSession.replace(/:reset-\d+$/, "");
}

/**
 * The single chokepoint for asking "do these two transport names refer to the
 * same coordinator?". Both sides are reduced to their stable identity before
 * comparison, so it is robust to either side carrying a volatile
 * `:reset-<digits>` suffix (a live post-`/clear` session, or a legacy
 * state.json record persisted before the identity was normalized at write).
 *
 * Every coordinator-ownership comparison must go through this rather than a raw
 * `===`, so the normalization rule lives in one place instead of being
 * re-derived (and inconsistently forgotten) at each call site.
 */
export function sameCoordinatorSession(a: string, b: string): boolean {
  return stableCoordinatorSession(a) === stableCoordinatorSession(b);
}
