#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigStore } from "./config/config-store";
import { loadConfig } from "./config/load-config";
import { ensureConfigExists } from "./config/ensure-config";
import { getAgentTemplate, listAgentTemplates, sameAgentConfig } from "./config/agent-templates";
import { createDaemonController } from "./daemon/create-daemon-controller";
import { resolveDaemonPaths, resolveRuntimeDirFromConfigPath } from "./daemon/daemon-files";
import type { DaemonController } from "./daemon/daemon-controller";
import { DaemonRuntime } from "./daemon/daemon-runtime";
import type { DaemonStatus } from "./daemon/daemon-status";
import type { DoctorRunOptions } from "./doctor/doctor-types";
import { runWeacpxMcpServer } from "./mcp/weacpx-mcp-server";
import {
  inferExternalCoordinatorSession,
} from "./mcp/infer-coordinator-identity";
import { parseCoordinatorWorkspace } from "./mcp/parse-coordinator-workspace";
import { parseCoordinatorSession } from "./mcp/parse-coordinator-session";
import { parseInternalSessionToolsFlag } from "./mcp/parse-internal-session-tools";
import { parseSourceHandle } from "./mcp/parse-source-handle";
import { resolveDefaultOrchestrationEndpoint } from "./mcp/resolve-endpoint";
import { createOrchestrationTransport } from "./mcp/weacpx-mcp-transport";
import { OrchestrationClient } from "./orchestration/orchestration-client";
import { basenameForWorkspacePath, normalizeWorkspacePath, sameWorkspacePath } from "./commands/workspace-path";
import {
  allocateWorkspaceName,
  isWorkspaceNameValid,
  quoteWorkspaceNameIfNeeded,
  sanitizeWorkspaceName,
} from "./commands/workspace-name";
import { StateStore } from "./state/state-store";
import { toDisplaySessionAlias } from "./channels/channel-scope";
import { renderLaterList } from "./scheduled/scheduled-render";
import { ScheduledTaskService, normalizeId } from "./scheduled/scheduled-service";
import { maybeRunFirstUseOnboarding, type FirstRunOnboardingPlan } from "./onboarding.js";
import { handleUpdateCli, type UpdateCliDeps } from "./cli-update.js";
import type { AppConfig } from "./config/types";
import type { AppState } from "./state/types";
import { readVersion } from "./version.js";
import { handleChannelCli, type ChannelCliDeps } from "./channels/cli/channel-cli";
import { handlePluginCli, type PluginCliDeps } from "./plugins/plugin-cli";
import { createStartupWaitUi } from "./cli/startup-wait-ui";
import type { DaemonStartupWait } from "./daemon/daemon-controller";


export interface PrepareMcpCoordinatorStartupInput {
  coordinatorSession: string;
  workspace?: string | null;
  config: Pick<AppConfig, "workspaces">;
  state: Pick<AppState, "sessions"> & {
    orchestration?: Pick<AppState["orchestration"], "externalCoordinators">;
  };
  client: {
    registerExternalCoordinator: (input: { coordinatorSession: string; workspace?: string }) => Promise<unknown>;
  };
}

export type PrepareMcpCoordinatorStartupResult =
  | { kind: "existing-session" }
  | { kind: "external-coordinator"; workspace?: string };

export async function prepareMcpCoordinatorStartup(
  input: PrepareMcpCoordinatorStartupInput,
): Promise<PrepareMcpCoordinatorStartupResult> {
  const coordinatorSession = input.coordinatorSession.trim();
  const existingSession = Object.values(input.state.sessions).find(
    (session) => session.transport_session === coordinatorSession,
  );

  const workspace = input.workspace?.trim();
  if (workspace) {
    if (existingSession) {
      throw new Error(`coordinatorSession "${coordinatorSession}" conflicts with an existing logical session`);
    }
    const existingExternalCoordinator = input.state.orchestration?.externalCoordinators?.[coordinatorSession];
    if (existingExternalCoordinator?.workspace && existingExternalCoordinator.workspace !== workspace) {
      throw new Error(
        `coordinatorSession "${coordinatorSession}" is already bound to workspace "${existingExternalCoordinator.workspace}"; use a new coordinator session for workspace "${workspace}"`,
      );
    }
    if (!input.config.workspaces[workspace]) {
      if (existingExternalCoordinator?.workspace === workspace) {
        throw new Error(
          `workspace "${workspace}" is not configured for coordinatorSession "${coordinatorSession}"; restore that workspace config or use a new coordinator session for a different workspace`,
        );
      }
      throw new Error(`workspace "${workspace}" is not configured`);
    }

    await registerExternalCoordinatorOrThrow(input.client, { coordinatorSession, workspace });
    return { kind: "external-coordinator", workspace };
  }

  if (existingSession) {
    return { kind: "existing-session" };
  }

  const existingExternalCoordinator = input.state.orchestration?.externalCoordinators?.[coordinatorSession];
  if (existingExternalCoordinator) {
    if (existingExternalCoordinator.workspace && !input.config.workspaces[existingExternalCoordinator.workspace]) {
      throw new Error(
        `workspace "${existingExternalCoordinator.workspace}" is not configured for coordinatorSession "${coordinatorSession}"; restore that workspace config or use a new coordinator session for a different workspace`,
      );
    }
    await registerExternalCoordinatorOrThrow(input.client, {
      coordinatorSession,
      ...(existingExternalCoordinator.workspace ? { workspace: existingExternalCoordinator.workspace } : {}),
    });
    return {
      kind: "external-coordinator",
      ...(existingExternalCoordinator.workspace ? { workspace: existingExternalCoordinator.workspace } : {}),
    };
  }

  await registerExternalCoordinatorOrThrow(input.client, { coordinatorSession });
  return { kind: "external-coordinator" };
}

