import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { createMcpStdioIdentityResolver, prepareMcpCoordinatorStartup, runCli } from "../../src/cli";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "weacpx-cli-"));
  const previousHome = process.env.HOME;
  const previousConfig = process.env.WEACPX_CONFIG;
  const previousState = process.env.WEACPX_STATE;

  process.env.HOME = home;
  delete process.env.WEACPX_CONFIG;
  delete process.env.WEACPX_STATE;

  try {
    return await fn(home);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousConfig === undefined) {
      delete process.env.WEACPX_CONFIG;
    } else {
      process.env.WEACPX_CONFIG = previousConfig;
    }
    if (previousState === undefined) {
      delete process.env.WEACPX_STATE;
    } else {
      process.env.WEACPX_STATE = previousState;
    }
    await rm(home, { recursive: true, force: true });
  }
}

async function readConfigJson(home: string): Promise<any> {
  return JSON.parse(await readFile(join(home, ".weacpx", "config.json"), "utf8"));
}

test("dispatches login", async () => {
  const events: string[] = [];

  await expect(
    runCli(["login"], {
      login: async () => {
        events.push("login");
      },
      print: (line) => {
        events.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(events).toEqual(["login"]);
});

test("prints running status", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["status"], {
      controller: {
        getStatus: async () => ({
          state: "running",
          pid: 12345,
          status: {
            pid: 12345,
            started_at: "2026-03-26T00:00:00.000Z",
            heartbeat_at: "2026-03-26T00:01:00.000Z",
            config_path: "/cfg",
            state_path: "/state",
            app_log: "/app",
            stdout_log: "/out",
            stderr_log: "/err",
          },
        }),
        start: async () => ({ state: "started", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual([
    "weacpx 正在运行",
    "PID: 12345",
    "Started: 2026-03-26T00:00:00.000Z",
    "Heartbeat: 2026-03-26T00:01:00.000Z",
    "Config: /cfg",
    "State: /state",
    "App Log: /app",
    "Stdout: /out",
    "Stderr: /err",
  ]);
});

test("prints indeterminate status when daemon pid is alive but metadata is missing", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["status"], {
      controller: {
        getStatus: async () => ({ state: "indeterminate", pid: 12345, reason: "missing-status" }),
        start: async () => ({ state: "started", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines).toEqual([
    "weacpx 进程仍在运行，但状态元数据缺失",
    "PID: 12345",
  ]);
});

test("prints already running on repeated start", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["start"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => ({ state: "already-running", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual(["weacpx 已在后台运行", "PID: 12345"]);
});

test("prints stop result", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["stop"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => ({ state: "started", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual(["weacpx 已停止"]);
});

test("prints help for unknown commands", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["nope"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines).toEqual([
    "用法：",
    "weacpx login  - 微信登录",
    "weacpx logout - 退出登录",
    "weacpx run    - 前台运行",
    "weacpx start  - 后台启动",
    "weacpx status - 查看状态",
    "weacpx stop   - 停止服务",
    "weacpx doctor - 运行诊断",
    "weacpx version - 查看版本",
    "weacpx workspace list|add|rm - 管理本机工作区（别名：ws）",
    "weacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务",
  ]);
});

test("dispatches doctor", async () => {
  const events: Array<string | Record<string, unknown>> = [];

  await expect(
    runCli(["doctor"], {
      doctor: async (options) => {
        events.push(options);
        return 7;
      },
      print: (line) => {
        events.push(line);
      },
    }),
  ).resolves.toBe(7);

  expect(events).toEqual([{}]);
});

test("uses the default doctor entrypoint when no dependency is provided", async () => {
  const home = await mkdtemp(join(tmpdir(), "weacpx-cli-doctor-"));
  const lines: string[] = [];
  const previousHome = process.env.HOME;
  const previousOpenclawStateDir = process.env.OPENCLAW_STATE_DIR;

  process.env.HOME = home;
  process.env.OPENCLAW_STATE_DIR = join(home, "openclaw");

  try {
    const exitCode = await runCli(["doctor"], {
      print: (line) => {
        lines.push(line);
      },
    });

    // The default doctor runs real checks against the configured home.  Use a
    // temporary empty home so the test covers a clean CI-like environment
    // without depending on the developer machine's ~/.weacpx files.
    expect(typeof exitCode).toBe("number");
    expect(lines).toEqual([]);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousOpenclawStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousOpenclawStateDir;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("passes doctor options through unchanged", async () => {
  const received: Array<Record<string, unknown>> = [];

  await expect(
    runCli(["doctor", "--verbose", "--smoke", "--agent", "codex", "--workspace", "backend"], {
      doctor: async (options) => {
        received.push(options);
        return 0;
      },
    }),
  ).resolves.toBe(0);

  expect(received).toEqual([
    {
      verbose: true,
      smoke: true,
      agent: "codex",
      workspace: "backend",
    },
  ]);
});

test("adds a workspace from the current directory with basename as default name", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(
      runCli(["workspace", "add"], {
        cwd: () => "/repo/backend",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual(["工作区「backend」已保存：/repo/backend"]);
    const config = await readConfigJson(home);
    expect(config.workspaces.backend).toEqual({ cwd: "/repo/backend" });
  });
});

test("adds a workspace with an explicit name via ws alias", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(
      runCli(["ws", "add", "api"], {
        cwd: () => "/repo/backend",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual(["工作区「api」已保存：/repo/backend"]);
    const config = await readConfigJson(home);
    expect(config.workspaces.api).toEqual({ cwd: "/repo/backend" });
  });
});

test("workspace add is idempotent for the same name and path", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "add", "api"], { cwd: () => "/repo/backend", print: () => {} })).resolves.toBe(0);
    await expect(
      runCli(["workspace", "add", "api"], {
        cwd: () => "/repo/backend",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual(["工作区「api」已存在：/repo/backend"]);
  });
});

test("workspace add rejects an existing name with a different path", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "add", "api"], { cwd: () => "/repo/backend", print: () => {} })).resolves.toBe(0);
    await expect(
      runCli(["workspace", "add", "api"], {
        cwd: () => "/repo/other",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(1);

    expect(lines).toEqual([
      "工作区「api」已存在，但路径不同：/repo/backend",
      "请换一个名称，或先执行：weacpx workspace rm api",
    ]);
  });
});

test("workspace add rejects an explicit blank name", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(
      runCli(["workspace", "add", " "], {
        cwd: () => "/repo/backend",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(1);

    expect(lines).toEqual(["工作区名称不能为空。"]);
  });
});

test("lists and removes workspaces from the CLI", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "add", "backend"], { cwd: () => "/repo/backend", print: () => {} })).resolves.toBe(0);
    await expect(runCli(["workspace", "add", "frontend"], { cwd: () => "/repo/frontend", print: () => {} })).resolves.toBe(0);
    await expect(runCli(["workspace", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["ws", "rm", "backend"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["ws", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual([
      "工作区列表：",
      "- backend: /repo/backend",
      "- frontend: /repo/frontend",
      "工作区「backend」已删除",
      "工作区列表：",
      "- frontend: /repo/frontend",
    ]);
  });
});

test("workspace rm trims the provided name", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "add", "api"], { cwd: () => "/repo/backend", print: () => {} })).resolves.toBe(0);
    await expect(runCli(["workspace", "rm", " api "], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual(["工作区「api」已删除"]);
  });
});

test("workspace rm rejects a blank name", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "rm", " "], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual(["工作区名称不能为空。"]);
  });
});

