import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DaemonPaths } from "./daemon-files";
import { DaemonStatusStore, type DaemonStatus } from "./daemon-status";

interface DaemonControllerDeps {
  isProcessRunning: (pid: number) => boolean;
  spawnDetached: () => Promise<number>;
  terminateProcess: (pid: number) => Promise<void>;
  startupPollIntervalMs?: number;
  startupTimeoutMs?: number;
  onStartupPoll?: () => Promise<void>;
}

type DaemonState =
  | { state: "stopped"; stale?: boolean }
  | { state: "running"; pid: number; status: DaemonStatus }
  | { state: "already-running"; pid: number };

export class DaemonController {
  private readonly statusStore: DaemonStatusStore;
  private readonly startupPollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly onStartupPoll: () => Promise<void>;

  constructor(
    private readonly paths: DaemonPaths,
    private readonly deps: DaemonControllerDeps,
  ) {
    this.statusStore = new DaemonStatusStore(paths.statusFile);
    this.startupPollIntervalMs = deps.startupPollIntervalMs ?? 50;
    this.startupTimeoutMs = deps.startupTimeoutMs ?? 5_000;
    this.onStartupPoll = deps.onStartupPoll ?? (async () => {
      await new Promise((resolve) => setTimeout(resolve, this.startupPollIntervalMs));
    });
  }

  async getStatus(): Promise<DaemonState> {
    const pid = await this.loadPid();
    const status = await this.statusStore.load();

    if (!pid) {
      return { state: "stopped" };
    }

    if (!this.deps.isProcessRunning(pid)) {
      await this.clearRuntimeFiles();
      return { state: "stopped", stale: true };
    }

    if (!status) {
      return { state: "stopped" };
    }

    return {
      state: "running",
      pid,
      status,
    };
  }

  async start(): Promise<{ state: "already-running"; pid: number } | { state: "started"; pid: number }> {
    const current = await this.getStatus();
    if (current.state === "running") {
      return { state: "already-running", pid: current.pid };
    }

    // Clear any stale status file before spawning so that a matching PID from a
    // recycled process does not cause a spurious immediate return from
    // waitForStartupMetadata.
    await this.statusStore.clear();
    const pid = await this.deps.spawnDetached();
    await this.writePid(pid);
    await this.waitForStartupMetadata(pid);
    return { state: "started", pid };
  }

  async stop(): Promise<{ state: "stopped"; detail: "not-running" | "stopped" }> {
    const pid = await this.loadPid();
    if (!pid) {
      return { state: "stopped", detail: "not-running" };
    }

    if (this.deps.isProcessRunning(pid)) {
      await this.deps.terminateProcess(pid);
    }

    await this.clearRuntimeFiles();
    return { state: "stopped", detail: "stopped" };
  }

  private async loadPid(): Promise<number | null> {
    try {
      const content = await readFile(this.paths.pidFile, "utf8");
      const pid = Number(content.trim());
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async writePid(pid: number): Promise<void> {
    await mkdir(dirname(this.paths.pidFile), { recursive: true });
    await writeFile(this.paths.pidFile, `${pid}\n`);
  }

  private async clearRuntimeFiles(): Promise<void> {
    await rm(this.paths.pidFile, { force: true });
    await this.statusStore.clear();
  }

  private async waitForStartupMetadata(pid: number): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.statusStore.load();
      if (status?.pid === pid) {
        return;
      }

      if (!this.deps.isProcessRunning(pid)) {
        await this.clearRuntimeFiles();
        throw new Error(`weacpx daemon exited before reporting ready state (pid ${pid})`);
      }

      await this.onStartupPoll();
    }

    throw new Error(`weacpx daemon did not report ready state within ${this.startupTimeoutMs}ms (pid ${pid})`);
  }
}