export function createMcpStdioIdentityResolver(input: {
  parsedCoordinatorSession?: string | null;
  sourceHandle?: string | null;
  workspace?: string | null;
  config: Pick<AppConfig, "workspaces">;
  state: Pick<AppState, "sessions"> & {
    orchestration?: Pick<AppState["orchestration"], "externalCoordinators">;
  };
  client: PrepareMcpCoordinatorStartupInput["client"];
  internalSessionTools?: boolean;
}): NonNullable<Parameters<typeof runWeacpxMcpServer>[0]["resolveIdentity"]> {
  const instanceId = randomUUID().slice(0, 8);
  return async (context) => {
    const parsedCoordinatorSession = input.parsedCoordinatorSession?.trim() || null;
    const workspace = input.workspace?.trim() || null;
    const sourceHandle = input.sourceHandle?.trim() || null;

    const resolvedWorkspace = workspace;
    const resolvedCoordinatorSession = parsedCoordinatorSession ?? inferExternalCoordinatorSession({
      clientName: context.clientName,
      ...(resolvedWorkspace ? { workspace: resolvedWorkspace } : { instanceId }),
    });
    const startup = await prepareMcpCoordinatorStartup({
      coordinatorSession: resolvedCoordinatorSession,
      ...(resolvedWorkspace ? { workspace: resolvedWorkspace } : {}),
      config: input.config,
      state: input.state,
      client: input.client,
    });
    return {
      coordinatorSession: resolvedCoordinatorSession,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(startup.kind === "external-coordinator" ? { isExternalCoordinator: true } : {}),
      ...(input.internalSessionTools && startup.kind === "existing-session" && !sourceHandle
        ? { internalSessionTools: true }
        : {}),
    };
  };
}

async function registerExternalCoordinatorOrThrow(
  client: PrepareMcpCoordinatorStartupInput["client"],
  input: { coordinatorSession: string; workspace?: string },
): Promise<void> {
  try {
    await client.registerExternalCoordinator(input);
  } catch (error) {
    if (isUnavailableOrchestrationIpcError(error)) {
      throw new Error(
        "weacpx daemon orchestration IPC is unavailable; run `weacpx start` and check `weacpx status`",
      );
    }
    if (input.workspace && isDaemonWorkspaceNotConfiguredError(error, input.workspace)) {
      throw new Error(
        `workspace "${input.workspace}" is not configured in the running daemon; restart it with \`weacpx stop && weacpx start\``,
      );
    }
    throw error;
  }
}

function isDaemonWorkspaceNotConfiguredError(error: unknown, workspace: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === `workspace "${workspace}" is not configured`;
}

function isUnavailableOrchestrationIpcError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : "";
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ECONNRESET") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /connect (ENOENT|ECONNREFUSED|ECONNRESET)\b/.test(message);
}

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
  start: (options?: { firstRunOnboarding?: FirstRunOnboardingPlan; startupWait?: DaemonStartupWait }) => Promise<StartStarted | StartAlreadyRunning>;
  stop: () => Promise<StopStopped>;
}

interface CliDeps {
  login?: () => Promise<void>;
  logout?: () => Promise<void>;
  run?: (options?: { firstRunOnboarding?: FirstRunOnboardingPlan }) => Promise<void>;
  update?: (args: string[]) => Promise<number | null>;
  readVersion?: () => string;
  doctor?: (options: DoctorRunOptions) => number | Promise<number>;
  mcpStdio?: (args: string[]) => number | Promise<number>;
  controller?: CliController;
  print?: (line: string) => void;
  stderr?: (text: string) => void;
  cwd?: () => string;
  channelCliDeps?: Partial<ChannelCliDeps>;
  pluginCliDeps?: Partial<PluginCliDeps>;
  updateCliDeps?: Partial<UpdateCliDeps>;
  loadConfiguredPluginsForChannelCli?: () => Promise<void>;
  isInteractive?: () => boolean;
  promptText?: (message: string) => Promise<string>;
  promptSecret?: (message: string) => Promise<string>;
  isProcessRunning?: (pid: number) => boolean;
}