test("workspace list handles an empty config and rm missing returns 1", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["workspace", "rm", "missing"], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual(["还没有工作区。", "没有找到工作区「missing」。"]);
  });
});

test("workspace commands reject invalid arguments", async () => {
  const lines: string[] = [];

  await expect(runCli(["workspace", "add", "a", "b"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["workspace", "rm"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["ws", "nope"], { print: (line) => lines.push(line) })).resolves.toBe(1);

  expect(lines.filter((line) => line === "weacpx workspace list|add|rm - 管理本机工作区（别名：ws）")).toHaveLength(3);
});

test("prints doctor in help output", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["doctor", "--help"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines).toContain("weacpx doctor - 运行诊断");
});

test("prints version for 'version' command", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["version"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("unknown");
});

test("prints version for '--version' flag", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["--version"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("unknown");
});

test("prints version for '-v' flag", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["-v"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("unknown");
});

test("passes subcommand args through to mcp-stdio and returns its exit code", async () => {
  const calls: string[][] = [];

  await expect(
    runCli(["mcp-stdio", "--coordinator-session", "backend:main", "--source-handle", "backend:worker"], {
      mcpStdio: async (args) => {
        calls.push(args);
        return 0;
      },
    }),
  ).resolves.toBe(0);

  expect(calls).toEqual([["--coordinator-session", "backend:main", "--source-handle", "backend:worker"]]);
});


test("mcp coordinator startup keeps existing weacpx sessions without workspace", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "backend:main",
      config: {
        workspaces: { backend: { cwd: "/tmp/backend" } },
      },
      state: {
        sessions: {
          main: {
            alias: "main",
            agent: "codex",
            workspace: "backend",
            transport_session: "backend:main",
            created_at: "2026-04-28T00:00:00.000Z",
            last_used_at: "2026-04-28T00:00:00.000Z",
          },
        },
      },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).resolves.toEqual({ kind: "existing-session" });

  expect(registrations).toEqual([]);
});

