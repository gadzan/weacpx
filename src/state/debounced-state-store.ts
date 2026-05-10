import type { AppState } from "./types";
import type { StateStore } from "./state-store";

interface PendingResolver {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface DebouncedStateStoreDeps {
  delegate: Pick<StateStore, "save">;
  intervalMs: number;
  onError?: (error: unknown) => void;
}

export class DebouncedStateStore {
  private pending: AppState | null = null;
  private resolvers: PendingResolver[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: DebouncedStateStoreDeps) {}

  save(state: AppState): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error("DebouncedStateStore is disposed"));
    }
    return new Promise<void>((resolve, reject) => {
      this.pending = state;
      this.resolvers.push({ resolve, reject });
      this.scheduleFlush();
    });
  }

  async flush(): Promise<void> {
    while (this.pending || this.flushing || this.timer) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.flushing) {
        await this.flushing.catch(() => {});
      } else if (this.pending) {
        await this.runOneFlushCycle();
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.timer || this.flushing) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOneFlushCycle();
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  private async runOneFlushCycle(): Promise<void> {
    if (this.flushing) {
      return this.flushing;
    }
    if (!this.pending) {
      return;
    }

    const state = this.pending;
    const resolvers = this.resolvers;
    this.pending = null;
    this.resolvers = [];

    this.flushing = (async () => {
      try {
        await this.deps.delegate.save(state);
        for (const r of resolvers) r.resolve();
      } catch (error) {
        for (const r of resolvers) r.reject(error);
        this.deps.onError?.(error);
      }
    })().finally(() => {
      this.flushing = null;
    });

    await this.flushing;

    if (this.pending && !this.disposed) {
      this.scheduleFlush();
    }
  }
}
