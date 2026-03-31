import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ConfigStore } from "../../../src/config/config-store";
import type { AppConfig } from "../../../src/config/types";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { StateStore } from "../../../src/state/state-store";
import { SessionService } from "../../../src/sessions/session-service";
import type { ResolvedSession, SessionTransport } from "../../../src/transport/types";
import { CommandRouter } from "../../../src/commands/command-router";
import type { AppLogger } from "../../../src/logging/app-logger";
import { PromptCommandError } from "../../../src/transport/prompt-output";

function createConfig(): AppConfig {
  return {
    transport: {
      type: "acpx-cli",
      command: "acpx",
      permissionMode: "approve-all",
      nonInteractivePermissions: "fail",
    },
    logging: {
      level: "info",
      maxSizeBytes: 2 * 1024 * 1024,
      maxFiles: 5,
      retentionDays: 7,
    },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
    },
  };
}

class MemoryStateStore implements Pick<StateStore, "save"> {
  async save(_state: AppState): Promise<void> {}
}

class MemoryConfigStore
  implements Pick<ConfigStore, "upsertWorkspace" | "removeWorkspace" | "upsertAgent" | "removeAgent" | "updateTransport">
{
  constructor(private readonly config: AppConfig) {}

  async upsertWorkspace(name: string, cwd: string, description?: string): Promise<AppConfig> {
    this.config.workspaces[name] = {
      cwd,
      ...(description ? { description } : {}),
    };
    return this.config;
  }

  async removeWorkspace(name: string): Promise<AppConfig> {
    delete this.config.workspaces[name];
    return this.config;
  }

  async upsertAgent(name: string, agent: AppConfig["agents"][string]): Promise<AppConfig> {
    this.config.agents[name] = agent;
    return this.config;
  }

  async removeAgent(name: string): Promise<AppConfig> {
    delete this.config.agents[name];
    return this.config;
  }

  async updateTransport(transport: Partial<AppConfig["transport"]>): Promise<AppConfig> {
    this.config.transport = {
      ...this.config.transport,
      ...transport,
    };
    return this.config;
  }
}

function createTransport(): SessionTransport {
  return {
    ensureSession: mock(async (_session: ResolvedSession) => {}),
    prompt: mock(async (session: ResolvedSession, text: string) => ({
      text: `agent:${session.alias}:${text}`,
    })),
    setMode: mock(async (_session: ResolvedSession, _modeId: string) => {}),
    cancel: mock(async () => ({
      cancelled: true,
      message: "cancelled",
    })),
    hasSession: mock(async () => true),
    listSessions: mock(async () => []),
  };
}

function getPromptMock(transport: SessionTransport) {
  return transport.prompt as ReturnType<typeof mock>;
}

function getCancelMock(transport: SessionTransport) {
  return transport.cancel as ReturnType<typeof mock>;
}

function getSetModeMock(transport: SessionTransport) {
  return transport.setMode as ReturnType<typeof mock>;
}

function basename(path: string): string {
  return path.split(/[/\\\\]/).at(-1)!;
}

function createLogger(events: string[]): AppLogger {
  return {
    debug: async (event, _message, context) => {
      events.push(`DEBUG ${event} ${JSON.stringify(context ?? {})}`);
    },
    info: async (event, _message, context) => {
      events.push(`INFO ${event} ${JSON.stringify(context ?? {})}`);
    },
    error: async (event, _message, context) => {
      events.push(`ERROR ${event} ${JSON.stringify(context ?? {})}`);
    },
    cleanup: async () => {},
  };
}

type SessionAgentCommandResolver = (session: ResolvedSession) => Promise<string | undefined>;

test("creates and selects a new session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  expect(reply.text).toBe('会话「api-fix」已创建并切换');
});

test("stores recovered transport agent command after session creation", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const resolveSessionAgentCommand: SessionAgentCommandResolver = async () => "npx @zed-industries/codex-acp@^0.9.5";
  const router = new CommandRouter(sessions, transport, undefined, undefined, undefined, resolveSessionAgentCommand);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const session = await sessions.getCurrentSession("wx:user");

  expect(session).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
    agentCommand: "npx @zed-industries/codex-acp@^0.9.5",
  });
});

test("rejects session creation when acpx reports success but the named session is still missing", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  (transport.hasSession as ReturnType<typeof mock>).mockImplementationOnce(async () => false);
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  expect(reply.text).toContain("当前还不能直接在微信里创建新会话");
  expect(reply.text).toContain("/session attach api-fix --agent codex --ws backend --name <会话名>");
  expect(await sessions.listSessions("wx:user")).toEqual([]);
  await expect(sessions.getCurrentSession("wx:user")).resolves.toBeNull();
});

