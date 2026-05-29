// v1.3 budget split: 6 mid + 4 final = 10 total per inbound window. Compared
// with v1.2's 9+1 split this trades three mid slots for three additional final
// slots so a long final answer (e.g. review summary) can be paginated across
// up to 4 chunks without truncation. reserveFinal is no longer permanently
// successful — callers MUST handle the `false` return path.
//
// v1.4: paginated final no longer truncates. When the natural chunk count
// exceeds the remaining final budget, the caller sends the first wave (up to
// `finalRemaining` chunks) and parks the rest in `pendingFinalChunks` keyed by
// chatKey. The next inbound message resets the budget — if that inbound is
// `/jx`, the slash handler drains the next wave; if it's anything else, the
// pending queue is dropped (the user moved on). Pending state is in-memory
// only; daemon restart drops it (acceptable since the inbound that prompted it
// has already gone).
export const MID_BUDGET = 6;
export const FINAL_BUDGET = 4;

export interface PendingFinalChunk {
  /** Pre-formatted body, already carrying the (k/N) pagination prefix. */
  text: string;
  /** 1-based chunk index. */
  seq: number;
  /** Total chunk count for this final answer. */
  total: number;
  contextToken?: string;
  accountId?: string;
}

interface QuotaState {
  midUsed: number;
  finalUsed: number;
  pendingFinalChunks: PendingFinalChunk[];
  lastTouchedAt: number;
}

export interface QuotaSnapshot {
  remaining: number;
  midUsed: number;
  finalUsed: number;
  midRemaining: number;
  finalRemaining: number;
}

// Observer hook for quota decision events. All callbacks are optional and
// invoked with a snapshot reflecting state AFTER the operation completes.
//
// IMPORTANT: observer callbacks must NOT trigger further quota operations
// (would cause re-entrant updates / infinite loops). Side-effects should be
// limited to logging / metrics.
export interface QuotaObserver {
  onInbound?(chatKey: string): void;
  onMidReserved?(chatKey: string, snapshot: QuotaSnapshot): void;
  onMidRejected?(chatKey: string, snapshot: QuotaSnapshot): void;
  onFinalReserved?(chatKey: string, snapshot: QuotaSnapshot): void;
  onFinalRejected?(chatKey: string, snapshot: QuotaSnapshot): void;
}

export interface QuotaManagerOptions {
  maxStates?: number;
  stateTtlMs?: number;
  maxPendingFinalChunksPerChat?: number;
  now?: () => number;
}

const DEFAULT_MAX_STATES = 5000;
const DEFAULT_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PENDING_FINAL_CHUNKS_PER_CHAT = 40;

function freshState(now: number): QuotaState {
  return { midUsed: 0, finalUsed: 0, pendingFinalChunks: [], lastTouchedAt: now };
}

export class QuotaManager {
  private readonly states = new Map<string, QuotaState>();
  private readonly observer: QuotaObserver | undefined;
  private readonly normalizeKey: (key: string) => string;
  private readonly maxStates: number;
  private readonly stateTtlMs: number;
  private readonly maxPendingFinalChunksPerChat: number;
  private readonly now: () => number;

  constructor(
    observer?: QuotaObserver,
    normalizeKey?: (key: string) => string,
    options: QuotaManagerOptions = {},
  ) {
    this.observer = observer;
    this.normalizeKey = normalizeKey ?? ((key) => key);
    this.maxStates = normalizePositiveInt(options.maxStates, DEFAULT_MAX_STATES);
    this.stateTtlMs = normalizeNonNegativeMs(options.stateTtlMs, DEFAULT_STATE_TTL_MS);
    this.maxPendingFinalChunksPerChat = normalizePositiveInt(
      options.maxPendingFinalChunksPerChat,
      DEFAULT_MAX_PENDING_FINAL_CHUNKS_PER_CHAT,
    );
    this.now = options.now ?? (() => Date.now());
  }

  onInbound(chatKey: string): void {
    const key = this.normalizeKey(chatKey);
    this.prune();
    // v1.4: reset usage counters but PRESERVE pendingFinalChunks. The decision
    // about whether to drain or drop pending depends on the inbound content
    // (only `/jx` drains; everything else drops) and is made by the caller —
    // see monitor.ts (drops on non-/jx) and slash-commands.ts (drains on /jx).
    const existing = this.states.get(key);
    const pending = existing?.pendingFinalChunks ?? [];
    this.states.set(key, { midUsed: 0, finalUsed: 0, pendingFinalChunks: pending, lastTouchedAt: this.now() });
    this.enforceMaxStates();
    this.observer?.onInbound?.(key);
  }

