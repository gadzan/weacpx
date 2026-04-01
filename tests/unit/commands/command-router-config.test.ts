import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRouter } from "../../../src/commands/command-router";
import {
  MemoryConfigStore,
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createTransport,
} from "./command-router-test-support";

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