test("attaches and selects an existing session without creating it through transport", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle(
    "wx:user",
    "/session attach review --agent codex --ws backend --name existing-review",
  );

  expect(reply.text).toBe('会话「review」已绑定并切换');
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  await expect(sessions.getCurrentSession("wx:user")).resolves.toMatchObject({
    alias: "review",
    transportSession: "existing-review",
  });
});

test("rejects attaching a session name that does not exist in acpx", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  (transport.hasSession as ReturnType<typeof mock>).mockImplementationOnce(async () => false);
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle(
    "wx:user",
    "/session attach review --agent codex --ws backend --name missing-review",
  );

  expect(reply.text).toContain("没有找到可绑定的已有会话");
  expect(reply.text).toContain("/session attach review --agent codex --ws backend --name <会话名>");
  expect(await sessions.listSessions("wx:user")).toEqual([]);
  await expect(sessions.getCurrentSession("wx:user")).resolves.toBeNull();
});

test("routes plain text to the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "check this stack trace");

  expect(reply.text).toContain("agent:api-fix:check this stack trace");
});

test("returns a corrective hint when no current session exists", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "check this stack trace");

  expect(reply.text).toContain("当前还没有选中的会话");
});

test("renders status for the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/status");

  expect(reply.text).toBe(
    ["当前会话：", "- 名称：api-fix", "- Agent：codex", "- 工作区：backend"].join("\n"),
  );
});

test("returns help text", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/help");

  expect(reply.text).toContain("可用命令");
  expect(reply.text).toContain("/ss new");
});

test("renders the current permission mode", async () => {
  const config = createConfig();
  config.transport.permissionMode = "approve-reads";
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm");

  expect(reply.text).toBe(["当前权限模式：", "- mode: approve-reads", "- auto: fail"].join("\n"));
});

test("renders the current non-interactive policy", async () => {
  const config = createConfig();
  config.transport.nonInteractivePermissions = "allow";
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm auto");

  expect(reply.text).toBe(["当前非交互策略：", "- mode: approve-all", "- auto: allow"].join("\n"));
});

test("updates the permission mode", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm set read");

  expect(reply.text).toBe(["权限模式已更新：", "- mode: approve-reads", "- auto: fail"].join("\n"));
  expect(config.transport.permissionMode).toBe("approve-reads");
});

test("updates the non-interactive permission policy", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm auto allow");

  expect(reply.text).toBe(["非交互策略已更新：", "- mode: approve-all", "- auto: allow"].join("\n"));
  expect(config.transport.nonInteractivePermissions).toBe("allow");
});

test("refuses permission writes when writable config is unavailable", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config);

  const modeReply = await router.handle("wx:user", "/pm set deny");
  const autoReply = await router.handle("wx:user", "/pm auto deny");

  expect(modeReply.text).toBe("当前没有加载可写入的配置。");
  expect(autoReply.text).toBe("当前没有加载可写入的配置。");
});

test("renders agents in Chinese", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig());

  const reply = await router.handle("wx:user", "/agents");

  expect(reply.text).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("adds a claude agent from the built-in template and reflects it in /agents", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const addReply = await router.handle("wx:user", "/agent add claude");
  const listReply = await router.handle("wx:user", "/agents");

  expect(addReply.text).toBe('Agent「claude」已保存');
  expect(config.agents.claude).toEqual({ driver: "claude" });
  expect(listReply.text).toBe(["已注册的 Agent：", "- codex", "- claude"].join("\n"));
});

test("adds a codex agent from the built-in template", async () => {
  const config = createConfig();
  delete config.agents.codex;
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/agent add codex");

  expect(reply.text).toBe('Agent「codex」已保存');
  expect(config.agents.codex).toEqual({
    driver: "codex",
  });
});

test("returns a chinese hint for unknown agent templates", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/agent add kimi");

  expect(reply.text).toBe("暂不支持这个 Agent 模板。当前可用：codex、claude");
});