const HELP_LINES = [
  "用法：",
  "weacpx login  - 微信登录",
  "weacpx logout - 退出登录",
  "weacpx run    - 前台运行",
  "weacpx start  - 后台启动",
  "weacpx status - 查看状态",
  "weacpx stop   - 停止服务",
  "weacpx restart - 重启后台服务",
  "weacpx update [--all|<name>] - 更新 weacpx 和已安装插件",
  "weacpx channel|ch list|show|add|rm|enable|disable [--account <id>] - 管理消息频道（多 bot 用 --account）",
  "weacpx plugin list|add|update|remove|enable|disable|doctor|known - 管理插件",
  "weacpx doctor - 运行诊断",
  "weacpx version - 查看版本",
  "weacpx agent|agents list|add|rm|templates - 管理本机 Agent",
  "weacpx workspace list|add [name] [--raw]|rm <name> - 管理本机工作区（别名：ws）",
  "weacpx later|lt list|cancel <id> - 管理本机待执行定时任务",
  "weacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务",
];

export function getUsageText(): string {
  return HELP_LINES.join("\n");
}

import { bootstrapBuiltinChannels } from "./channels/bootstrap.js";

export async function runCli(args: string[], deps: CliDeps = {}): Promise<number> {
  bootstrapBuiltinChannels();
  const command = args[0];
  const print = deps.print ?? ((line: string) => console.log(line));

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      print((deps.readVersion ?? readVersion)());
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
      const onboarding = await runOnboardingBeforeStart({
        print,
        cwd: deps.cwd ?? (() => process.cwd()),
        isInteractive: deps.isInteractive,
        promptText: deps.promptText,
      });
      await (deps.run ?? defaultRun)({ firstRunOnboarding: onboarding ?? undefined });
      return 0;
    case "update": {
      const result = await (deps.update ?? ((subArgs) => defaultUpdate(subArgs, {
        print,
        isInteractive: deps.isInteractive,
        promptText: deps.promptText,
        overrides: deps.updateCliDeps,
      })))(args.slice(1));
      if (result === null) {
        for (const line of HELP_LINES) print(line);
        return 1;
      }
      return result;
    }
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
    case "workspace":
    case "ws": {
      const result = await handleWorkspaceCli(args.slice(1), {
        print,
        cwd: deps.cwd ?? (() => process.cwd()),
      });
      if (result === null) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }
      return result;
    }
    case "agent":
    case "agents": {
      const result = await handleAgentCli(args.slice(1), { print });
      if (result === null) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }
      return result;
    }
    case "later":
    case "lt": {
      const result = await handleLaterCli(args.slice(1), { print });
      if (result === null) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }
      return result;
    }
    case "plugin": {
      const result = await handlePluginCli(args.slice(1), await createPluginCliDeps({
        print,
        controller: deps.controller,
        isInteractive: deps.isInteractive,
        promptText: deps.promptText,
        overrides: deps.pluginCliDeps,
      }));
      if (result === null) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }
      return result;
    }
    case "channel":
    case "ch": {
      await (deps.loadConfiguredPluginsForChannelCli ?? defaultLoadConfiguredPluginsForChannelCli)();
      const result = await handleChannelCli(args.slice(1), await createChannelCliDeps({
        print,
        stderr: deps.stderr,
        controller: deps.controller,
        isInteractive: deps.isInteractive,
        promptText: deps.promptText,
        promptSecret: deps.promptSecret,
        overrides: deps.channelCliDeps,
      }));
      if (result === null) {
        for (const line of HELP_LINES) {
          print(line);
        }
        return 1;
      }
      return result;
    }
    case "mcp-stdio":
      return await (deps.mcpStdio ?? ((subArgs) => defaultMcpStdio(subArgs, { stderr: deps.stderr })))(args.slice(1));
    case "start": {
      const controller = deps.controller ?? createDefaultController(deps);
      try {
        const isInteractive = deps.isInteractive ?? defaultIsInteractive;
        const status = await controller.getStatus();
        if (status.state === "running") {
          print("weacpx 已在后台运行");
          print(`PID: ${status.pid}`);
          return 0;
        }
        if (status.state === "indeterminate") {
          throw new Error(`weacpx daemon process is already running (pid ${status.pid}) but status metadata is missing`);
        }
        const onboarding = await runOnboardingBeforeStart({
          print,
          cwd: deps.cwd ?? (() => process.cwd()),
          isInteractive,
          promptText: deps.promptText,
        });
        const startupWaitUi = onboarding
          ? createStartupWaitUi({ isInteractive })
          : null;
        let result: StartStarted | StartAlreadyRunning;
        try {
          result = await controller.start({
            firstRunOnboarding: onboarding ?? undefined,
            ...(startupWaitUi?.wait ? { startupWait: startupWaitUi.wait } : {}),
          });
        } finally {
          startupWaitUi?.stop();
        }
        if (result.state === "already-running") {
          print("weacpx 已在后台运行");
          print(`PID: ${result.pid}`);
          return 0;
        }

        print("weacpx 已在后台启动");
        print(`PID: ${result.pid}`);
        return 0;
      } catch (error) {
        print(`weacpx 启动失败：${describeFriendlyError(error)}`);
        printDaemonLogHints(print);
        return 1;
      }
    }
    case "status": {
      const controller = deps.controller ?? createDefaultController(deps);
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
      const controller = deps.controller ?? createDefaultController(deps);
      const result = await controller.stop();
      if (result.detail === "not-running") {
        print("weacpx 未运行");
        return 0;
      }
      print("weacpx 已停止");
      return 0;
    }
    case "restart": {
      const controller = deps.controller ?? createDefaultController(deps);
      try {
        return await restartDaemonCli(controller, print);
      } catch (error) {
        print(`weacpx 重启失败：${describeFriendlyError(error)}`);
        printDaemonLogHints(print);
        return 1;
      }
    }
    default:
      for (const line of HELP_LINES) {
        print(line);
      }
      return 1;
  }
}


