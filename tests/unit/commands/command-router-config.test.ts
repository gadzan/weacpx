import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRouter } from "../../../src/commands/command-router";
import { normalizeWorkspacePath } from "../../../src/commands/workspace-path";
import {
  MemoryConfigStore,
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createTransport,
  getUpdatePermissionPolicyMock,
} from "./command-router-test-support";

test("returns help text", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/help");

  expect(reply.text).toContain("常用入口：");
  expect(reply.text).toContain("顶级命令：");
  expect(reply.text).toContain("- session -");
  expect(reply.text).toContain("/help <topic>");
});

test("returns topic help for session aliases", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const byAlias = await router.handle("wx:user", "/help ss");
  const byTopic = await router.handle("wx:user", "/help session");

  expect(byAlias.text).toBe(byTopic.text);
  expect(byAlias.text).toContain("帮助主题：session");
  expect(byAlias.text).toContain("/ss <agent> (-d <path> | --ws <name>)");
});

test("returns topic help for permission aliases", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/help pm");

  expect(reply.text).toContain("帮助主题：permission");
  expect(reply.text).toContain("/pm set <allow|read|deny>");
});

test("returns topic help for orchestration aliases", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const byAlias = await router.handle("wx:user", "/help delegate");
  const byShortAlias = await router.handle("wx:user", "/help dg");
  const byTaskAlias = await router.handle("wx:user", "/help task");
  const byGroupAlias = await router.handle("wx:user", "/help group");
  const byGroupsAlias = await router.handle("wx:user", "/help groups");
  const byTopic = await router.handle("wx:user", "/help orchestration");

  expect(byAlias.text).toBe(byTopic.text);
  expect(byShortAlias.text).toBe(byTopic.text);
  expect(byTaskAlias.text).toBe(byTopic.text);
  expect(byGroupAlias.text).toBe(byTopic.text);
  expect(byGroupsAlias.text).toBe(byTopic.text);
  expect(byTopic.text).toContain("帮助主题：orchestration");
  expect(byTopic.text).toContain("别名：delegate、dg、task、tasks、group、groups");
  expect(byTopic.text).toContain("/delegate <agent> <task>");
  expect(byTopic.text).toContain("/group new <title>");
  expect(byTopic.text).toContain("/group add <groupId> <agent> <task>");
  expect(byTopic.text).toContain("/group cancel <groupId>");
  expect(byTopic.text).toContain("/dg claude 审查当前方案的 3 个最高风险点");
  expect(byTopic.text).toContain("/task approve <id>");
});

test("returns a hint for unknown help topics", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/help missing");

  expect(reply.text).toContain("未知帮助主题：missing");
  expect(reply.text).toContain("可用主题：");
  expect(reply.text).toContain("- session");
  expect(reply.text).toContain("- orchestration");
});

test("renders the current permission mode", async () => {
  const config = createConfig();
  config.transport.permissionMode = "approve-reads";
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm");

  expect(reply.text).toBe(["当前权限模式：", "- mode: approve-reads", "- auto: deny"].join("\n"));
});

test("renders the current non-interactive policy", async () => {
  const config = createConfig();
  config.transport.nonInteractivePermissions = "deny";
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm auto");

  expect(reply.text).toBe(["当前非交互策略：", "- mode: approve-all", "- auto: deny"].join("\n"));
});

test("updates the permission mode", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm set read");

  expect(reply.text).toBe(["权限模式已更新：", "- mode: approve-reads", "- auto: deny"].join("\n"));
  expect(config.transport.permissionMode).toBe("approve-reads");
});

test("updates the non-interactive permission policy", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/pm auto deny");

  expect(reply.text).toBe(["非交互策略已更新：", "- mode: approve-all", "- auto: deny"].join("\n"));
  expect(config.transport.nonInteractivePermissions).toBe("deny");
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

test("shows supported config paths", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/config");

  expect(reply.text).toContain("支持修改的配置字段：");
  expect(reply.text).toContain("- transport.permissionMode");
  expect(reply.text).toContain("- agents.<name>.driver");
  expect(reply.text).toContain("- workspaces.<name>.description");
});

