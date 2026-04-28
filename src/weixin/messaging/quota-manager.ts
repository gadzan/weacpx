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

  constructor(observer?: QuotaObserver) {
    this.observer = observer;
  }

  onInbound(chatKey: string): void {
    // v1.4: reset usage counters but PRESERVE pendingFinalChunks. The decision
    // about whether to drain or drop pending depends on the inbound content
    // (only `/jx` drains; everything else drops) and is made by the caller —
    // see monitor.ts (drops on non-/jx) and slash-commands.ts (drains on /jx).
    const existing = this.states.get(chatKey);
    const pending = existing?.pendingFinalChunks ?? [];
    this.states.set(chatKey, { midUsed: 0, finalUsed: 0, pendingFinalChunks: pending });
    this.observer?.onInbound?.(chatKey);
  }

  reserveMidSegment(chatKey: string): boolean {
    const state = this.getOrCreate(chatKey);
    if (state.midUsed >= MID_BUDGET) {
      this.observer?.onMidRejected?.(chatKey, this.snapshot(chatKey));
      return false;
    }
    state.midUsed += 1;
    this.observer?.onMidReserved?.(chatKey, this.snapshot(chatKey));
    return true;
  }

  reserveFinal(chatKey: string): boolean {
    const state = this.getOrCreate(chatKey);
    if (state.finalUsed >= FINAL_BUDGET) {
      this.observer?.onFinalRejected?.(chatKey, this.snapshot(chatKey));
      return false;
    }
    state.finalUsed += 1;
    this.observer?.onFinalReserved?.(chatKey, this.snapshot(chatKey));
    return true;
  }

  finalRemaining(chatKey: string): number {
    return FINAL_BUDGET - this.getOrCreate(chatKey).finalUsed;
  }

  enqueuePendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void {
    if (chunks.length === 0) return;
    const state = this.getOrCreate(chatKey);
    state.pendingFinalChunks.push(...chunks);
  }

  prependPendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void {
    if (chunks.length === 0) return;
    const state = this.getOrCreate(chatKey);
    state.pendingFinalChunks.unshift(...chunks);
  }

  drainPendingFinalUpToBudget(chatKey: string, available: number): PendingFinalChunk[] {
    if (available <= 0) return [];
    const state = this.getOrCreate(chatKey);
    if (state.pendingFinalChunks.length === 0) return [];
    return state.pendingFinalChunks.splice(0, available);
  }

  hasPendingFinal(chatKey: string): boolean {
    return (this.states.get(chatKey)?.pendingFinalChunks.length ?? 0) > 0;
  }

  countPendingFinal(chatKey: string): number {
    return this.states.get(chatKey)?.pendingFinalChunks.length ?? 0;
  }

  clearPendingFinal(chatKey: string): void {
    const state = this.states.get(chatKey);
    if (!state) return;
    state.pendingFinalChunks = [];
  }

  snapshot(chatKey: string): QuotaSnapshot {
    const state = this.states.get(chatKey) ?? freshState();
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

  private getOrCreate(chatKey: string): QuotaState {
    let state = this.states.get(chatKey);
    if (!state) {
      state = freshState();
      this.states.set(chatKey, state);
    }
    return state;
  }
}