test("mcp coordinator startup registers unknown coordinators with workspace", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "backend",
      config: {
        workspaces: { backend: { cwd: "/tmp/backend" } },
      },
      state: { sessions: {} },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).resolves.toEqual({ kind: "external-coordinator", workspace: "backend" });

  expect(registrations).toEqual([{ coordinatorSession: "codex:backend", workspace: "backend" }]);
});

test("mcp coordinator startup rejects explicit external registration that collides with an existing weacpx session", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "backend:main",
      workspace: "backend",
      config: {
        workspaces: { backend: { cwd: "/tmp/backend" } },
      },
      state: {
        sessions: {
          main: {
            alias: "main",
            agent: "codex",
            workspace: "backend",
            transport_session: "backend:main",
            created_at: "2026-04-28T00:00:00.000Z",
            last_used_at: "2026-04-28T00:00:00.000Z",
          },
        },
      },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).rejects.toThrow('coordinatorSession "backend:main" conflicts with an existing logical session');

  expect(registrations).toEqual([]);
});

test("mcp coordinator startup accepts registered external coordinators without workspace", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      config: {
        workspaces: { backend: { cwd: "/tmp/backend" } },
      },
      state: {
        sessions: {},
        orchestration: {
          externalCoordinators: {
            "codex:backend": {
              coordinatorSession: "codex:backend",
              workspace: "backend",
              createdAt: "2026-04-28T00:00:00.000Z",
              updatedAt: "2026-04-28T00:00:00.000Z",
            },
          },
        },
      },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).resolves.toEqual({ kind: "external-coordinator", workspace: "backend" });

  expect(registrations).toEqual([{ coordinatorSession: "codex:backend", workspace: "backend" }]);
});

test("mcp coordinator startup verifies daemon IPC when reusing registered external coordinators", async () => {
  const error = new Error("connect ECONNREFUSED /tmp/weacpx/orchestration.sock") as NodeJS.ErrnoException;
  error.code = "ECONNREFUSED";

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      config: {
        workspaces: { backend: { cwd: "/tmp/backend" } },
      },
      state: {
        sessions: {},
        orchestration: {
          externalCoordinators: {
            "codex:backend": {
              coordinatorSession: "codex:backend",
              workspace: "backend",
              createdAt: "2026-04-28T00:00:00.000Z",
              updatedAt: "2026-04-28T00:00:00.000Z",
            },
          },
        },
      },
      client: {
        registerExternalCoordinator: async () => {
          throw error;
        },
      },
    }),
  ).rejects.toThrow("weacpx daemon orchestration IPC is unavailable; run `weacpx start` and check `weacpx status`");
});