  reserveMidSegment(chatKey: string): boolean {
    const key = this.normalizeKey(chatKey);
    const state = this.getOrCreate(key);
    if (state.midUsed >= MID_BUDGET) {
      this.observer?.onMidRejected?.(key, this.snapshot(key));
      return false;
    }
    state.midUsed += 1;
    this.observer?.onMidReserved?.(key, this.snapshot(key));
    return true;
  }

  reserveFinal(chatKey: string): boolean {
    const key = this.normalizeKey(chatKey);
    const state = this.getOrCreate(key);
    if (state.finalUsed >= FINAL_BUDGET) {
      this.observer?.onFinalRejected?.(key, this.snapshot(key));
      return false;
    }
    state.finalUsed += 1;
    this.observer?.onFinalReserved?.(key, this.snapshot(key));
    return true;
  }

  finalRemaining(chatKey: string): number {
    return FINAL_BUDGET - this.getOrCreate(this.normalizeKey(chatKey)).finalUsed;
  }

  enqueuePendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void {
    if (chunks.length === 0) return;
    const state = this.getOrCreate(this.normalizeKey(chatKey));
    state.pendingFinalChunks.push(...chunks);
    this.trimPendingFinalChunks(state, "front");
  }

  prependPendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void {
    if (chunks.length === 0) return;
    const state = this.getOrCreate(this.normalizeKey(chatKey));
    state.pendingFinalChunks.unshift(...chunks);
    this.trimPendingFinalChunks(state, "back");
  }

  drainPendingFinalUpToBudget(chatKey: string, available: number): PendingFinalChunk[] {
    if (available <= 0) return [];
    const key = this.normalizeKey(chatKey);
    const state = this.getOrCreate(key);
    if (state.pendingFinalChunks.length === 0) return [];
    const drained = state.pendingFinalChunks.splice(0, available);
    state.lastTouchedAt = this.now();
    this.deleteIfEmpty(key, state);
    return drained;
  }

  hasPendingFinal(chatKey: string): boolean {
    this.prune();
    return (this.states.get(this.normalizeKey(chatKey))?.pendingFinalChunks.length ?? 0) > 0;
  }

  countPendingFinal(chatKey: string): number {
    this.prune();
    return this.states.get(this.normalizeKey(chatKey))?.pendingFinalChunks.length ?? 0;
  }

  clearPendingFinal(chatKey: string): void {
    const key = this.normalizeKey(chatKey);
    const state = this.states.get(key);
    if (!state) return;
    state.pendingFinalChunks = [];
    state.lastTouchedAt = this.now();
    this.deleteIfEmpty(key, state);
  }

  snapshot(chatKey: string): QuotaSnapshot {
    const key = this.normalizeKey(chatKey);
    this.prune();
    const state = this.states.get(key) ?? freshState(this.now());
    const midRemaining = MID_BUDGET - state.midUsed;
    const finalRemaining = FINAL_BUDGET - state.finalUsed;
    return {
      midUsed: state.midUsed,
      finalUsed: state.finalUsed,
      midRemaining,
      finalRemaining,
      remaining: midRemaining + finalRemaining,
    };
  }

  private getOrCreate(key: string): QuotaState {
    this.prune();
    let state = this.states.get(key);
    if (!state) {
      state = freshState(this.now());
      this.states.set(key, state);
      this.enforceMaxStates();
    } else {
      state.lastTouchedAt = this.now();
    }
    return state;
  }

  private prune(): void {
    const cutoff = this.now() - this.stateTtlMs;
    for (const [key, state] of this.states) {
      if (state.lastTouchedAt < cutoff) {
        this.states.delete(key);
      }
    }
    this.enforceMaxStates();
  }

  private enforceMaxStates(): void {
    while (this.states.size > this.maxStates) {
      let oldestKey: string | undefined;
      let oldestTouchedAt = Number.POSITIVE_INFINITY;
      for (const [key, state] of this.states) {
        if (state.lastTouchedAt < oldestTouchedAt) {
          oldestTouchedAt = state.lastTouchedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) return;
      this.states.delete(oldestKey);
    }
  }

  private trimPendingFinalChunks(state: QuotaState, side: "front" | "back"): void {
    state.lastTouchedAt = this.now();
    const excess = state.pendingFinalChunks.length - this.maxPendingFinalChunksPerChat;
    if (excess <= 0) return;
    if (side === "front") {
      state.pendingFinalChunks.splice(0, excess);
    } else {
      state.pendingFinalChunks.splice(state.pendingFinalChunks.length - excess, excess);
    }
  }

  private deleteIfEmpty(key: string, state: QuotaState): void {
    if (state.midUsed === 0 && state.finalUsed === 0 && state.pendingFinalChunks.length === 0) {
      this.states.delete(key);
    }
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function normalizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
