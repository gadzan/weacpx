import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DaemonPaths } from "./daemon-files";
import { DaemonStatusStore, type DaemonStatus } from "./daemon-status";

interface DaemonRuntimeOptions {
  pid: number;
  now?: () => string;
}

export class DaemonRuntime {
  private readonly statusStore: DaemonStatusStore;
  private readonly now: () => string;
  private currentStatus: DaemonStatus | null = null;

  constructor(
    private readonly paths: DaemonPaths,
    private readonly options: DaemonRuntimeOptions,
  ) {
    this.statusStore = new DaemonStatusStore(paths.statusFile);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async start(input: { configPath: string; statePath: string }): Promise<void> {
    const timestamp = this.now();
    this.currentStatus = {
      pid: this.options.pid,
      started_at: timestamp,
      heartbeat_at: timestamp,
      config_path: input.configPath,
      state_path: input.statePath,
      app_log: this.paths.appLog,
      stdout_log: this.paths.stdoutLog,
      stderr_log: this.paths.stderrLog,
    };

    await mkdir(dirname(this.paths.pidFile), { recursive: true });
    await writeFile(this.paths.pidFile, `${this.options.pid}\n`);
    await this.statusStore.save(this.currentStatus);
  }

  async heartbeat(): Promise<void> {
    if (!this.currentStatus) {
      return;
    }

    this.currentStatus = {
      ...this.currentStatus,
      heartbeat_at: this.now(),
    };
    await this.statusStore.save(this.currentStatus);
  }

  async stop(): Promise<void> {
    await rm(this.paths.pidFile, { force: true });
    await this.statusStore.clear();
    this.currentStatus = null;
  }
}