test("mcp coordinator startup rejects explicit workspace rebind for registered external coordinators", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "frontend",
      config: {
        workspaces: {
          backend: { cwd: "/tmp/backend" },
          frontend: { cwd: "/tmp/frontend" },
        },
      },
      state: {
        sessions: {},
        orchestration: {
          externalCoordinators: {
            "codex:backend": {
              coordinatorSession: "codex:backend",
              workspace: "backend",
              createdAt: "2026-04-28T00:00:00.000Z",
              updatedAt: "2026-04-28T00:00:00.000Z",
            },
          },
        },
      },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).rejects.toThrow(
    'coordinatorSession "codex:backend" is already bound to workspace "backend"; use a new coordinator session for workspace "frontend"',
  );

  expect(registrations).toEqual([]);
});

test("mcp coordinator startup rejects stale external coordinator workspaces without explicit refresh", async () => {
  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      config: {
        workspaces: { frontend: { cwd: "/tmp/frontend" } },
      },
      state: {
        sessions: {},
        orchestration: {
          externalCoordinators: {
            "codex:backend": {
              coordinatorSession: "codex:backend",
              workspace: "backend",
              createdAt: "2026-04-28T00:00:00.000Z",
              updatedAt: "2026-04-28T00:00:00.000Z",
            },
          },
        },
      },
      client: { registerExternalCoordinator: async (input) => input as never },
    }),
  ).rejects.toThrow(
    'workspace "backend" is not configured for coordinatorSession "codex:backend"; restore that workspace config or use a new coordinator session for a different workspace',
  );
});

test("mcp coordinator startup rejects stale external coordinator workspaces even with explicit same workspace", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "backend",
      config: {
        workspaces: { frontend: { cwd: "/tmp/frontend" } },
      },
      state: {
        sessions: {},
        orchestration: {
          externalCoordinators: {
            "codex:backend": {
              coordinatorSession: "codex:backend",
              workspace: "backend",
              createdAt: "2026-04-28T00:00:00.000Z",
              updatedAt: "2026-04-28T00:00:00.000Z",
            },
          },
        },
      },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).rejects.toThrow(
    'workspace "backend" is not configured for coordinatorSession "codex:backend"; restore that workspace config or use a new coordinator session for a different workspace',
  );

  expect(registrations).toEqual([]);
});

test("mcp coordinator startup registers unknown coordinators without workspace", async () => {
  const registrations: unknown[] = [];

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      config: { workspaces: { backend: { cwd: "/tmp/backend" } } },
      state: { sessions: {} },
      client: {
        registerExternalCoordinator: async (input) => {
          registrations.push(input);
          return input as never;
        },
      },
    }),
  ).resolves.toEqual({ kind: "external-coordinator" });

  expect(registrations).toEqual([{ coordinatorSession: "codex:backend" }]);
});

test("mcp coordinator startup rejects unconfigured external workspaces", async () => {
  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "missing",
      config: { workspaces: { backend: { cwd: "/tmp/backend" } } },
      state: { sessions: {} },
      client: { registerExternalCoordinator: async (input) => input as never },
    }),
  ).rejects.toThrow('workspace "missing" is not configured');
});

test("mcp coordinator startup turns unavailable daemon IPC into an actionable error", async () => {
  const error = new Error("connect ENOENT /tmp/weacpx/orchestration.sock") as NodeJS.ErrnoException;
  error.code = "ENOENT";

  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "backend",
      config: { workspaces: { backend: { cwd: "/tmp/backend" } } },
      state: { sessions: {} },
      client: {
        registerExternalCoordinator: async () => {
          throw error;
        },
      },
    }),
  ).rejects.toThrow("weacpx daemon orchestration IPC is unavailable; run `weacpx start` and check `weacpx status`");
});

test("mcp coordinator startup turns stale daemon workspace config into an actionable error", async () => {
  await expect(
    prepareMcpCoordinatorStartup({
      coordinatorSession: "codex:backend",
      workspace: "backend",
      config: { workspaces: { backend: { cwd: "/tmp/backend" } } },
      state: { sessions: {} },
      client: {
        registerExternalCoordinator: async () => {
          throw new Error('workspace "backend" is not configured');
        },
      },
    }),
  ).rejects.toThrow(
    'workspace "backend" is not configured in the running daemon; restart it with `weacpx stop && weacpx start`',
  );
});


