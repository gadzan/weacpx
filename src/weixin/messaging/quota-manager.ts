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

function freshState(): QuotaState {
  return { midUsed: 0, finalUsed: 0, pendingFinalChunks: [] };
}

export class QuotaManager {
  private readonly states = new Map<string, QuotaState>();
  private readonly observer: QuotaObserver | undefined;
  private readonly normalizeKey: (key: string) => string;

  constructor(observer?: QuotaObserver, normalizeKey?: (key: string) => string) {
    this.observer = observer;
    this.normalizeKey = normalizeKey ?? ((key) => key);
  }

  onInbound(chatKey: string): void {
    const key = this.normalizeKey(chatKey);
    // v1.4: reset usage counters but PRESERVE pendingFinalChunks. The decision
    // about whether to drain or drop pending depends on the inbound content
    // (only `/jx` drains; everything else drops) and is made by the caller —
    // see monitor.ts (drops on non-/jx) and slash-commands.ts (drains on /jx).
    const existing = this.states.get(key);
    const pending = existing?.pendingFinalChunks ?? [];
    this.states.set(key, { midUsed: 0, finalUsed: 0, pendingFinalChunks: pending });
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
  }

  prependPendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void {
    if (chunks.length === 0) return;
    const state = this.getOrCreate(this.normalizeKey(chatKey));
    state.pendingFinalChunks.unshift(...chunks);
  }

  drainPendingFinalUpToBudget(chatKey: string, available: number): PendingFinalChunk[] {
    if (available <= 0) return [];
    const state = this.getOrCreate(this.normalizeKey(chatKey));
    if (state.pendingFinalChunks.length === 0) return [];
    return state.pendingFinalChunks.splice(0, available);
  }

  hasPendingFinal(chatKey: string): boolean {
    return (this.states.get(this.normalizeKey(chatKey))?.pendingFinalChunks.length ?? 0) > 0;
  }

  countPendingFinal(chatKey: string): number {
    return this.states.get(this.normalizeKey(chatKey))?.pendingFinalChunks.length ?? 0;
  }

  clearPendingFinal(chatKey: string): void {
    const state = this.states.get(this.normalizeKey(chatKey));
    if (!state) return;
    state.pendingFinalChunks = [];
  }

  snapshot(chatKey: string): QuotaSnapshot {
    const key = this.normalizeKey(chatKey);
    const state = this.states.get(key) ?? freshState();
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
    let state = this.states.get(key);
    if (!state) {
      state = freshState();
      this.states.set(key, state);
    }
    return state;
  }
}