test("removes an agent and reflects it in /agents", async () => {
  const config = createConfig();
  config.agents.claude = { driver: "claude" };
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const removeReply = await router.handle("wx:user", "/agent rm claude");
  const listReply = await router.handle("wx:user", "/agents");

  expect(removeReply.text).toBe('Agent「claude」已删除');
  expect(config.agents).toEqual({
    codex: { driver: "codex" },
  });
  expect(listReply.text).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("returns a chinese hint when removing an unknown agent", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/agent rm missing");

  expect(reply.text).toBe("没有找到这个 Agent。");
});

test("renders workspaces in Chinese", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig());

  const reply = await router.handle("wx:user", "/workspaces");

  expect(reply.text).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});

test("lists workspaces for bare workspace commands and aliases", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig());

  const bareReply = await router.handle("wx:user", "/workspace");
  const aliasReply = await router.handle("wx:user", "/ws");

  expect(bareReply.text).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
  expect(aliasReply.text).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});

test("creates a workspace via command and lists it immediately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-workspace-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const createReply = await router.handle("wx:user", `/workspace new frontend --cwd "${dir}"`);
  const listReply = await router.handle("wx:user", "/workspaces");

  expect(createReply.text).toBe('工作区「frontend」已保存');
  expect(listReply.text).toBe(["已注册的工作区：", "- backend: /tmp/backend", `- frontend: ${dir}`].join("\n"));

  await rm(dir, { recursive: true, force: true });
});

test("creates a workspace via the short alias and cwd flag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-workspace-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", `/ws new frontend -d "${dir}"`);

  expect(reply.text).toBe('工作区「frontend」已保存');
  expect(config.workspaces.frontend).toEqual({ cwd: dir });

  await rm(dir, { recursive: true, force: true });
});

test("rejects creating a workspace when cwd does not exist", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", '/ws new missing -d "E:\\definitely-missing\\repo"');

  expect(reply.text).toContain("工作区路径不存在");
  expect(config.workspaces.missing).toBeUndefined();
});

test("removes a workspace via command", async () => {
  const config = createConfig();
  config.workspaces.frontend = { cwd: "/tmp/frontend" };
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/workspace rm frontend");

  expect(reply.text).toBe('工作区「frontend」已删除');
  expect(config.workspaces).toEqual({
    backend: { cwd: "/tmp/backend" },
  });
});

test("renders sessions list in Chinese", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig());

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/sessions");

  expect(reply.text).toBe(["会话列表：", "- api-fix (codex @ backend) [当前]"].join("\n"));
});

test("lists sessions for bare session commands and aliases", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig());

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const bareReply = await router.handle("wx:user", "/session");
  const aliasReply = await router.handle("wx:user", "/ss");

  expect(bareReply.text).toBe(["会话列表：", "- api-fix (codex @ backend) [当前]"].join("\n"));
  expect(aliasReply.text).toBe(["会话列表：", "- api-fix (codex @ backend) [当前]"].join("\n"));
});

test("creates a session via the short alias and agent flag", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/ss new api-fix -a codex --ws backend");

  expect(reply.text).toBe('会话「api-fix」已创建并切换');
});

test("creates a workspace and session from the shortcut command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-shortcut-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  const workspaceName = basename(dir);

  const reply = await router.handle("wx:user", `/ss codex -d "${dir}"`);

  expect(reply.text).toContain(`已创建并切换到会话「${workspaceName}:codex」`);
  expect(reply.text).toContain(`新增工作区：${workspaceName} -> ${dir}`);
  expect(reply.text).toContain(`新增会话：${workspaceName}:codex`);
  expect(await sessions.getCurrentSession("wx:user")).toMatchObject({
    alias: `${workspaceName}:codex`,
    workspace: workspaceName,
    transportSession: `${workspaceName}:${workspaceName}:codex`,
    cwd: dir,
  });

  await rm(dir, { recursive: true, force: true });
});

test("reuses the derived workspace and session from the shortcut command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-shortcut-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  const workspaceName = basename(dir);

  await router.handle("wx:user", `/ss codex -d "${dir}"`);
  const reply = await router.handle("wx:user", `/ss codex -d "${dir}"`);

  expect(reply.text).toBe(
    [`已切换到会话「${workspaceName}:codex」`, `- 复用工作区：${workspaceName}`, `- 复用会话：${workspaceName}:codex`].join("\n"),
  );
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls).toHaveLength(1);

  await rm(dir, { recursive: true, force: true });
});

