import type { AppRuntime, RuntimePaths } from "./main";

interface DaemonLifecycle {
  start: (input: { configPath: string; statePath: string }) => Promise<void>;
  heartbeat: () => Promise<void>;
  stop: () => Promise<void>;
}

interface RunConsoleDeps {
  buildApp: (paths: RuntimePaths) => Promise<AppRuntime>;
  loadWeixinSdk: () => Promise<{ start: (agent: AppRuntime["agent"]) => Promise<void> }>;
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
        () => deps.daemonRuntime?.heartbeat(),
        deps.heartbeatIntervalMs ?? 30_000,
      );
    }

    await sdk.start(runtime.agent);
  } finally {
    if (heartbeatTimer !== null) {
      clearIntervalFn(heartbeatTimer);
    }
    await runtime.dispose();
    if (deps.daemonRuntime) {
      await deps.daemonRuntime.stop();
    }
  }
}
