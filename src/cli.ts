#!/usr/bin/env node
import { homedir } from "node:os";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createDaemonController } from "./daemon/create-daemon-controller";
import { resolveDaemonPaths } from "./daemon/daemon-files";
import type { DaemonController } from "./daemon/daemon-controller";
import { DaemonRuntime } from "./daemon/daemon-runtime";
import type { DaemonStatus } from "./daemon/daemon-status";
import { createWeixinConsumerLock } from "./weixin/monitor/consumer-lock";

interface StatusStopped {
  state: "stopped";
  stale?: boolean;
}

interface StatusRunning {
  state: "running";
  pid: number;
  status: DaemonStatus;
}

interface StartStarted {
  state: "started";
  pid: number;
}

interface StartAlreadyRunning {
  state: "already-running";
  pid: number;
}

interface StopStopped {
  state: "stopped";
  detail: "not-running" | "stopped";
}

interface CliController {
  getStatus: DaemonController["getStatus"];
  start: () => Promise<StartStarted | StartAlreadyRunning>;
  stop: () => Promise<StopStopped>;
}

interface CliDeps {
  login?: () => Promise<void>;
  logout?: () => Promise<void>;
  run?: () => Promise<void>;
  controller?: CliController;
  print?: (line: string) => void;
}

const HELP_LINES = [
  "用法：",
  "weacpx login  - 微信登录",
  "weacpx logout - 退出登录",
  "weacpx run    - 前台运行",
  "weacpx start  - 后台启动",
  "weacpx status - 查看状态",
  "weacpx stop   - 停止服务",
];

export async function runCli(args: string[], deps: CliDeps = {}): Promise<number> {
  const command = args[0];
  const print = deps.print ?? ((line: string) => console.log(line));
  const controller = deps.controller ?? createDefaultController();

  switch (command) {
    case "login":
      await (deps.login ?? defaultLogin)();
      return 0;
    case "logout":
      await (deps.logout ?? defaultLogout)();
      return 0;
    case "run":
      await (deps.run ?? defaultRun)();
      return 0;
    case "start": {
      const result = await controller.start();
      if (result.state === "already-running") {
        print("weacpx 已在后台运行");
        print(`PID: ${result.pid}`);
        return 0;
      }

      print("weacpx 已在后台启动");
      print(`PID: ${result.pid}`);
      return 0;
    }
    case "status": {
      const status = await controller.getStatus();
      if (status.state === "indeterminate") {
        print("weacpx 进程仍在运行，但状态元数据缺失");
        print(`PID: ${status.pid}`);
        return 1;
      }

      if (status.state !== "running") {
        print("weacpx 未运行");
        return 0;
      }

      print("weacpx 正在运行");
      print(`PID: ${status.pid}`);
      print(`Started: ${status.status.started_at}`);
      print(`Heartbeat: ${status.status.heartbeat_at}`);
      print(`Config: ${status.status.config_path}`);
      print(`State: ${status.status.state_path}`);
      print(`App Log: ${status.status.app_log}`);
      print(`Stdout: ${status.status.stdout_log}`);
      print(`Stderr: ${status.status.stderr_log}`);
      return 0;
    }
    case "stop": {
      const result = await controller.stop();
      if (result.detail === "not-running") {
        print("weacpx 未运行");
        return 0;
      }
      print("weacpx 已停止");
      return 0;
    }
    default:
      for (const line of HELP_LINES) {
        print(line);
      }
      return 1;
  }
}

async function defaultLogin(): Promise<void> {
  const { main } = await import("./login");
  await main();
}

async function defaultLogout(): Promise<void> {
  const { logout } = await import("./weixin-sdk");
  logout();
}

async function defaultRun(): Promise<void> {
  const [{ buildApp, resolveRuntimePaths }, { loadWeixinSdk }, { runConsole }] = await Promise.all([
    import("./main"),
    import("./weixin-sdk"),
    import("./run-console"),
  ]);
  const runtimePaths = resolveRuntimePaths();
  const daemonPaths = resolveDaemonPaths({ home: requireHome() });
  const daemonRuntime = new DaemonRuntime(daemonPaths, { pid: process.pid });

  await runConsole(runtimePaths, {
    buildApp: (paths) =>
      buildApp(paths, {
        defaultLoggingLevel: resolveCliEntryPath().includes(`${sep}src${sep}`) ? "debug" : "info",
      }),
    loadWeixinSdk,
    daemonRuntime,
    consumerLockFactory: (runtime) =>
      createWeixinConsumerLock({
        lockFilePath: `${daemonPaths.runtimeDir}${sep}weixin-consumer.lock.json`,
        onDiagnostic: async (event, context) => {
          await runtime.logger.info(`weixin.consumer_lock.${event}`, "weixin consumer lock diagnostic", context);
        },
      }),
  });
}

function createDefaultController(): CliController {
  const daemonPaths = resolveDaemonPaths({ home: requireHome() });
  return createDaemonController(daemonPaths, {
    processExecPath: process.execPath,
    cliEntryPath: resolveCliEntryPath(),
    cwd: process.cwd(),
    env: process.env,
  });
}

function requireHome(): string {
  const home = process.env.HOME ?? homedir();
  if (!home) {
    throw new Error("Unable to resolve the current user home directory");
  }
  return home;
}

function resolveCliEntryPath(): string {
  if (process.argv[1]) {
    return process.argv[1];
  }

  return fileURLToPath(import.meta.url);
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}


