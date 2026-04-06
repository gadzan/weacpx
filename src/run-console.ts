import type { AppRuntime, RuntimePaths } from "./main";
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
    start: (agent: AppRuntime["agent"], options?: { abortSignal?: AbortSignal }) => Promise<void>;
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

export async function runConsole(paths: RuntimePaths, deps: RunConsoleDeps): Promise<void> {
  const runtime = await deps.buildApp(paths);
  const consumerLock = deps.consumerLock ?? deps.consumerLockFactory?.(runtime);
  const sdk = await deps.loadWeixinSdk();
  const setIntervalFn = deps.setInterval ?? ((fn, delay) => setInterval(fn, delay));
  const clearIntervalFn = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const addProcessListener = deps.addProcessListener ?? ((signal, handler) => process.on(signal, handler));
  const removeProcessListener =
    deps.removeProcessListener ?? ((signal, handler) => process.off(signal, handler));
  const processPid = deps.processPid ?? process.pid;
  const now = deps.now ?? (() => new Date().toISOString());
  const hostname = deps.hostname ?? (() => "");

  let heartbeatTimer: unknown = null;
  let consumerLockAcquired = false;
  const shutdownController = new AbortController();
  const signalHandler = () => {
    shutdownController.abort();
  };
  addProcessListener("SIGINT", signalHandler);
  addProcessListener("SIGTERM", signalHandler);

  try {
    if (deps.daemonRuntime) {
      await deps.daemonRuntime.start({
        configPath: paths.configPath,
        statePath: paths.statePath,
      });
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

    await sdk.start(runtime.agent, { abortSignal: shutdownController.signal });
  } finally {
    let disposeError: unknown = null;
    removeProcessListener("SIGINT", signalHandler);
    removeProcessListener("SIGTERM", signalHandler);
    if (heartbeatTimer !== null) {
      clearIntervalFn(heartbeatTimer);
    }
    try {
      await runtime.dispose();
    } catch (error) {
      disposeError = error;
    }
    if (deps.daemonRuntime) {
      await deps.daemonRuntime.stop();
    }
    if (consumerLockAcquired) {
      await consumerLock?.release();
      await runtime.logger.info("weixin.consumer_lock.released", "released weixin consumer lock", {
        pid: processPid,
      });
    }
    if (disposeError) {
      throw disposeError;
    }
  }
}
