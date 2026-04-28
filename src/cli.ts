#!/usr/bin/env node
import { homedir } from "node:os";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createDaemonController } from "./daemon/create-daemon-controller";
import { resolveDaemonPaths } from "./daemon/daemon-files";
import type { DaemonController } from "./daemon/daemon-controller";
import { DaemonRuntime } from "./daemon/daemon-runtime";
import type { DaemonStatus } from "./daemon/daemon-status";
import type { DoctorRunOptions } from "./doctor/doctor-types";
import { runWeacpxMcpServer } from "./mcp/weacpx-mcp-server";
import { parseCoordinatorSession } from "./mcp/parse-coordinator-session";
import { parseSourceHandle } from "./mcp/parse-source-handle";
import { resolveDefaultOrchestrationEndpoint } from "./mcp/resolve-endpoint";
import { readVersion } from "./version.js";
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
  doctor?: (options: DoctorRunOptions) => number | Promise<number>;
  mcpStdio?: (args: string[]) => number | Promise<number>;
  controller?: CliController;
  print?: (line: string) => void;
  stderr?: (text: string) => void;
}

const HELP_LINES = [
  "用法：",
  "weacpx login  - 微信登录",
  "weacpx logout - 退出登录",
  "weacpx run    - 前台运行",
  "weacpx start  - 后台启动",
  "weacpx status - 查看状态",
  "weacpx stop   - 停止服务",
  "weacpx doctor - 运行诊断",
  "weacpx version - 查看版本",
  "weacpx mcp-stdio --coordinator-session <session> [--source-handle <handle>] - 启动 MCP stdio 服务",
];

export async function runCli(args: string[], deps: CliDeps = {}): Promise<number> {
  const command = args[0];
  const print = deps.print ?? ((line: string) => console.log(line));

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      print(readVersion());
      return 0;
    case "--help":
    case "-h": {
      for (const line of HELP_LINES) {
        print(line);
      }
      return 0;
    }
    case "login":
      await (deps.login ?? defaultLogin)();
      return 0;
    case "logout":
      await (deps.logout ?? defaultLogout)();
      return 0;
    case "run":
      await (deps.run ?? defaultRun)();
      return 0;
    case "doctor": {
      const parsed = parseDoctorArgs(args.slice(1));
      if (!parsed.ok) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }

      return await (deps.doctor ?? defaultDoctor)(parsed.options);
    }
    case "mcp-stdio":
      return await (deps.mcpStdio ?? ((subArgs) => defaultMcpStdio(subArgs, { stderr: deps.stderr })))(args.slice(1));
    case "start": {
      const controller = deps.controller ?? createDefaultController();
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
      const controller = deps.controller ?? createDefaultController();
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
      const controller = deps.controller ?? createDefaultController();
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

async function defaultDoctor(options: DoctorRunOptions): Promise<number> {
  const { main } = await import("./doctor/index");
  return await main(options);
}

async function defaultMcpStdio(
  args: string[],
  deps: { stderr?: (text: string) => void } = {},
): Promise<number> {
  const coordinatorSession = parseCoordinatorSession(args, process.env);
  const sourceHandle = parseSourceHandle(args, process.env);
  if (!coordinatorSession) {
    (deps.stderr ?? ((text: string) => process.stderr.write(text)))(
      "weacpx mcp-stdio 需要 --coordinator-session <handle> 或 WEACPX_COORDINATOR_SESSION 环境变量\n",
    );
    return 2;
  }

  await runWeacpxMcpServer({
    endpoint: resolveDefaultOrchestrationEndpoint(process.env, process.platform),
    coordinatorSession,
    ...(sourceHandle ? { sourceHandle } : {}),
  });
  return 0;
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

function parseDoctorArgs(args: string[]): { ok: true; options: DoctorRunOptions } | { ok: false } {
  const options: DoctorRunOptions = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--verbose":
        options.verbose = true;
        break;
      case "--smoke":
        options.smoke = true;
        break;
      case "--agent": {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
          return { ok: false };
        }
        options.agent = value;
        index++;
        break;
      }
      case "--workspace": {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
          return { ok: false };
        }
        options.workspace = value;
        index++;
        break;
      }
      default:
        return { ok: false };
    }
  }

  return { ok: true, options };
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
