import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRouter } from "../../../src/commands/command-router";
import { normalizeWorkspacePath } from "../../../src/commands/workspace-path";
import { MissingOptionalDepError, AutoInstallFailedError } from "../../../src/recovery/errors";
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

function buildRouter() {
  const config = createConfig();
  config.agents.opencode = { driver: "opencode" };
  config.workspaces.weacpx = { cwd: "/tmp/weacpx" };
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport, config, new MemoryConfigStore(config));
  // Default test-friendly path discovery: just echo the seed (avoid spawning real npm/pnpm/yarn).
  router.__setDiscoverPathsForTest(async (_pkg, seed) => (seed ? [{ path: seed, manager: "npm" as const }] : []));
  return { router, transport, sessions, config };
}

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

  expect(reply.text).toContain("Agent「missing-agent」未注册");
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
  expect(reply.text).toContain(`新增工作区：${workspaceName} -> ${normalizeWorkspacePath(dir)}`);
  expect(reply.text).toContain(`新增会话：${workspaceName}:codex`);
  expect(await sessions.getCurrentSession("wx:user")).toMatchObject({
    alias: `${workspaceName}:codex`,
    workspace: workspaceName,
    transportSession: `${workspaceName}:codex`,
    cwd: normalizeWorkspacePath(dir),
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

  expect(reply.text).toContain("工作区「missing」未注册");
  expect(reply.text).toContain("当前可用：backend");
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
  expect(config.workspaces["weacpx-2"]).toEqual({ cwd: normalizeWorkspacePath(secondDir) });

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
  expect(reply.text).toContain(`已新增工作区：${workspaceName} -> ${normalizeWorkspacePath(dir)}`);
  expect(config.workspaces[workspaceName]).toEqual({ cwd: normalizeWorkspacePath(dir) });
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

// ── Task 8: ensureTransportSession reply + auto-install recovery ──────────────

test("ensureTransportSession retries once after auto-install succeeds", async () => {
  const { router, transport } = buildRouter();

  let calls = 0;
  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async () => {
    calls += 1;
    if (calls === 1) {
      throw new MissingOptionalDepError({
        package: "opencode-windows-x64",
        parentPackagePath: null,
        rawMessage: "boom",
      });
    }
  });

  const replies: string[] = [];
  const reply = async (t: string) => {
    replies.push(t);
  };

  router.__setAutoInstallForTest(async (_pkg, _parent, opts) => {
    const verified = opts?.verify ? await opts.verify() : true;
    return { ok: verified, errors: [], logPath: "/log" };
  });

  const response = await router.handle("chat1", "/ss opencode --ws weacpx", reply);
  expect(response.text).toBeDefined();
  expect(calls).toBe(2);
  expect(replies.some((t) => t.includes("检测到缺失依赖"))).toBe(true);
  expect(replies.some((t) => t.includes("正在验证会话启动"))).toBe(true);
});

test("renders AutoInstallFailedError when auto-install fails", async () => {
  const { router, transport } = buildRouter();

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async () => {
    throw new MissingOptionalDepError({
      package: "opencode-windows-x64",
      parentPackagePath: "/some/path",
      rawMessage: "boom",
    });
  });
  router.__setAutoInstallForTest(async () => ({
    ok: false,
    errors: [
      { scope: "precise" as const, stderrTail: "npm ERR! 403", code: 1, reason: "exit" as const },
      { scope: "global" as const, stderrTail: "npm ERR! EACCES", code: 1, reason: "exit" as const },
    ],
    logPath: "/log/path",
  }));

  const replies: string[] = [];
  const response = await router.handle("chat1", "/ss opencode --ws weacpx", async (t) => {
    replies.push(t);
  });
  const full = (response.text ?? "") + replies.join("\n");
  expect(full).toContain("opencode-windows-x64");
  expect(full).toContain("npm install -g opencode-windows-x64");
  expect(full).toContain("/log/path");
  expect(full).toContain("安装错误（精确 / /some/path）");
  expect(full).toContain("安装错误（全局）");
});

test("retry's ensureSession error does not trigger second recovery loop", async () => {
  const { router, transport } = buildRouter();

  let calls = 0;
  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async () => {
    calls += 1;
    throw new MissingOptionalDepError({ package: "p", parentPackagePath: null, rawMessage: "x" });
  });
  const autoInstall = mock(async (_pkg: string, _paths: string[], opts?: { verify?: () => Promise<boolean> }) => {
    const verified = opts?.verify ? await opts.verify() : true;
    return { ok: verified, errors: [], logPath: "/log" };
  });
  router.__setAutoInstallForTest(autoInstall);

  await router.handle("chat1", "/ss opencode --ws weacpx", async () => {});
  expect(calls).toBe(2); // original + one verify — no third
  expect(autoInstall.mock.calls).toHaveLength(1);
});

