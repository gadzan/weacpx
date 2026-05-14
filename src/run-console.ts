import type { AppRuntime, RuntimePaths } from "./main";
import type { ChannelStartInput, ConsumerLock, ConsumerLockMetadata } from "./channels/types.js";
import { ActiveWeixinConsumerLockError } from "./weixin/monitor/consumer-lock";

interface DaemonLifecycle {
  start: (input: { configPath: string; statePath: string }) => Promise<void>;
  heartbeat: () => Promise<void>;
  stop: () => Promise<void>;
}

interface ChannelRegistry {
  startAll(input: ChannelStartInput): Promise<void>;
  stopAll?(): void | Promise<void>;
}

interface RunConsoleDeps {
  buildApp: (paths: RuntimePaths) => Promise<AppRuntime>;
  afterBuild?: (runtime: AppRuntime) => Promise<void>;
  beforeReady?: (runtime: AppRuntime) => Promise<void>;
  channels: ChannelRegistry;
  daemonRuntime?: DaemonLifecycle;
  heartbeatIntervalMs?: number;
  setInterval?: (fn: () => void | Promise<void>, delay: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  addProcessListener?: (signal: NodeJS.Signals, handler: () => void) => void;
  removeProcessListener?: (signal: NodeJS.Signals, handler: () => void) => void;
  consumerLock?: ConsumerLock;
  consumerLockFactory?: (runtime: AppRuntime) => ConsumerLock;
  processPid?: number;
  now?: () => string;
  hostname?: () => string;
}

interface RunCleanupSequenceInput {
  removeProcessListener: (signal: NodeJS.Signals, handler: () => void) => void;
  signalHandler: () => void;
  clearIntervalFn: (timer: unknown) => void;
  heartbeatTimer: unknown;
  gcResetTimer: unknown;
  daemonRuntime?: DaemonLifecycle;
  daemonRuntimeStarted: boolean;
  runtime: AppRuntime | null;
  consumerLock?: ConsumerLock;
  consumerLockAcquired: boolean;
  processPid: number;
  channels?: ChannelRegistry;
}

export async function runConsole(paths: RuntimePaths, deps: RunConsoleDeps): Promise<void> {
  const setIntervalFn = deps.setInterval ?? ((fn, delay) => setInterval(fn, delay));
  const clearIntervalFn = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const addProcessListener = deps.addProcessListener ?? ((signal, handler) => process.on(signal, handler));
  const removeProcessListener =
    deps.removeProcessListener ?? ((signal, handler) => process.off(signal, handler));
  const processPid = deps.processPid ?? process.pid;
  const now = deps.now ?? (() => new Date().toISOString());
  const hostname = deps.hostname ?? (() => "");

  let runtime: AppRuntime | null = null;
  let consumerLock: ConsumerLock | undefined;
  let heartbeatTimer: unknown = null;
  let gcResetTimer: unknown = null;
  let consumerLockAcquired = false;
  let daemonRuntimeStarted = false;
  const shutdownController = new AbortController();
  const signalHandler = () => {
    shutdownController.abort();
  };
  addProcessListener("SIGINT", signalHandler);
  addProcessListener("SIGTERM", signalHandler);

  try {
    runtime = await deps.buildApp(paths);
    if (deps.afterBuild) {
      await deps.afterBuild(runtime);
    }
    try {
      await runtime.orchestration.service.purgeExpiredResetCoordinators({
        cutoffDays: 7,
        trigger: "startup",
      });
    } catch {}
    consumerLock = deps.consumerLock ?? deps.consumerLockFactory?.(runtime);

    if (consumerLock) {
      const lockMeta: ConsumerLockMetadata = {
        pid: processPid,
        mode: deps.daemonRuntime ? "daemon" : "foreground",
        startedAt: now(),
        configPath: paths.configPath,
        statePath: paths.statePath,
        hostname: hostname() || undefined,
      };
      await runtime.logger.info("weixin.consumer_lock.acquire_attempt", "attempting to acquire weixin consumer lock", {
        pid: lockMeta.pid,
        mode: lockMeta.mode,
        configPath: lockMeta.configPath,
        statePath: lockMeta.statePath,
        hostname: lockMeta.hostname,
      });
      try {
        await consumerLock.acquire(lockMeta);
        consumerLockAcquired = true;
        await runtime.logger.info("weixin.consumer_lock.acquired", "acquired weixin consumer lock", {
          pid: lockMeta.pid,
          mode: lockMeta.mode,
          configPath: lockMeta.configPath,
          statePath: lockMeta.statePath,
        });
      } catch (error) {
        if (error instanceof ActiveWeixinConsumerLockError) {
          await runtime.logger.error("weixin.consumer_lock.acquire_failed", "weixin consumer lock is already held by another process", {
            conflictType: "active_lock_holder",
            activePid: error.existing.pid,
            activeMode: error.existing.mode,
            activeConfigPath: error.existing.configPath,
            activeStatePath: error.existing.statePath,
            requestedPid: lockMeta.pid,
            requestedMode: lockMeta.mode,
          });
        } else {
          await runtime.logger.error("weixin.consumer_lock.acquire_failed", "failed to acquire weixin consumer lock", {
            conflictType: deps.daemonRuntime ? "daemon_startup_lock_failure" : "foreground_startup_lock_failure",
            requestedPid: lockMeta.pid,
            requestedMode: lockMeta.mode,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    }

    if (deps.beforeReady) {
      await deps.beforeReady(runtime);
    }

    if (deps.daemonRuntime) {
      await deps.daemonRuntime.start({
        configPath: paths.configPath,
        statePath: paths.statePath,
      });
      daemonRuntimeStarted = true;
      await runtime.orchestration.server.start();
      heartbeatTimer = setIntervalFn(
        () => {
          void deps.daemonRuntime?.heartbeat().catch(() => {});
        },
        deps.heartbeatIntervalMs ?? 30_000,
      );
      const runtimeForGc = runtime;
      gcResetTimer = setIntervalFn(
        () => {
          void runtimeForGc.orchestration.service
            .purgeExpiredResetCoordinators({ cutoffDays: 7, trigger: "interval" })
            .catch(() => {});
        },
        86_400_000,
      );
    }

    await deps.channels.startAll({
      agent: runtime.agent,
      abortSignal: shutdownController.signal,
      quota: runtime.quota,
      logger: runtime.logger,
    });
  } finally {
    await runCleanupSequence({
      removeProcessListener,
      signalHandler,
      clearIntervalFn,
      heartbeatTimer,
      gcResetTimer,
      ...(deps.daemonRuntime ? { daemonRuntime: deps.daemonRuntime } : {}),
      runtime,
      consumerLock,
      consumerLockAcquired,
      processPid,
      channels: deps.channels,
      daemonRuntimeStarted,
    });
  }
}

async function runCleanupSequence(input: RunCleanupSequenceInput): Promise<void> {
  let cleanupError: unknown = null;
  input.removeProcessListener("SIGINT", input.signalHandler);
  input.removeProcessListener("SIGTERM", input.signalHandler);
  if (input.heartbeatTimer !== null) {
    input.clearIntervalFn(input.heartbeatTimer);
  }
  if (input.gcResetTimer !== null) {
    input.clearIntervalFn(input.gcResetTimer);
  }

  if (input.daemonRuntime && input.runtime) {
    try {
      await input.runtime.orchestration.server.stop();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (input.runtime) {
    try {
      await input.runtime.dispose();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (input.channels) {
    try {
      await input.channels.stopAll?.();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (input.daemonRuntime && input.daemonRuntimeStarted) {
    try {
      await input.daemonRuntime.stop();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (input.consumerLockAcquired) {
    try {
      await input.consumerLock?.release();
      if (input.runtime) {
        await input.runtime.logger.info("weixin.consumer_lock.released", "released weixin consumer lock", {
          pid: input.processPid,
        });
      }
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (cleanupError) {
    throw cleanupError;
  }
}
