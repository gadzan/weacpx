import type { AppRuntime, RuntimePaths } from "./main";

interface DaemonLifecycle {
  start: (input: { configPath: string; statePath: string }) => Promise<void>;
  heartbeat: () => Promise<void>;
  stop: () => Promise<void>;
}

interface RunConsoleDeps {
  buildApp: (paths: RuntimePaths) => Promise<AppRuntime>;
  loadWeixinSdk: () => Promise<{
    start: (agent: AppRuntime["agent"]) => Promise<void>;
    login: () => Promise<string>;
    isLoggedIn: () => boolean;
  }>;
  daemonRuntime?: DaemonLifecycle;
  heartbeatIntervalMs?: number;
  setInterval?: (fn: () => void | Promise<void>, delay: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}

export async function runConsole(paths: RuntimePaths, deps: RunConsoleDeps): Promise<void> {
  const runtime = await deps.buildApp(paths);
  const sdk = await deps.loadWeixinSdk();
  const setIntervalFn = deps.setInterval ?? ((fn, delay) => setInterval(fn, delay));
  const clearIntervalFn = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));

  let heartbeatTimer: unknown = null;

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

    await sdk.start(runtime.agent);
  } finally {
    let disposeError: unknown = null;
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
