import { rm, writeFile } from "node:fs/promises";

import type { DaemonPaths } from "./daemon-files";
import { DaemonStatusStore, type DaemonStatus } from "./daemon-status";
import { ensurePrivateRuntimeDir } from "./private-runtime-dir";

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

    // Daemon startup runs before the orchestration server listens: ensure the
    // runtime dir is user-private (0700) so the socket is never reachable by
    // other accounts, and repair pre-existing installs created at 0755.
    await ensurePrivateRuntimeDir(this.paths.runtimeDir);
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
