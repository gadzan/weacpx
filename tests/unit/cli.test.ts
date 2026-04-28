import { expect, test } from "bun:test";

import { runCli } from "../../src/cli";

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
  const lines: string[] = [];

  const exitCode = await runCli(["doctor"], {
    print: (line) => {
      lines.push(line);
    },
  });

  // The default doctor runs real checks; some (e.g. bridge) may fail in test
  // environments.  We only verify the entrypoint completes without throwing
  // and that output goes to the doctor's own printer, not the CLI print sink.
  expect(typeof exitCode).toBe("number");
  expect(lines).toEqual([]);
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