async function defaultUpdate(
  args: string[],
  input: {
    print: (line: string) => void;
    isInteractive?: () => boolean;
    promptText?: (message: string) => Promise<string>;
    overrides?: Partial<UpdateCliDeps>;
  },
): Promise<number | null> {
  const store = await createCliConfigStore();
  const deps: UpdateCliDeps = {
    loadConfig: async () => await store.load(),
    saveConfig: async (config) => await store.save(config),
    readCurrentVersion: readVersion,
    print: input.print,
    isInteractive: input.isInteractive ?? defaultIsInteractive,
    promptText: input.promptText ?? defaultPromptText,
    ...input.overrides,
  };
  return await handleUpdateCli(args, deps);
}

async function runOnboardingBeforeStart(input: {
  print: (line: string) => void;
  cwd: () => string;
  isInteractive?: () => boolean;
  promptText?: (message: string) => Promise<string>;
}): Promise<FirstRunOnboardingPlan | null> {
  const runtimePaths = (await import("./main")).resolveRuntimePaths();
  await ensureConfigExists(runtimePaths.configPath);
  const configStore = new ConfigStore(runtimePaths.configPath);
  const stateStore = new StateStore(runtimePaths.statePath);
  const config = await configStore.load();
  const state = await stateStore.load();
  const result = await maybeRunFirstUseOnboarding({
    config,
    state,
    saveConfig: async (next) => await configStore.save(next),
    deps: {
      print: input.print,
      cwd: input.cwd,
      isInteractive: input.isInteractive ?? defaultIsInteractive,
      promptText: input.promptText ?? defaultPromptText,
    },
  });
  return result.created
    ? {
        alias: result.alias,
        agent: result.agent,
        workspace: result.workspace,
        rollback: result.rollback,
      }
    : null;
}

async function handleWorkspaceCli(
  args: string[],
  deps: {
    print: (line: string) => void;
    cwd: () => string;
  },
): Promise<number | null> {
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      if (args.length !== 1) return null;
      return await workspaceList(deps.print);
    case "add": {
      const rest = args.slice(1);
      let rawFlag = false;
      let explicit: string | undefined;
      for (const token of rest) {
        if (token === "--raw") {
          if (rawFlag) return null;
          rawFlag = true;
          continue;
        }
        if (explicit !== undefined) return null;
        explicit = token;
      }
      return await workspaceAdd(explicit, { ...deps, raw: rawFlag });
    }
    case "rm":
      if (args.length !== 2 || !args[1]) return null;
      return await workspaceRemove(args[1], deps.print);
    default:
      return null;
  }
}

async function workspaceList(print: (line: string) => void): Promise<number> {
  const store = await createCliConfigStore();
  const config = await store.load();
  const entries = Object.entries(config.workspaces);

  if (entries.length === 0) {
    print("还没有工作区。");
    return 0;
  }

  print("工作区列表：");
  for (const [name, workspace] of entries) {
    print(`- ${name}: ${workspace.cwd}`);
  }
  return 0;
}

async function workspaceAdd(
  rawName: string | undefined,
  deps: {
    print: (line: string) => void;
    cwd: () => string;
    raw: boolean;
  },
): Promise<number> {
  const cwd = normalizeWorkspacePath(deps.cwd());
  const input = rawName === undefined ? basenameForWorkspacePath(cwd) : rawName.trim();
  if (input.length === 0) {
    deps.print("工作区名称不能为空。");
    return 1;
  }

  const store = await createCliConfigStore();
  const config = await store.load();

  let name = input;
  if (!deps.raw && !isWorkspaceNameValid(input)) {
    const base = sanitizeWorkspaceName(input);
    name = allocateWorkspaceName(base, config.workspaces);
    const sourceLabel = rawName === undefined ? "目录名" : "名称";
    deps.print(
      `${sourceLabel} ${JSON.stringify(input)} 含有特殊字符，已保存为「${name}」。如需保留原名请加 --raw。`,
    );
  }

  const existing = config.workspaces[name];
  if (existing) {
    if (sameWorkspacePath(existing.cwd, cwd)) {
      deps.print(`工作区「${name}」已存在：${existing.cwd}`);
      return 0;
    }

    deps.print(`工作区「${name}」已存在，但路径不同：${existing.cwd}`);
    deps.print(`请换一个名称，或先执行：weacpx workspace rm ${quoteWorkspaceNameIfNeeded(name)}`);
    return 1;
  }

  await store.upsertWorkspace(name, cwd);
  deps.print(`工作区「${name}」已保存：${cwd}`);
  return 0;
}