test("updates a fixed config path through /config set", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/config set logging.level debug");

  expect(reply.text).toBe("配置已更新：logging.level = debug");
  expect(config.logging.level).toBe("debug");
});

test("updates an existing dynamic config path through /config set", async () => {
  const config = createConfig();
  config.workspaces.backend.description = "old";
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", '/config set workspaces.backend.description "backend repo"');

  expect(reply.text).toBe("配置已更新：workspaces.backend.description = backend repo");
  expect(config.workspaces.backend.description).toBe("backend repo");
});

test("rejects unsupported config paths", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const reply = await router.handle("wx:user", "/config set transport.missing value");

  expect(reply.text).toBe("不支持修改这个配置路径：transport.missing");
});

test("rejects config set when the target dynamic entry does not exist", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const agentReply = await router.handle("wx:user", "/config set agents.claude.driver claude");
  const workspaceReply = await router.handle("wx:user", "/config set workspaces.frontend.cwd /tmp/frontend");

  expect(agentReply.text).toBe("Agent「claude」不存在，请先创建。");
  expect(workspaceReply.text).toBe("工作区「frontend」不存在，请先创建。");
});

test("rejects config set with invalid typed values", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  const modeReply = await router.handle("wx:user", "/config set wechat.replyMode maybe");
  const numberReply = await router.handle("wx:user", "/config set logging.maxFiles 0");

  expect(modeReply.text).toBe("wechat.replyMode 只支持：stream、final、verbose");
  expect(numberReply.text).toBe("logging.maxFiles 必须是正数。");
});

test("refuses config writes when writable config is unavailable", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config);

  const reply = await router.handle("wx:user", "/config set logging.level debug");

  expect(reply.text).toBe("当前没有加载可写入的配置。");
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

  expect(reply.text).toBe("暂不支持这个 Agent 模板。当前可用：codex、claude、opencode、gemini");
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
  expect(listReply.text).toBe(
    ["已注册的工作区：", "- backend: /tmp/backend", `- frontend: ${normalizeWorkspacePath(dir)}`].join("\n"),
  );

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
  expect(config.workspaces.frontend).toEqual({ cwd: normalizeWorkspacePath(dir) });

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


test("updates the live transport policy after /pm auto", async () => {
  const config = createConfig();
  const transport = createTransport();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/pm auto deny");

  expect(getUpdatePermissionPolicyMock(transport)).toHaveBeenCalledWith(expect.objectContaining({
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  }));
});

test("updates the live transport policy after /config set transport.permissionMode", async () => {
  const config = createConfig();
  const transport = createTransport();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/config set transport.permissionMode approve-reads");

  expect(getUpdatePermissionPolicyMock(transport)).toHaveBeenCalledWith(expect.objectContaining({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  }));
});


test("updates the live transport policy after /pm set", async () => {
  const config = createConfig();
  const transport = createTransport();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/pm set read");

  expect(getUpdatePermissionPolicyMock(transport)).toHaveBeenCalledWith(expect.objectContaining({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  }));
});

test("updates the live transport policy after /config set transport.nonInteractivePermissions", async () => {
  const config = createConfig();
  const transport = createTransport();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await router.handle("wx:user", "/config set transport.nonInteractivePermissions deny");

  expect(getUpdatePermissionPolicyMock(transport)).toHaveBeenCalledWith(expect.objectContaining({
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  }));
});

test("rolls back /pm auto config when live transport update fails", async () => {
  const config = createConfig();
  const transport = createTransport();
  getUpdatePermissionPolicyMock(transport).mockImplementation(async () => {
    throw new Error("bridge write failed");
  });
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await expect(router.handle("wx:user", "/pm auto deny")).rejects.toThrow("bridge write failed");

  expect(config.transport).toMatchObject({
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });
});

test("rolls back /config set transport.permissionMode when live transport update fails", async () => {
  const config = createConfig();
  const transport = createTransport();
  getUpdatePermissionPolicyMock(transport).mockImplementation(async () => {
    throw new Error("bridge write failed");
  });
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));

  await expect(router.handle("wx:user", "/config set transport.permissionMode approve-reads")).rejects.toThrow("bridge write failed");

  expect(config.transport).toMatchObject({
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });
});