test("renders verify-failed step when auto-install succeeds but session still misses the dep", async () => {
  const { router, transport } = buildRouter();

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async () => {
    throw new MissingOptionalDepError({
      package: "opencode-windows-x64",
      parentPackagePath: "/p",
      rawMessage: "boom",
    });
  });
  router.__setAutoInstallForTest(async (_pkg, _parent, opts) => {
    // Simulate: precise install exit=0 but verify() fails, then global exit=0 and verify() also fails
    const firstVerified = opts?.verify ? await opts.verify() : true;
    if (firstVerified) return { ok: true, errors: [], logPath: "/log/path" };
    return {
      ok: false,
      errors: [
        { scope: "precise" as const, stderrTail: "", code: 0, reason: "verify-failed" as const },
        { scope: "global" as const, stderrTail: "", code: 0, reason: "verify-failed" as const },
      ],
      logPath: "/log/path",
    };
  });

  const replies: string[] = [];
  const response = await router.handle("chat1", "/ss opencode --ws weacpx", async (t) => {
    replies.push(t);
  });
  const full = (response.text ?? "") + replies.join("\n");
  expect(full).toContain("自动安装已执行但未能修复");
  expect(full).toContain("安装已执行但验证失败（精确 / /p）");
  expect(full).toContain("安装已执行但验证失败（全局）");
  expect(full).toContain("npm install -g opencode-windows-x64");
  expect(full).toContain("/log/path");
});

test("retry progress handler uses a fresh elapsed timer", async () => {
  const { router, transport } = buildRouter();

  let call = 0;
  const progressCalls: Array<{ call: number; stage: string }> = [];
  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(
    async (_s: unknown, onProgress: ((stage: string) => void) | undefined) => {
      call += 1;
      const myCall = call;
      onProgress?.("spawn");
      progressCalls.push({ call: myCall, stage: "spawn" });
      if (myCall === 1) {
        throw new MissingOptionalDepError({
          package: "p",
          parentPackagePath: null,
          rawMessage: "boom",
        });
      }
    },
  );
  router.__setAutoInstallForTest(async (_pkg, _parent, opts) => {
    const verified = opts?.verify ? await opts.verify() : true;
    return { ok: verified, errors: [], logPath: "/log" };
  });

  const replies: string[] = [];
  await router.handle("chat1", "/ss opencode --ws weacpx", async (t) => {
    replies.push(t);
  });

  // Two separate "正在启动" messages — one per progress handler (initial + verify)
  expect(replies.filter((r) => r.includes("正在启动")).length).toBe(2);
});

test("discoverPaths result is passed to autoInstall and labels render per-path", async () => {
  const { router, transport } = buildRouter();

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async () => {
    throw new MissingOptionalDepError({
      package: "opencode-windows-x64",
      parentPackagePath: "/seed/opencode",
      rawMessage: "boom",
    });
  });

  router.__setDiscoverPathsForTest(async () => ["/bun/opencode", "/npm/opencode"]);

  const autoInstall = mock(async (_pkg: string, paths: string[]) => ({
    ok: false,
    errors: [
      { scope: "precise" as const, stderrTail: "E1", code: 1, reason: "exit" as const, path: paths[0] },
      { scope: "precise" as const, stderrTail: "E2", code: 1, reason: "exit" as const, path: paths[1] },
      { scope: "global" as const, stderrTail: "E3", code: 1, reason: "exit" as const },
    ],
    logPath: "/log/path",
  }));
  router.__setAutoInstallForTest(autoInstall);

  const replies: string[] = [];
  const response = await router.handle("chat1", "/ss opencode --ws weacpx", async (t) => {
    replies.push(t);
  });

  expect(autoInstall.mock.calls[0][1]).toEqual(["/bun/opencode", "/npm/opencode"]);
  const full = (response.text ?? "") + replies.join("\n");
  expect(full).toContain("安装错误（精确 / /bun/opencode）");
  expect(full).toContain("安装错误（精确 / /npm/opencode）");
  expect(full).toContain("安装错误（全局）");
});

test("progress events reach reply channel with debounce", async () => {
  const { router, transport } = buildRouter();

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async (_s: unknown, onProgress: ((stage: string) => void) | undefined) => {
    onProgress?.("spawn");
    // Without sleeping — initializing within debounce window should be suppressed
    onProgress?.("initializing");
    onProgress?.("ready");
  });

  const replies: string[] = [];
  await router.handle("chat1", "/ss opencode --ws weacpx", async (t) => {
    replies.push(t);
  });

  const spawnMsgs = replies.filter((m) => m.includes("正在启动"));
  const initMsgs = replies.filter((m) => m.includes("初始化中"));
  expect(spawnMsgs).toHaveLength(1);
  expect(initMsgs).toHaveLength(0); // debounced
});

test("reply reaches ensureTransportSession via /session new", async () => {
  const { router, transport } = buildRouter();

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async (_s: unknown, onProgress: ((stage: string) => void) | undefined) => {
    onProgress?.("spawn");
  });

  const replies: string[] = [];
  await router.handle("chat1", "/session new demo --agent opencode --ws weacpx", async (t) => {
    replies.push(t);
  });

  expect(replies.some((m) => m.includes("正在启动"))).toBe(true);
});

test("reply reaches ensureTransportSession via /session reset", async () => {
  const { router, transport } = buildRouter();

  await router.handle("chat1", "/ss opencode --ws weacpx", async () => {});

  (transport.ensureSession as ReturnType<typeof mock>).mockImplementation(async (_s: unknown, onProgress: ((stage: string) => void) | undefined) => {
    onProgress?.("spawn");
  });

  const replies: string[] = [];
  await router.handle("chat1", "/session reset", async (t) => {
    replies.push(t);
  });

  expect(replies.some((m) => m.includes("正在启动"))).toBe(true);
});