async function workspaceRemove(rawName: string, print: (line: string) => void): Promise<number> {
  const name = rawName.trim();
  if (name.length === 0) {
    print("工作区名称不能为空。");
    return 1;
  }

  const store = await createCliConfigStore();
  const config = await store.load();
  if (!config.workspaces[name]) {
    print(`没有找到工作区「${name}」。`);
    return 1;
  }

  await store.removeWorkspace(name);
  print(`工作区「${name}」已删除`);
  return 0;
}

async function handleAgentCli(
  args: string[],
  deps: {
    print: (line: string) => void;
  },
): Promise<number | null> {
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      if (args.length !== 1) return null;
      return await agentList(deps.print);
    case "templates":
      if (args.length !== 1) return null;
      return agentTemplates(deps.print);
    case "add":
      if (args.length !== 2 || !args[1]) return null;
      return await agentAdd(args[1], deps.print);
    case "rm":
      if (args.length !== 2 || !args[1]) return null;
      return await agentRemove(args[1], deps.print);
    default:
      return null;
  }
}

async function agentList(print: (line: string) => void): Promise<number> {
  const store = await createCliConfigStore();
  const config = await store.load();
  const entries = Object.entries(config.agents);

  if (entries.length === 0) {
    print("还没有 Agent。");
    return 0;
  }

  print("Agent 列表：");
  for (const [name, agent] of entries) {
    const command = agent.command ? ` command=${agent.command}` : "";
    print(`- ${name}: driver=${agent.driver}${command}`);
  }
  return 0;
}

function agentTemplates(print: (line: string) => void): number {
  print("可用 Agent 模板：");
  for (const name of listAgentTemplates()) {
    print(`- ${name}`);
  }
  return 0;
}

async function agentAdd(rawName: string, print: (line: string) => void): Promise<number> {
  const name = rawName.trim();
  if (name.length === 0) {
    print("Agent 名称不能为空。");
    return 1;
  }

  const template = getAgentTemplate(name);
  if (!template) {
    print(`暂不支持这个 Agent 模板。当前可用：${listAgentTemplates().join("、")}`);
    return 1;
  }

  const store = await createCliConfigStore();
  const config = await store.load();
  const existing = config.agents[name];
  if (existing) {
    if (sameAgentConfig(existing, template)) {
      print(`Agent「${name}」已存在`);
      return 0;
    }
    print(`Agent「${name}」已存在且配置不同。请先执行：weacpx agent rm ${name}`);
    return 1;
  }
  await store.upsertAgent(name, template);
  print(`Agent「${name}」已保存`);
  return 0;
}

async function agentRemove(rawName: string, print: (line: string) => void): Promise<number> {
  const name = rawName.trim();
  if (name.length === 0) {
    print("Agent 名称不能为空。");
    return 1;
  }

  const store = await createCliConfigStore();
  const config = await store.load();
  if (!config.agents[name]) {
    print(`没有找到 Agent「${name}」。`);
    return 1;
  }

  await store.removeAgent(name);
  print(`Agent「${name}」已删除`);
  return 0;
}

async function handleLaterCli(
  args: string[],
  deps: {
    print: (line: string) => void;
  },
): Promise<number | null> {
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      if (args.length !== 1) return null;
      return await laterList(deps.print);
    case "cancel":
      if (args.length !== 2 || !args[1]) return null;
      return await laterCancel(args[1], deps.print);
    default:
      return null;
  }
}

async function laterList(print: (line: string) => void): Promise<number> {
  const scheduled = await createCliScheduledTaskService();
  print(renderLaterList(scheduled.listPending(), (alias) => toDisplaySessionAlias(alias)));
  return 0;
}

async function laterCancel(rawId: string, print: (line: string) => void): Promise<number> {
  const id = normalizeId(rawId);
  if (id.length === 0) {
    print("定时任务 ID 不能为空。");
    return 1;
  }

  const scheduled = await createCliScheduledTaskService();
  const ok = await scheduled.cancelPending(id);
  if (!ok) {
    print(`未找到待执行的定时任务 #${id}。`);
    print("可以用 weacpx later list 查看当前待执行任务。");
    return 1;
  }
  print(`已取消定时任务 #${id}`);
  return 0;
}

async function createCliScheduledTaskService(): Promise<ScheduledTaskService> {
  // Keep `main` lazy-loaded like the other daemon/runtime CLI paths. Importing
  // it eagerly pulls in transport/channel wiring that simple commands such as
  // `weacpx --help`, `agent`, and `workspace` should not pay for.
  const runtimePaths = (await import("./main")).resolveRuntimePaths();
  const stateStore = new StateStore(runtimePaths.statePath);
  const state = await stateStore.load();
  return new ScheduledTaskService(state, stateStore);
}

