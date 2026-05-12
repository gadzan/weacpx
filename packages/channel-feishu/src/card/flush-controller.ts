export interface FlushControllerOptions {
  minIntervalMs: number;
  now?: () => number;
  setTimer?: (cb: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const DEFAULT_MIN_INTERVAL_MS = 500;

/**
 * Throttled flush primitive.
 *
 * - `requestFlush(work)` honours the min-interval. Rapid calls coalesce to a
 *   single trailing flush carrying the *latest* `work` callback.
 * - `forceFlush(work)` runs ASAP, after any in-flight work completes,
 *   and supersedes any queued throttled flush.
 * - `waitIdle()` resolves once the chain plus any scheduled flush has drained.
 */
export class FlushController {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (cb: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private chain: Promise<void> = Promise.resolve();
  private deferredWork: (() => Promise<void>) | null = null;
  private timer: unknown = null;
  private lastFlushAtMs = 0;
  private timerWaiters: Array<() => void> = [];

  constructor(options: Partial<FlushControllerOptions> = {}) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((cb, delay) => setTimeout(cb, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  requestFlush(work: () => Promise<void>): void {
    const elapsed = this.now() - this.lastFlushAtMs;
    if (this.timer === null && elapsed >= this.minIntervalMs) {
      void this.appendToChain(work);
      return;
    }
    // Coalesce: keep only the latest pending work; one timer covers them all.
    this.deferredWork = work;
    if (this.timer === null) {
      const delay = Math.max(0, this.minIntervalMs - elapsed);
      this.timer = this.setTimer(() => {
        this.timer = null;
        const w = this.deferredWork;
        this.deferredWork = null;
        if (w !== null) void this.appendToChain(w);
        this.notifyTimerWaiters();
      }, delay);
    }
  }

  private notifyTimerWaiters(): void {
    if (this.timerWaiters.length === 0) return;
    const waiters = this.timerWaiters;
    this.timerWaiters = [];
    for (const r of waiters) r();
  }

  forceFlush(work: () => Promise<void>): Promise<void> {
    this.deferredWork = null;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
      this.notifyTimerWaiters();
    }
    return this.appendToChain(work);
  }

  async waitIdle(): Promise<void> {
    // Loop until the chain, the throttle timer, and any deferred work have all
    // settled. When a timer is pending, register as a waiter so we resume the
    // moment it fires (or is cancelled) — no 1ms polling.
    while (true) {
      const observed = this.chain;
      await observed;
      if (this.chain === observed && this.timer === null && this.deferredWork === null) {
        return;
      }
      if (this.timer !== null) {
        await new Promise<void>((resolve) => {
          this.timerWaiters.push(resolve);
        });
      }
    }
  }

  private appendToChain(work: () => Promise<void>): Promise<void> {
    // Reserve the slot at submission time, not completion time — otherwise
    // rapid synchronous requestFlush() calls all see the same stale timestamp
    // and bypass the throttle.
    this.lastFlushAtMs = this.now();
    const next = this.chain.then(() => work());
    // Don't let a rejection break the chain for future flushes.
    this.chain = next.catch(() => {});
    return next;
  }
}
