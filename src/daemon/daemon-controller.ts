import { open, readFile, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { DaemonPaths } from "./daemon-files";
import { DaemonStatusStore, type DaemonStatus } from "./daemon-status";
import { ensurePrivateRuntimeDir } from "./private-runtime-dir";

export interface DaemonStartupWaitPoll {
  elapsedMs: number;
  timeoutMs: number;
  pid: number;
}

export interface DaemonStartupWait {
  onPoll?: (input: DaemonStartupWaitPoll) => void | Promise<void>;
  shouldStopWaiting?: () => boolean;
}

interface DaemonControllerDeps {
  isProcessRunning: (pid: number) => boolean;
  spawnDetached: (options?: { firstRunOnboarding?: string; startupWait?: DaemonStartupWait }) => Promise<number>;
  terminateProcess: (pid: number) => Promise<void>;
  startupPollIntervalMs?: number;
  startupTimeoutMs?: number;
  onboardingStartupTimeoutMs?: number;
  onStartupPoll?: () => Promise<void>;
  shutdownPollIntervalMs?: number;
  shutdownTimeoutMs?: number;
  onShutdownPoll?: () => Promise<void>;
  now?: () => number;
}

type DaemonState =
  | { state: "stopped"; stale?: boolean }
  | { state: "running"; pid: number; status: DaemonStatus }
  | { state: "indeterminate"; pid: number; reason: "missing-status" }
  | { state: "already-running"; pid: number };

export class DaemonController {
  private readonly statusStore: DaemonStatusStore;
  private readonly startupPollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly onboardingStartupTimeoutMs: number;
  private readonly onStartupPoll: () => Promise<void>;
  private readonly shutdownPollIntervalMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly onShutdownPoll: () => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly paths: DaemonPaths,
    private readonly deps: DaemonControllerDeps,
  ) {
    this.statusStore = new DaemonStatusStore(paths.statusFile);
    this.startupPollIntervalMs = deps.startupPollIntervalMs ?? 50;
    // Backstop only: with the orphan sweep decoupled from the ready signal (see
    // run-console), the daemon writes status.json within a fraction of a second. This
    // headroom just absorbs unrelated slow-startup costs (plugin load, busy disk) without
    // masking a genuine hang — a crashed daemon is still detected immediately via the
    // per-poll isProcessRunning() check, independent of this timeout.
    this.startupTimeoutMs = deps.startupTimeoutMs ?? 10_000;
    this.onboardingStartupTimeoutMs = deps.onboardingStartupTimeoutMs ?? 300_000;
    this.shutdownPollIntervalMs = deps.shutdownPollIntervalMs ?? 50;
    this.shutdownTimeoutMs = deps.shutdownTimeoutMs ?? 5_000;
    this.now = deps.now ?? (() => Date.now());
    this.onStartupPoll = deps.onStartupPoll ?? (async () => {
      await new Promise((resolve) => setTimeout(resolve, this.startupPollIntervalMs));
    });
    this.onShutdownPoll = deps.onShutdownPoll ?? (async () => {
      await new Promise((resolve) => setTimeout(resolve, this.shutdownPollIntervalMs));
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
      return { state: "indeterminate", pid, reason: "missing-status" };
    }

    return {
      state: "running",
      pid,
      status,
    };
  }

  async start(options: { firstRunOnboarding?: string; startupWait?: DaemonStartupWait } = {}): Promise<{ state: "already-running"; pid: number } | { state: "started"; pid: number }> {
    const current = await this.getStatus();
    if (current.state === "running") {
      return { state: "already-running", pid: current.pid };
    }
    if (current.state === "indeterminate") {
      throw new Error(
        `xacpx daemon process is already running (pid ${current.pid}) but status metadata is missing`,
      );
    }

    // Exclusively claim the pid file before spawning. getStatus() above already
    // cleared any stale pid file, so a genuinely stopped daemon leaves this open;
    // a second concurrent `start` loses the race here and aborts instead of
    // launching a duplicate daemon.
    const pidHandle = await this.openPidFileExclusive();
    let pid: number;
    try {
      // Clear any stale status file before spawning so that a matching PID from a
      // recycled process does not cause a spurious immediate return from
      // waitForStartupMetadata.
      await this.statusStore.clear();
      pid = await this.deps.spawnDetached(options);
      await pidHandle.write(`${pid}\n`);
    } catch (error) {
      // Spawn or pid write failed before the daemon could take over: drop our
      // exclusive pid file so a retry can start cleanly.
      await pidHandle.close().catch(() => {});
      await rm(this.paths.pidFile, { force: true }).catch(() => {});
      throw error;
    }
    await pidHandle.close();
    // From here the daemon owns the pid file; on a startup timeout we leave it in
    // place so `stop` can still reach a slow-but-live daemon.
    await this.waitForStartupMetadata(
      pid,
      options.firstRunOnboarding ? this.onboardingStartupTimeoutMs : this.startupTimeoutMs,
      options.startupWait,
    );
    return { state: "started", pid };
  }

  async stop(): Promise<{ state: "stopped"; detail: "not-running" | "stopped" }> {
    const pid = await this.loadPid();
    if (!pid) {
      return { state: "stopped", detail: "not-running" };
    }

    if (this.deps.isProcessRunning(pid)) {
      await this.deps.terminateProcess(pid);
      await this.waitForShutdown(pid);
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

  private async openPidFileExclusive(): Promise<FileHandle> {
    // User-private (0700): the runtime dir holds the orchestration socket,
    // whose only access control is filesystem permissions.
    await ensurePrivateRuntimeDir(this.paths.runtimeDir);
    try {
      return await open(this.paths.pidFile, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `xacpx daemon pid file already exists (${this.paths.pidFile}); another start may be in progress`,
        );
      }
      throw error;
    }
  }

  private async clearRuntimeFiles(): Promise<void> {
    await rm(this.paths.pidFile, { force: true });
    await this.statusStore.clear();
  }

  private async waitForStartupMetadata(pid: number, timeoutMs: number, startupWait?: DaemonStartupWait): Promise<void> {
    const startedAt = this.now();
    const deadline = startedAt + timeoutMs;
    while (this.now() < deadline) {
      const status = await this.statusStore.load();
      if (status?.pid === pid) {
        return;
      }

      if (!this.deps.isProcessRunning(pid)) {
        await this.clearRuntimeFiles();
        throw new Error(`xacpx daemon exited before reporting ready state (pid ${pid})`);
      }

      if (startupWait?.shouldStopWaiting?.()) {
        return;
      }

      await startupWait?.onPoll?.({
        elapsedMs: this.now() - startedAt,
        timeoutMs,
        pid,
      });
      await this.onStartupPoll();
    }

    throw new Error(`xacpx daemon did not report ready state within ${timeoutMs}ms (pid ${pid})`);
  }

  private async waitForShutdown(pid: number): Promise<void> {
    const deadline = Date.now() + this.shutdownTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.deps.isProcessRunning(pid)) {
        return;
      }

      await this.onShutdownPoll();
    }

    if (!this.deps.isProcessRunning(pid)) {
      return;
    }

    throw new Error(`xacpx daemon did not exit within ${this.shutdownTimeoutMs}ms (pid ${pid})`);
  }
}