function resolveConfigPathForCurrentEnv(): string {
  return process.env.WEACPX_CONFIG ?? `${requireHome()}/.weacpx/config.json`;
}

function resolveDaemonPathsForCurrentConfig() {
  const configPath = resolveConfigPathForCurrentEnv();
  return resolveDaemonPaths({
    home: requireHome(),
    runtimeDir: resolveRuntimeDirFromConfigPath(configPath),
  });
}

async function createCliConfigStore(): Promise<ConfigStore> {
  const configPath = resolveConfigPathForCurrentEnv();
  await ensureConfigExists(configPath);
  return new ConfigStore(configPath);
}

export async function resolveLoginChannelForCli(): Promise<ReturnType<typeof createMessageChannel>> {
  const { createMessageChannel } = await import("./channels/create-channel.js");
  return createMessageChannel("weixin");
}

async function defaultLogin(): Promise<void> {
  const channel = await resolveLoginChannelForCli();
  await channel.login();
}

async function defaultLogout(): Promise<void> {
  const channel = await resolveLoginChannelForCli();
  channel.logout();
}

async function defaultLoadConfiguredPluginsForChannelCli(): Promise<void> {
  const store = await createCliConfigStore();
  const config = await store.load();
  const { loadConfiguredPlugins } = await import("./plugins/plugin-loader.js");
  await loadConfiguredPlugins({ plugins: config.plugins });
}

const DAEMON_RUN_ENV = "WEACPX_DAEMON_RUN";

