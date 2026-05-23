import type { AppLogger } from "../logging/app-logger";
import type { ScheduledTaskRecord } from "./scheduled-types";
import type { ScheduledTaskService } from "./scheduled-service";

export interface ScheduledTaskSchedulerDeps {
  dispatchTask: (task: ScheduledTaskRecord) => Promise<void>;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void | Promise<void>, delay: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
  logger?: AppLogger;
}

export class ScheduledTaskScheduler {
  private readonly intervalMs: number;
  private readonly setIntervalFn: (fn: () => void | Promise<void>, delay: number) => unknown;
  private readonly clearIntervalFn: (timer: unknown) => void;
  private readonly dispatchTask: (task: ScheduledTaskRecord) => Promise<void>;
  private readonly logger?: AppLogger;
  private intervalHandle: unknown = null;
  private ticking = false;

  constructor(
    private readonly service: ScheduledTaskService,
    deps: ScheduledTaskSchedulerDeps,
  ) {
    this.dispatchTask = deps.dispatchTask;
    this.intervalMs = deps.intervalMs ?? 5000;
    this.setIntervalFn = deps.setIntervalFn ?? ((fn, delay) => setInterval(fn, delay));
    this.clearIntervalFn = deps.clearIntervalFn ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
    this.logger = deps.logger;
  }

  async start(): Promise<void> {
    if (this.intervalHandle !== null) return;
    await this.service.markStartupMissed();
    this.intervalHandle = this.setIntervalFn(() => {
      void this.tick();
    }, this.intervalMs);
    await this.tick();
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const dueTasks = await this.service.claimDueTasks();
      for (const task of dueTasks) {
        try {
          await this.dispatchTask(task);
          await this.service.markExecuted(task.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.logger?.error("scheduled.dispatch.failed", "failed to dispatch scheduled task", {
            taskId: task.id,
            message,
          });
          await this.service.markFailed(task.id, error);
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
