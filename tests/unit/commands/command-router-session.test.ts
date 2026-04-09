import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRouter } from "../../../src/commands/command-router";
import {
  MemoryConfigStore,
  MemoryStateStore,
  SessionService,
  SessionAgentCommandResolver,
  createConfig,
  createEmptyState,
  createTransport,
  getSetModeMock,
} from "./command-router-test-support";

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

  expect(reply.text).toContain("会话创建失败");
  expect(reply.text).toContain("错误信息：未检测到可用的后端会话。");
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



test("does not create a workspace from the shortcut command when the agent is invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-shortcut-"));
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  const workspaceName = basename(dir);

  const reply = await router.handle("wx:user", `/ss missing-agent -d "${dir}"`);

  expect(reply.text).toContain('agent "missing-agent"');
  expect(config.workspaces[workspaceName]).toBeUndefined();
  expect(await sessions.listSessions("wx:user")).toEqual([]);

  await rm(dir, { recursive: true, force: true });
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
    transportSession: `${workspaceName}:codex`,
    cwd: dir,
  });

  await rm(dir, { recursive: true, force: true });
});

test("reuses an existing workspace and session from the workspace shortcut command", async () => {
  const config = createConfig();
  config.workspaces.weacpx = { cwd: "/tmp/weacpx" };
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/ss codex --ws weacpx");

  expect(reply.text).toContain("已创建并切换到会话「weacpx:codex」");
  expect(reply.text).toContain("复用工作区：weacpx");
  expect(reply.text).toContain("新增会话：weacpx:codex");
  expect(await sessions.getCurrentSession("wx:user")).toMatchObject({
    alias: "weacpx:codex",
    workspace: "weacpx",
    transportSession: "weacpx:codex",
  });
});

test("rejects the workspace shortcut command when the workspace is missing", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/ss codex --ws missing");

  expect(reply.text).toBe('workspace "missing" is not registered');
  expect(await sessions.listSessions("wx:user")).toEqual([]);
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

test("creates uniquely named sessions for the explicit workspace shortcut create command", async () => {
  const config = createConfig();
  config.workspaces.weacpx = { cwd: "/tmp/weacpx" };
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/ss new codex --ws weacpx");
  const reply = await router.handle("wx:user", "/ss new codex --ws weacpx");

  expect(reply.text).toContain("已创建并切换到会话「weacpx:codex-2」");
  expect(await sessions.getCurrentSession("wx:user")).toMatchObject({
    alias: "weacpx:codex-2",
    transportSession: "weacpx:codex-2",
  });
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
    transportSession: `${workspaceName}:codex-2`,
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

test("shows the effective reply mode for the current session", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const reply = await router.handle("wx:user", "/replymode");

  expect(reply.text).toContain("全局默认：stream");
  expect(reply.text).toContain("当前会话覆盖：未设置");
  expect(reply.text).toContain("当前生效：stream");
});

test("sets and resets the current session reply mode override", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const setReply = await router.handle("wx:user", "/replymode final");
  const showReply = await router.handle("wx:user", "/replymode");
  const resetReply = await router.handle("wx:user", "/replymode reset");

  expect(setReply.text).toContain("final");
  expect(showReply.text).toContain("当前会话覆盖：final");
  expect(showReply.text).toContain("当前生效：final");
  expect(resetReply.text).toContain("已重置");
});
