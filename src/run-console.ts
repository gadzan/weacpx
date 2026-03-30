import type { AppRuntime, RuntimePaths } from "./main";

interface DaemonLifecycle {
  start: (input: { configPath: string; statePath: string }) => Promise<void>;
  heartbeat: () => Promise<void>;
  stop: () => Promise<void>;
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
}

export async function runConsole(paths: RuntimePaths, deps: RunConsoleDeps): Promise<void> {
  const runtime = await deps.buildApp(paths);
  const sdk = await deps.loadWeixinSdk();
  const setIntervalFn = deps.setInterval ?? ((fn, delay) => setInterval(fn, delay));
  const clearIntervalFn = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const addProcessListener = deps.addProcessListener ?? ((signal, handler) => process.on(signal, handler));
  const removeProcessListener =
    deps.removeProcessListener ?? ((signal, handler) => process.off(signal, handler));

  let heartbeatTimer: unknown = null;
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
    if (disposeError) {
      throw disposeError;
    }
  }
}
