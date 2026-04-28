import type { AppRuntime, RuntimePaths } from "./main";
import type { PendingFinalChunk } from "./weixin/messaging/quota-manager";
import { ActiveWeixinConsumerLockError } from "./weixin/monitor/consumer-lock";

interface DaemonLifecycle {
  start: (input: { configPath: string; statePath: string }) => Promise<void>;
  heartbeat: () => Promise<void>;
  stop: () => Promise<void>;
}

interface ConsumerLock {
  acquire: (meta: {
    pid: number;
    mode: "foreground" | "daemon";
    startedAt: string;
    configPath: string;
    statePath: string;
    hostname?: string;
  }) => Promise<void>;
  release: () => Promise<void>;
}

interface RunConsoleDeps {
  buildApp: (paths: RuntimePaths) => Promise<AppRuntime>;
  loadWeixinSdk: () => Promise<{
    start: (
      agent: AppRuntime["agent"],
      options?: {
        abortSignal?: AbortSignal;
        onInbound?: (chatKey: string) => void;
        reserveFinal?: (chatKey: string) => boolean;
        finalRemaining?: (chatKey: string) => number;
        hasPendingFinal?: (chatKey: string) => boolean;
        drainPendingFinal?: (chatKey: string, available: number) => PendingFinalChunk[];
        prependPendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
        enqueuePendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
        dropPendingFinal?: (chatKey: string) => void;
      },
    ) => Promise<void>;
    login: () => Promise<string>;
    isLoggedIn: () => boolean;
  }>;
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
  daemonRuntime?: DaemonLifecycle;
  runtime: AppRuntime | null;
  consumerLock?: ConsumerLock;
  consumerLockAcquired: boolean;
  processPid: number;
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
  let sdk: Awaited<ReturnType<RunConsoleDeps["loadWeixinSdk"]>> | null = null;
  let heartbeatTimer: unknown = null;
  let consumerLockAcquired = false;
  const shutdownController = new AbortController();
  const signalHandler = () => {
    shutdownController.abort();
  };
  addProcessListener("SIGINT", signalHandler);
  addProcessListener("SIGTERM", signalHandler);

  try {
    runtime = await deps.buildApp(paths);
    consumerLock = deps.consumerLock ?? deps.consumerLockFactory?.(runtime);
    sdk = await deps.loadWeixinSdk();

    if (deps.daemonRuntime) {
      await deps.daemonRuntime.start({
        configPath: paths.configPath,
        statePath: paths.statePath,
      });
      await runtime.orchestration.server.start();
      heartbeatTimer = setIntervalFn(
        () => {
          void deps.daemonRuntime?.heartbeat().catch(() => {});
        },
        deps.heartbeatIntervalMs ?? 30_000,
      );
    }

    if (consumerLock) {
      const lockMeta: Parameters<ConsumerLock["acquire"]>[0] = {
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

    // Auto-detect login status, trigger QR login if not logged in
    if (!sdk.isLoggedIn()) {
      console.log("[weacpx] 未检测到登录凭证，正在启动扫码登录...");
      await sdk.login();
    }

    await sdk.start(runtime.agent, {
      abortSignal: shutdownController.signal,
      onInbound: (chatKey) => runtime!.quota.onInbound(chatKey),
      reserveFinal: (chatKey) => runtime!.quota.reserveFinal(chatKey),
      finalRemaining: (chatKey) => runtime!.quota.finalRemaining(chatKey),
      hasPendingFinal: (chatKey) => runtime!.quota.hasPendingFinal(chatKey),
      drainPendingFinal: (chatKey, available) =>
        runtime!.quota.drainPendingFinalUpToBudget(chatKey, available),
      prependPendingFinal: (chatKey, chunks) =>
        runtime!.quota.prependPendingFinal(chatKey, chunks),
      enqueuePendingFinal: (chatKey, chunks) =>
        runtime!.quota.enqueuePendingFinal(chatKey, chunks),
      dropPendingFinal: (chatKey) => runtime!.quota.clearPendingFinal(chatKey),
    });
  } finally {
    await runCleanupSequence({
      removeProcessListener,
      signalHandler,
      clearIntervalFn,
      heartbeatTimer,
      ...(deps.daemonRuntime ? { daemonRuntime: deps.daemonRuntime } : {}),
      runtime,
      consumerLock,
      consumerLockAcquired,
      processPid,
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

  if (input.daemonRuntime) {
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