test("mcp-stdio workspace-only identity resolution does not require MCP roots", async () => {
  const registrations: unknown[] = [];
  const resolver = createMcpStdioIdentityResolver({
    parsedCoordinatorSession: undefined,
    sourceHandle: null,
    workspace: "backend",
    config: { workspaces: { backend: { cwd: "/repo/backend" } } },
    state: { sessions: {} },
    client: {
      registerExternalCoordinator: async (input) => {
        registrations.push(input);
      },
    },
  });

  await expect(
    resolver({
      clientName: "Claude Code",
      listRoots: async () => {
        throw new Error("roots unsupported");
      },
    }),
  ).resolves.toEqual({ coordinatorSession: "external_claude-code:backend" });

  expect(registrations).toEqual([{ coordinatorSession: "external_claude-code:backend", workspace: "backend" }]);
});

test("mcp-stdio identity resolution without workspace does not require MCP roots", async () => {
  const registrations: unknown[] = [];
  const resolver = createMcpStdioIdentityResolver({
    parsedCoordinatorSession: undefined,
    sourceHandle: null,
    workspace: null,
    config: { workspaces: { backend: { cwd: "/repo/backend" } } },
    state: { sessions: {} },
    client: {
      registerExternalCoordinator: async (input) => {
        registrations.push(input);
      },
    },
  });

  const identity = await resolver({
    clientName: "Claude Code",
    listRoots: async () => {
      throw new Error("roots unsupported");
    },
  });

  expect(identity.coordinatorSession).toMatch(/^external_claude-code:[0-9a-f-]+$/);
  expect(registrations).toEqual([{ coordinatorSession: identity.coordinatorSession }]);
});

test("mcp-stdio returns a controlled startup error when workspace flag is missing a value", async () => {
  const stderr: string[] = [];

  await expect(
    runCli(["mcp-stdio", "--coordinator-session", "codex:backend", "--workspace", "--source-handle", "worker:1"], {
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).resolves.toBe(2);

  expect(stderr).toEqual(['--workspace requires a non-empty value\n']);
});

test("mcp-stdio returns a controlled startup error when coordinator session flag is missing a value", async () => {
  const stderr: string[] = [];

  await expect(
    runCli(["mcp-stdio", "--coordinator-session", "--workspace", "backend"], {
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).resolves.toBe(2);

  expect(stderr).toEqual(["--coordinator-session requires a non-empty value\n"]);
});

test("mcp-stdio without coordinator session starts with a process-scoped external identity", async () => {
  const stderr: string[] = [];

  await expect(
    runCli(["mcp-stdio"], {
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).resolves.toBe(0);

  expect(stderr).toEqual([]);
});

test("mcp-stdio returns a controlled startup error when local state is malformed", async () => {
  await withTempHome(async (home) => {
    const root = join(home, ".weacpx");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({
        transport: { type: "acpx-cli", command: "acpx" },
        agents: { codex: { driver: "codex" } },
        workspaces: {
          backend: {
            cwd: "/tmp/backend",
            allowed_agents: ["codex"],
          },
        },
      }),
    );
    await writeFile(join(root, "state.json"), "{not-json");
    const stderr: string[] = [];

    await expect(
      runCli(["mcp-stdio", "--coordinator-session", "codex:backend", "--workspace", "backend"], {
        stderr: (text) => {
          stderr.push(text);
        },
      }),
    ).resolves.toBe(2);

    expect(stderr.join("")).toContain(`failed to parse state file "${join(root, "state.json")}"`);
  });
});

test("prints help for '--help' flag and exits 0", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["--help"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toContain("weacpx version - 查看版本");
  expect(lines).toContain("weacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务");
});

test("prints help for '-h' flag and exits 0", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["-h"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toContain("weacpx version - 查看版本");
  expect(lines).toContain("weacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务");
});