test("auto-renames the derived workspace when the basename already exists for another path", async () => {
  const parent = await mkdtemp(join(tmpdir(), "weacpx-shortcut-parent-"));
  const firstDir = join(parent, "weacpx");
  const secondRoot = await mkdtemp(join(tmpdir(), "weacpx-shortcut-other-"));
  const secondDir = join(secondRoot, "weacpx");
  await mkdir(firstDir);
  await mkdir(secondDir);

  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", `/ss codex -d "${firstDir}"`);
  const reply = await router.handle("wx:user", `/ss codex -d "${secondDir}"`);

  expect(reply.text).toContain("新增工作区：weacpx-2");
  expect(config.workspaces["weacpx-2"]).toEqual({ cwd: secondDir });

  await rm(parent, { recursive: true, force: true });
  await rm(secondRoot, { recursive: true, force: true });
});

test("creates uniquely named sessions for the explicit shortcut create command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-shortcut-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  const workspaceName = basename(dir);

  await router.handle("wx:user", `/ss new codex -d "${dir}"`);
  const reply = await router.handle("wx:user", `/ss new codex -d "${dir}"`);

  expect(reply.text).toContain(`已创建并切换到会话「${workspaceName}:codex-2」`);
  expect(await sessions.getCurrentSession("wx:user")).toMatchObject({
    alias: `${workspaceName}:codex-2`,
    transportSession: `${workspaceName}:${workspaceName}:codex-2`,
  });

  await rm(dir, { recursive: true, force: true });
});

test("keeps the shortcut-created workspace but avoids a ghost session when transport creation fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-shortcut-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  (transport.ensureSession as ReturnType<typeof mock>).mockImplementationOnce(async () => {
    throw new Error("boom");
  });
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  const workspaceName = basename(dir);

  const reply = await router.handle("wx:user", `/ss codex -d "${dir}"`);

  expect(reply.text).toContain(`会话「${workspaceName}:codex」创建失败。`);
  expect(reply.text).toContain(`已新增工作区：${workspaceName} -> ${dir}`);
  expect(config.workspaces[workspaceName]).toEqual({ cwd: dir });
  expect(await sessions.listSessions("wx:user")).toEqual([]);
  await expect(sessions.getCurrentSession("wx:user")).resolves.toBeNull();

  await rm(dir, { recursive: true, force: true });
});

test("cancels the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/cancel");

  expect(reply.text).toContain("cancelled");
});

test("treats stop as cancel", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/stop");

  expect(reply.text).toContain("cancelled");
});

test("resets the current session by recreating its transport session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const beforeReset = await sessions.getCurrentSession("wx:user");
  const reply = await router.handle("wx:user", "/session reset");
  const afterReset = await sessions.getCurrentSession("wx:user");

  expect(reply.text).toBe('会话「api-fix」已重置');
  expect(beforeReset).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
  expect(afterReset).toMatchObject({
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
  expect(afterReset?.transportSession).not.toBe("backend:api-fix");
  expect(afterReset?.transportSession.startsWith("backend:api-fix:reset-")).toBe(true);
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls.at(-1)?.[0].transportSession).toBe(
    afterReset?.transportSession,
  );
});

test("treats clear as a reset alias", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/clear");

  expect(reply.text).toBe('会话「api-fix」已重置');
});

test("returns a corrective hint when resetting without a current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/session reset");

  expect(reply.text).toContain("当前还没有选中的会话");
});

test("routes prompts and cancel to the currently selected session after switching", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  await router.handle("wx:user", "/session new infra-fix --agent codex --ws backend");
  await router.handle("wx:user", "/use api-fix");
  await router.handle("wx:user", "check logs");
  await router.handle("wx:user", "/use infra-fix");
  await router.handle("wx:user", "/cancel");

  expect(getPromptMock(transport).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
  expect(getCancelMock(transport).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "infra-fix",
    transportSession: "backend:infra-fix",
  });
});

test("renders a recovery hint when the current acpx session is missing", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  getPromptMock(transport).mockImplementationOnce(async () => {
    throw new Error(
      "No acpx session found (searched up to /tmp/backend).\nCreate one: acpx codex sessions new --name backend:api-fix",
    );
  });
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "hello");

  expect(reply.text).toContain('当前会话「api-fix」暂时不可用');
  expect(reply.text).toContain("/session new api-fix --agent codex --ws backend");
  expect(reply.text).not.toContain("No acpx session found");
  expect(reply.text).not.toContain("/tmp/backend");
  expect(reply.text).not.toContain("backend:api-fix");
});

