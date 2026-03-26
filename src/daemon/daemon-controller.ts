import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DaemonPaths } from "./daemon-files";
import { DaemonStatusStore, type DaemonStatus } from "./daemon-status";

interface DaemonControllerDeps {
  isProcessRunning: (pid: number) => boolean;
  spawnDetached: () => Promise<number>;
  terminateProcess: (pid: number) => Promise<void>;
}

type DaemonState =
  | { state: "stopped"; stale?: boolean }
  | { state: "running"; pid: number; status: DaemonStatus }
  | { state: "already-running"; pid: number };

export class DaemonController {
  private readonly statusStore: DaemonStatusStore;

  constructor(
    private readonly paths: DaemonPaths,
    private readonly deps: DaemonControllerDeps,
  ) {
    this.statusStore = new DaemonStatusStore(paths.statusFile);
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

    const pid = await this.deps.spawnDetached();
    await this.writePid(pid);
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
}
