import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { runCli } from "../../src/cli";

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
    "weacpx mcp-stdio --coordinator-session <session> [--source-handle <handle>] - 启动 MCP stdio 服务",
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

test("prints chinese stderr and returns exit code 2 when mcp-stdio is missing coordinator session", async () => {
  const stderr: string[] = [];

  await expect(
    runCli(["mcp-stdio"], {
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).resolves.toBe(2);

  expect(stderr).toEqual([
    "weacpx mcp-stdio 需要 --coordinator-session <handle> 或 WEACPX_COORDINATOR_SESSION 环境变量\n",
  ]);
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
  expect(lines).toContain("weacpx mcp-stdio --coordinator-session <session> [--source-handle <handle>] - 启动 MCP stdio 服务");
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
  expect(lines).toContain("weacpx mcp-stdio --coordinator-session <session> [--source-handle <handle>] - 启动 MCP stdio 服务");
});