test("recovers a missing session once after resolving transport agent command", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  getPromptMock(transport)
    .mockImplementationOnce(async () => {
      throw new Error(
        "No acpx session found (searched up to /tmp/backend).\nCreate one: acpx codex sessions new --name backend:api-fix",
      );
    })
    .mockImplementationOnce(async (session: ResolvedSession, text: string) => ({
      text: `agent:${session.agentCommand}:${text}`,
    }));
  const resolveSessionAgentCommand = mock<SessionAgentCommandResolver>()
    .mockImplementationOnce(async () => undefined)
    .mockImplementationOnce(async () => "npx @zed-industries/codex-acp@^0.9.5");
  const router = new CommandRouter(sessions, transport, undefined, undefined, undefined, resolveSessionAgentCommand);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "hello");

  expect(reply.text).toContain("npx @zed-industries/codex-acp@^0.9.5");
  expect(getPromptMock(transport).mock.calls).toHaveLength(2);
  expect(getPromptMock(transport).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
    agentCommand: "npx @zed-industries/codex-acp@^0.9.5",
  });
});

test("renders a generic failure hint when prompt stops after partial output", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  getPromptMock(transport).mockImplementationOnce(async () => {
    throw new Error("未收到最终回复。最后一条输出：让我更新任务状态并继续执行测试验证。");
  });
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "hello");

  expect(reply.text).toContain('当前会话「api-fix」执行中断');
  expect(reply.text).toContain("/cancel");
  expect(reply.text).toContain("未收到最终回复");
});

test("rethrows unrelated transport failures instead of masking them as partial output", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  getPromptMock(transport).mockImplementationOnce(async () => {
    throw new Error("spawn acpx ENOENT");
  });
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  await expect(router.handle("wx:user", "hello")).rejects.toThrow("spawn acpx ENOENT");
});

test("renders an attach-first hint when session creation times out", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  (transport.ensureSession as ReturnType<typeof mock>).mockImplementationOnce(async () => {
    throw new Error('acpx command timed out after 120000ms: codex sessions new --name "backend:api-fix"');
  });
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  expect(reply.text).toContain("当前还不能直接在微信里创建新会话");
  expect(reply.text).toContain("/session attach api-fix --agent codex --ws backend --name <会话名>");
  expect(reply.text).not.toContain("120000");
  expect(reply.text).not.toContain("backend:api-fix");
});

test("logs parsed commands and transport timing summaries", async () => {
  const events: string[] = [];
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, createConfig(), undefined, createLogger(events));

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  expect(events.some((entry) => entry.includes("DEBUG command.parsed"))).toBe(true);
  expect(events.some((entry) => entry.includes("INFO transport.ensure_session"))).toBe(true);
  expect(events.some((entry) => entry.includes("INFO command.completed"))).toBe(true);
});

test("logs prompt diagnostics when transport fails with captured output", async () => {
  const events: string[] = [];
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  getPromptMock(transport).mockImplementationOnce(async () => {
    throw new PromptCommandError("command failed with exit code 5", {
      code: 5,
      stdout: [
        JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hello" },
            },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { stopReason: "end_turn" },
        }),
      ].join("\n"),
      stderr: "fatal",
    });
  });
  const router = new CommandRouter(sessions, transport, createConfig(), undefined, createLogger(events));

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  await expect(router.handle("wx:user", "hello")).rejects.toThrow("command failed with exit code 5");

  expect(events.some((entry) => entry.includes("ERROR transport.prompt.failed"))).toBe(true);
  expect(events.some((entry) => entry.includes('"exitCode":5'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutPreview":"{\\"jsonrpc\\":\\"2.0\\",\\"id\\":0,\\"method\\":\\"initialize\\"}'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutLength":'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutLineCount":3'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutAgentMessageChunkCount":1'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutStopReason":"end_turn"'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stdoutMethods":"initialize,session/update"'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stderrPreview":"fatal"'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stderrTailPreview":"fatal"'))).toBe(true);
  expect(events.some((entry) => entry.includes('"stderrLength":5'))).toBe(true);
});

test("shows the saved mode for the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  await router.handle("wx:user", "/mode plan");

  const reply = await router.handle("wx:user", "/mode");

  expect(reply.text).toContain("plan");
});

test("sets the mode on the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const reply = await router.handle("wx:user", "/mode plan");

  expect(reply.text).toContain("plan");
  expect(getSetModeMock(transport)).toHaveBeenCalledWith(
    expect.objectContaining({ alias: "api-fix", transportSession: "backend:api-fix" }),
    "plan",
  );
});

test("rejects mode commands when no session is selected", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/mode");

  expect(reply.text).toContain("/session new");
  expect(reply.text).toContain("/use");
});