async function defaultRun(options: { firstRunOnboarding?: FirstRunOnboardingPlan } = {}): Promise<void> {
  const [{ buildApp, resolveRuntimePaths, prepareChannelMedia }, { runConsole }] = await Promise.all([
    import("./main"),
    import("./run-console"),
  ]);
  const runtimePaths = resolveRuntimePaths();
  await ensureConfigExists(runtimePaths.configPath);
  const config = await loadConfig(runtimePaths.configPath);
  const { loadConfiguredPlugins } = await import("./plugins/plugin-loader.js");
  await loadConfiguredPlugins({
    plugins: config.plugins,
    onPluginError: ({ name, error }) => {
      console.error(
        `[weacpx] skipping plugin ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
  const { createMessageChannels } = await import("./channels/create-channel.js");
  const { MessageChannelRegistry } = await import("./channels/channel-registry.js");
  const daemonPaths = resolveDaemonPathsForCurrentConfig();
  const daemonRuntime = new DaemonRuntime(daemonPaths, { pid: process.pid });
  const { channelDeps } = await prepareChannelMedia(runtimePaths.configPath, config);
  const channelRegistry = new MessageChannelRegistry(createMessageChannels(config.channels, channelDeps));
  const lockCreators = channelRegistry.createConsumerLocks();
  const firstLockCreator = lockCreators[0];

  const firstRunOnboarding = options.firstRunOnboarding ?? decodeFirstRunOnboarding(process.env.WEACPX_FIRST_RUN_ONBOARDING);
  await runConsole(runtimePaths, {
    buildApp: (paths) =>
      buildApp(paths, {
        defaultLoggingLevel: resolveCliEntryPath().includes(`${sep}src${sep}`) ? "debug" : "info",
        channel: channelRegistry,
      }),
    beforeReady: firstRunOnboarding
      ? async (runtime) => {
          await createFirstRunSession(runtime, firstRunOnboarding);
        }
      : undefined,
    channels: channelRegistry,
    channelStartupPolicy: process.env[DAEMON_RUN_ENV] === "1" ? "best-effort" : "require-one",
    daemonRuntime,
    ...(firstLockCreator
      ? {
          consumerLockFactory: (runtime) =>
            firstLockCreator.create({
              lockFilePath: `${daemonPaths.runtimeDir}${sep}${firstLockCreator.channel.id}-consumer.lock.json`,
              onDiagnostic: async (event, context) => {
                await runtime.logger.info(`${firstLockCreator.channel.id}.consumer_lock.${event}`, `${firstLockCreator.channel.id} consumer lock diagnostic`, context);
              },
            }),
        }
      : {}),
  });
}

async function createFirstRunSession(
  runtime: Awaited<ReturnType<typeof import("./main").buildApp>>,
  plan: FirstRunOnboardingPlan,
): Promise<void> {
  const session = runtime.sessions.resolveSession(plan.alias, plan.agent, plan.workspace, plan.alias);
  try {
    await runtime.transport.ensureSession(session);
    const exists = await runtime.transport.hasSession(session);
    if (!exists) {
      throw new Error(`first-run onboarding failed to create transport session: ${plan.alias}`);
    }
    await runtime.sessions.attachSession(plan.alias, plan.agent, plan.workspace, session.transportSession);
  } catch (error) {
    await rollbackFirstRunConfig(runtime, plan);
    throw error;
  }
  await runtime.logger.info("onboarding.session_created", "created first-run transport session", {
    alias: plan.alias,
    agent: plan.agent,
    workspace: plan.workspace,
  });
}

async function rollbackFirstRunConfig(
  runtime: Awaited<ReturnType<typeof import("./main").buildApp>>,
  plan: FirstRunOnboardingPlan,
): Promise<void> {
  try {
    const config = await runtime.configStore.load();
    if (!plan.rollback.workspaceExisted && config.workspaces[plan.workspace]) {
      delete config.workspaces[plan.workspace];
    }
    if (!plan.rollback.agentExisted && config.agents[plan.agent]) {
      delete config.agents[plan.agent];
    }
    await runtime.configStore.save(config);
  } catch (error) {
    await runtime.logger.error("onboarding.rollback_failed", "failed to roll back first-run config", {
      alias: plan.alias,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function defaultDoctor(options: DoctorRunOptions): Promise<number> {
  const { main } = await import("./doctor/index");
  return await main(options);
}

async function defaultMcpStdio(
  args: string[],
  deps: { stderr?: (text: string) => void } = {},
): Promise<number> {
  let coordinatorSession: string;
  let sourceHandle: string | null;
  let endpoint: ReturnType<typeof resolveDefaultOrchestrationEndpoint>;
  let transport!: ReturnType<typeof createOrchestrationTransport>;
  let identityResolver: Parameters<typeof runWeacpxMcpServer>[0]["resolveIdentity"] | undefined;
  let availableAgents: string[] | undefined;
  let internalSessionTools = false;
  try {
    const parsedCoordinatorSession = parseCoordinatorSession(args, process.env);
    sourceHandle = parseSourceHandle(args, process.env);
    const workspace = parseCoordinatorWorkspace(args, process.env);
    const requestedInternalSessionTools = parseInternalSessionToolsFlag(args, process.env);
    endpoint = resolveDefaultOrchestrationEndpoint(process.env, process.platform);
    const client = new OrchestrationClient(endpoint);
    transport = createOrchestrationTransport(endpoint, { client });
    const runtimePaths = (await import("./main")).resolveRuntimePaths();
    await ensureConfigExists(runtimePaths.configPath);
    const config = await loadConfig(runtimePaths.configPath);
    availableAgents = Object.keys(config.agents);
    const state = await new StateStore(runtimePaths.statePath).load();
    const resolveIdentity = createMcpStdioIdentityResolver({
      parsedCoordinatorSession,
      sourceHandle,
      workspace,
      config,
      state,
      client,
      internalSessionTools: requestedInternalSessionTools,
    });
    const eagerIdentity = parsedCoordinatorSession
      ? await resolveIdentity({ clientName: undefined, listRoots: async () => [] })
      : null;
    coordinatorSession = eagerIdentity?.coordinatorSession ?? "";
    internalSessionTools = eagerIdentity?.internalSessionTools ?? false;
    identityResolver = eagerIdentity ? undefined : resolveIdentity;
  } catch (error) {
    (deps.stderr ?? ((text: string) => process.stderr.write(text)))(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  await runWeacpxMcpServer({
    transport,
    ...(coordinatorSession ? { coordinatorSession } : {}),
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(internalSessionTools ? { internalSessionTools: true } : {}),
    ...(identityResolver ? { resolveIdentity: identityResolver } : {}),
    ...(availableAgents ? { availableAgents } : {}),
    onDiagnostic: (event, context) => {
      const suffix = context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
      (deps.stderr ?? ((text: string) => process.stderr.write(text)))(`[weacpx:mcp] ${event}${suffix}\n`);
    },
  });
  return 0;
}

function isUnknownCoordinatorRequiresWorkspaceError(error: unknown, coordinatorSession: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === `unknown coordinator session "${coordinatorSession}" requires --workspace <name>`;
}

export async function restartDaemonCli(
  controller: CliController,
  print: (line: string) => void,
): Promise<number> {
  const status = await controller.getStatus();
  if (status.state === "indeterminate") {
    print("weacpx 进程仍在运行，但状态元数据缺失");
    print(`PID: ${status.pid}`);
    print("请先执行 `weacpx stop`，或手动清理 stale PID/status 后再重试。");
    return 1;
  }

  if (status.state === "running") {
    print("weacpx 正在重启...");
    await controller.stop();
    print("weacpx 已停止");
  } else {
    print("weacpx 未运行，正在启动...");
  }

  const started = await controller.start();
  if (started.state === "already-running") {
    print("weacpx 已在后台运行");
    print(`PID: ${started.pid}`);
    return 0;
  }

  print("weacpx 已在后台启动");
  print(`PID: ${started.pid}`);
  return 0;
}

async function createChannelCliDeps(input: {
  print: (line: string) => void;
  stderr?: (text: string) => void;
  controller?: CliController;
  isInteractive?: () => boolean;
  promptText?: (message: string) => Promise<string>;
  promptSecret?: (message: string) => Promise<string>;
  overrides?: Partial<ChannelCliDeps>;
}): Promise<ChannelCliDeps> {
  const store = await createCliConfigStore();
  const controller = input.controller ?? createDefaultController();
  const base: ChannelCliDeps = {
    loadConfig: async () => await store.load(),
    saveConfig: async (config) => await store.save(config),
    print: input.print,
    stderr: input.stderr ?? ((text: string) => process.stderr.write(text)),
    isInteractive: input.isInteractive ?? defaultIsInteractive,
    promptText: input.promptText ?? defaultPromptText,
    promptSecret: input.promptSecret ?? defaultPromptSecret,
    getDaemonStatus: async () => {
      const status = await controller.getStatus();
      if (status.state === "running") return { state: "running" as const, pid: status.pid };
      if (status.state === "indeterminate") return { state: "indeterminate" as const, pid: status.pid, reason: status.reason };
      return { state: "stopped" as const };
    },
    restartDaemon: async () => await restartDaemonCli(controller, input.print),
  };
  return { ...base, ...input.overrides };
}

async function createPluginCliDeps(input: {
  print: (line: string) => void;
  controller?: CliController;
  isInteractive?: () => boolean;
  promptText?: (message: string) => Promise<string>;
  overrides?: Partial<PluginCliDeps>;
}): Promise<PluginCliDeps> {
  const store = await createCliConfigStore();
  const controller = input.controller ?? createDefaultController();
  const base: PluginCliDeps = {
    loadConfig: async () => await store.load(),
    saveConfig: async (config) => await store.save(config),
    print: input.print,
    isInteractive: input.isInteractive ?? defaultIsInteractive,
    promptText: input.promptText ?? defaultPromptText,
    getDaemonStatus: async () => {
      const status = await controller.getStatus();
      if (status.state === "running") return { state: "running" as const, pid: status.pid };
      if (status.state === "indeterminate") return { state: "indeterminate" as const, pid: status.pid, reason: status.reason };
      return { state: "stopped" as const };
    },
    restartDaemon: async () => await restartDaemonCli(controller, input.print),
  };
  return { ...base, ...input.overrides };
}

async function defaultPromptText(message: string): Promise<string> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

async function defaultPromptSecret(message: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    return await defaultPromptText(message);
  }

  process.stdout.write(message);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    let inEscape = false;
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      for (const char of text) {
        if (inEscape) {
          if ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "~") {
            inEscape = false;
          }
          continue;
        }
        if (char === "\u001b") {
          inEscape = true;
          continue;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("secret input cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(chunks.join(""));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          chunks.pop();
          continue;
        }
        chunks.push(char);
      }
    };
    process.stdin.on("data", onData);
  });
}

function createDefaultController(deps: Pick<CliDeps, "isProcessRunning"> = {}): CliController {
  const daemonPaths = resolveDaemonPathsForCurrentConfig();
  const controller = createDaemonController(daemonPaths, {
    processExecPath: process.execPath,
    cliEntryPath: resolveCliEntryPath(),
    cwd: process.cwd(),
    env: process.env,
    ...(deps.isProcessRunning ? { isProcessRunning: deps.isProcessRunning } : {}),
  });
  return {
    getStatus: () => controller.getStatus(),
    stop: () => controller.stop(),
    start: (options) => controller.start({
      ...(options?.firstRunOnboarding ? { firstRunOnboarding: encodeFirstRunOnboarding(options.firstRunOnboarding) } : {}),
      ...(options?.startupWait ? { startupWait: options.startupWait } : {}),
    }),
  };
}

function encodeFirstRunOnboarding(plan: FirstRunOnboardingPlan): string {
  return Buffer.from(JSON.stringify(plan), "utf8").toString("base64url");
}

function decodeFirstRunOnboarding(raw: string | undefined): FirstRunOnboardingPlan | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<FirstRunOnboardingPlan>;
    if (typeof parsed.alias === "string" && typeof parsed.agent === "string" && typeof parsed.workspace === "string") {
      const rollback = typeof parsed.rollback === "object" && parsed.rollback !== null
        ? parsed.rollback as Partial<FirstRunOnboardingPlan["rollback"]>
        : {};
      return {
        alias: parsed.alias,
        agent: parsed.agent,
        workspace: parsed.workspace,
        rollback: {
          workspaceExisted: rollback.workspaceExisted === true,
          agentExisted: rollback.agentExisted === true,
        },
      };
    }
  } catch {}
  return null;
}

function requireHome(): string {
  const home = process.env.HOME ?? homedir();
  if (!home) {
    throw new Error("Unable to resolve the current user home directory");
  }
  return home;
}

function defaultIsInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function describeFriendlyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printDaemonLogHints(print: (line: string) => void): void {
  const paths = safeDaemonLogPaths();
  if (!paths) return;
  print(`请查看 App Log: ${paths.appLog}`);
  print(`请查看 Stderr: ${paths.stderrLog}`);
}

function safeDaemonLogPaths(): { appLog: string; stderrLog: string } | null {
  try {
    const configPath = resolveConfigPathForCurrentEnv();
    const paths = resolveDaemonPathsForCurrentConfig();
    return {
      appLog: join(dirname(configPath), "runtime", "app.log"),
      stderrLog: paths.stderrLog,
    };
  } catch {
    return null;
  }
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
