import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { createMcpStdioIdentityResolver, prepareMcpCoordinatorStartup, resolveLoginChannelForCli, runCli } from "../../src/cli";
import { normalizeWorkspacePath } from "../../src/commands/workspace-path";
import { listAgentTemplates } from "../../src/config/agent-templates";
import { createEmptyState } from "../../src/state/types";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "xacpx-cli-"));
  const previousHome = process.env.HOME;
  const previousConfig = process.env.XACPX_CONFIG;
  const previousState = process.env.XACPX_STATE;

  process.env.HOME = home;
  delete process.env.XACPX_CONFIG;
  delete process.env.XACPX_STATE;

  try {
    return await fn(home);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousConfig === undefined) {
      delete process.env.XACPX_CONFIG;
    } else {
      process.env.XACPX_CONFIG = previousConfig;
    }
    if (previousState === undefined) {
      delete process.env.XACPX_STATE;
    } else {
      process.env.XACPX_STATE = previousState;
    }
    await rm(home, { recursive: true, force: true });
  }
}

async function readConfigJson(home: string): Promise<any> {
  return JSON.parse(await readFile(join(home, ".xacpx", "config.json"), "utf8"));
}

async function writeStateJson(home: string, state: any): Promise<void> {
  const root = join(home, ".xacpx");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

async function readStateJson(home: string): Promise<any> {
  return JSON.parse(await readFile(join(home, ".xacpx", "state.json"), "utf8"));
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
    "xacpx 正在运行",
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
    "xacpx 进程仍在运行，但状态元数据缺失",
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

  expect(lines).toEqual(["xacpx 已在后台运行", "PID: 12345"]);
});

test("start prints friendly error and exit code 1 when controller throws", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["start"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => {
          throw new Error("daemon exited before reporting ready state (pid 9999)");
        },
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines.some((line) => line.startsWith("xacpx 启动失败：daemon exited before reporting ready state"))).toBe(true);
  expect(lines.every((line) => !line.includes("at "))).toBe(true);
});

test("start surfaces stderr log hint when daemon dies before ready (missing plugin scenario)", async () => {
  // Simulates the case where the daemon fails to spawn because configured
  // channel `yuanbao` has no plugin installed: the foreground CLI must point
  // the user at the log file instead of printing a Node stack.
  const lines: string[] = [];

  await expect(
    runCli(["start"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => {
          throw new Error("xacpx daemon exited before reporting ready state (pid 31415)");
        },
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines.some((line) => line.startsWith("xacpx 启动失败：xacpx daemon exited before reporting ready state"))).toBe(true);
  expect(lines.some((line) => line.startsWith("请查看 App Log: ") && line.includes("app.log"))).toBe(true);
  expect(lines.some((line) => line.startsWith("请查看 Stderr: ") && line.includes("stderr.log"))).toBe(true);
});

test("start/status use daemon runtime next to custom XACPX_CONFIG", async () => {
  await withTempHome(async () => {
    const configRoot = await mkdtemp(join(tmpdir(), "xacpx-cli-config-"));
    const previousConfig = process.env.XACPX_CONFIG;
    process.env.XACPX_CONFIG = join(configRoot, "config.json");
    const runtimeDir = join(configRoot, "runtime");
    const pid = 43210;

    try {
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(join(runtimeDir, "daemon.pid"), `${pid}\n`, "utf8");
      await writeFile(
        join(runtimeDir, "status.json"),
        JSON.stringify({
          pid,
          started_at: "2026-05-19T00:00:00.000Z",
          heartbeat_at: "2026-05-19T00:01:00.000Z",
          config_path: process.env.XACPX_CONFIG,
          state_path: "/state",
          app_log: join(runtimeDir, "app.log"),
          stdout_log: join(runtimeDir, "stdout.log"),
          stderr_log: join(runtimeDir, "stderr.log"),
        }),
        "utf8",
      );

      const lines: string[] = [];
      await expect(
        runCli(["status"], {
          print: (line) => {
            lines.push(line);
          },
          isProcessRunning: (currentPid) => currentPid === pid,
        }),
      ).resolves.toBe(0);

      expect(lines).toContain("xacpx 正在运行");
      expect(lines).toContain(`App Log: ${join(runtimeDir, "app.log")}`);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.XACPX_CONFIG;
      } else {
        process.env.XACPX_CONFIG = previousConfig;
      }
      await rm(configRoot, { recursive: true, force: true });
    }
  });
});

test("start surfaces app log hint next to custom XACPX_CONFIG", async () => {
  const lines: string[] = [];
  await withTempHome(async () => {
    const configRoot = await mkdtemp(join(tmpdir(), "xacpx-cli-config-"));
    const previousConfig = process.env.XACPX_CONFIG;
    process.env.XACPX_CONFIG = join(configRoot, "config.json");
    try {
      await expect(
        runCli(["start"], {
          controller: {
            getStatus: async () => ({ state: "stopped" }),
            start: async () => {
              throw new Error("startup polling timed out");
            },
            stop: async () => ({ state: "stopped", detail: "stopped" }),
          },
          print: (line) => {
            lines.push(line);
          },
          isInteractive: () => false,
        }),
      ).resolves.toBe(1);
      expect(lines).toContain(`请查看 App Log: ${join(configRoot, "runtime", "app.log")}`);
    } finally {
      if (previousConfig === undefined) {
        delete process.env.XACPX_CONFIG;
      } else {
        process.env.XACPX_CONFIG = previousConfig;
      }
      await rm(configRoot, { recursive: true, force: true });
    }
  });
});

test("restart prints friendly error and exit code 1 when controller throws", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["restart"], {
      controller: {
        getStatus: async () => ({ state: "running", pid: 1234, status: { pid: 1234, started_at: "", heartbeat_at: "", config_path: "", state_path: "", app_log: "", stdout_log: "", stderr_log: "" } }),
        start: async () => {
          throw new Error("startup polling timed out");
        },
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines.some((line) => line.startsWith("xacpx 重启失败：startup polling timed out"))).toBe(true);
  expect(lines.every((line) => !line.includes("at "))).toBe(true);
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

  expect(lines).toEqual(["xacpx 已停止"]);
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
    "xacpx login  - 微信登录",
    "xacpx logout - 退出登录",
    "xacpx run    - 前台运行",
    "xacpx start  - 后台启动",
    "xacpx status - 查看状态",
    "xacpx stop   - 停止服务",
    "xacpx restart - 重启后台服务",
    "xacpx update [--all|<name>] - 更新 xacpx 和已安装插件",
    "xacpx channel|ch list|show|add|rm|enable|disable [--account <id>] - 管理消息频道（多 bot 用 --account）",
    "xacpx plugin list|add|update|remove|enable|disable|doctor|known - 管理插件",
    "xacpx doctor - 运行诊断",
    "xacpx version - 查看版本",
    "xacpx agent|agents list|add|rm|templates - 管理本机 Agent",
    "xacpx workspace list|add [name] [--raw]|rm <name> - 管理本机工作区（别名：ws）",
    "xacpx later|lt list|cancel <id> - 管理本机待执行定时任务",
    "xacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务",
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
  const home = await mkdtemp(join(tmpdir(), "xacpx-cli-doctor-"));
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
    // without depending on the developer machine's ~/.xacpx files.
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
      "请换一个名称，或先执行：xacpx workspace rm api",
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

test("workspace add sanitizes a non-ASCII basename by default", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(
      runCli(["workspace", "add"], {
        cwd: () => "/tmp/my repo!",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual([
      '目录名 "my repo!" 含有特殊字符，已保存为「my-repo」。如需保留原名请加 --raw。',
      "工作区「my-repo」已保存：/tmp/my repo!",
    ]);
    const config = await readConfigJson(home);
    expect(config.workspaces["my-repo"]).toEqual({ cwd: "/tmp/my repo!" });
    expect(config.workspaces["my repo!"]).toBeUndefined();
  });
});

test("workspace add sanitizes an explicit dirty name", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(runCli(["workspace", "add", "my-repo"], { cwd: () => "/repo/a", print: () => {} })).resolves.toBe(0);
    await expect(
      runCli(["workspace", "add", "My Repo"], {
        cwd: () => "/repo/b",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual([
      '名称 "My Repo" 含有特殊字符，已保存为「My-Repo」。如需保留原名请加 --raw。',
      "工作区「My-Repo」已保存：/repo/b",
    ]);
    const config = await readConfigJson(home);
    expect(config.workspaces["my-repo"]).toEqual({ cwd: "/repo/a" });
    expect(config.workspaces["My-Repo"]).toEqual({ cwd: "/repo/b" });
  });
});

test("workspace add --raw keeps a literal name with spaces", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(
      runCli(["workspace", "add", "My Repo", "--raw"], {
        cwd: () => "/repo/b",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual(["工作区「My Repo」已保存：/repo/b"]);
    const config = await readConfigJson(home);
    expect(config.workspaces["My Repo"]).toEqual({ cwd: "/repo/b" });
  });
});

test("workspace add error suggestion quotes a name that needs quoting", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(
      runCli(["workspace", "add", "My Repo", "--raw"], { cwd: () => "/repo/a", print: () => {} }),
    ).resolves.toBe(0);
    await expect(
      runCli(["workspace", "add", "My Repo", "--raw"], {
        cwd: () => "/repo/b",
        print: (line) => lines.push(line),
      }),
    ).resolves.toBe(1);

    expect(lines).toEqual([
      "工作区「My Repo」已存在，但路径不同：/repo/a",
      '请换一个名称，或先执行：xacpx workspace rm "My Repo"',
    ]);
  });
});

test("lists and removes workspaces from the CLI", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    // First CLI call seeds the default `home` workspace (cwd `~`); load-config
    // expands it via normalizeWorkspacePath, so derive the expected path the
    // same way (os.homedir() rather than the test's $HOME override).
    const homeWorkspace = normalizeWorkspacePath("~");

    await expect(runCli(["workspace", "add", "backend"], { cwd: () => "/repo/backend", print: () => {} })).resolves.toBe(0);
    await expect(runCli(["workspace", "add", "frontend"], { cwd: () => "/repo/frontend", print: () => {} })).resolves.toBe(0);
    await expect(runCli(["workspace", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["ws", "rm", "backend"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["ws", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual([
      "工作区列表：",
      `- home: ${homeWorkspace}`,
      "- backend: /repo/backend",
      "- frontend: /repo/frontend",
      "工作区「backend」已删除",
      "工作区列表：",
      `- home: ${homeWorkspace}`,
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

    // Remove the seeded home workspace so the config is genuinely empty.
    await expect(runCli(["workspace", "rm", "home"], { print: () => {} })).resolves.toBe(0);
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

  expect(lines.filter((line) => line === "xacpx workspace list|add [name] [--raw]|rm <name> - 管理本机工作区（别名：ws）")).toHaveLength(3);
});

test("agent templates lists built-in templates", async () => {
  const lines: string[] = [];

  await expect(runCli(["agent", "templates"], { print: (line) => lines.push(line) })).resolves.toBe(0);

  expect(lines).toEqual(["可用 Agent 模板：", ...listAgentTemplates().map((name) => `- ${name}`)]);
});

test("adds lists and removes agents from the CLI", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(runCli(["agent", "add", "kimi"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["agents", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["agents", "rm", "kimi"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual([
      "Agent「kimi」已保存",
      "Agent 列表：",
      "- codex: driver=codex",
      "- claude: driver=claude",
      "- kimi: driver=kimi",
      "Agent「kimi」已删除",
    ]);
    const config = await readConfigJson(home);
    expect(config.agents.kimi).toBeUndefined();
  });
});

test("agent add rejects unknown templates", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["agent", "add", "unknown"], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual([`暂不支持这个 Agent 模板。当前可用：${listAgentTemplates().join("、")}`]);
  });
});

test("agent add is idempotent and refuses to overwrite custom configs", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(runCli(["agent", "add", "codex"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    const configPath = join(home, ".xacpx", "config.json");
    const config = await readConfigJson(home);
    config.agents.qwen = { driver: "qwen", command: "custom-qwen" };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await expect(runCli(["agent", "add", "qwen"], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual([
      "Agent「codex」已存在",
      "Agent「qwen」已存在且配置不同。请先执行：xacpx agent rm qwen",
    ]);
    expect((await readConfigJson(home)).agents.qwen).toEqual({ driver: "qwen", command: "custom-qwen" });
  });
});

test("agent rm trims names and reports missing agents", async () => {
  await withTempHome(async () => {
    const lines: string[] = [];

    await expect(runCli(["agent", "rm", " claude "], { print: (line) => lines.push(line) })).resolves.toBe(0);
    await expect(runCli(["agent", "rm", "missing"], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual(["Agent「claude」已删除", "没有找到 Agent「missing」。"]);
  });
});

test("agent commands reject invalid arguments", async () => {
  const lines: string[] = [];

  await expect(runCli(["agent", "add"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["agent", "rm"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["agents", "nope"], { print: (line) => lines.push(line) })).resolves.toBe(1);

  expect(lines.filter((line) => line === "xacpx agent|agents list|add|rm|templates - 管理本机 Agent")).toHaveLength(3);
});

test("later list prints pending scheduled tasks from local state", async () => {
  await withTempHome(async (home) => {
    const state = createEmptyState();
    state.scheduled_tasks.zzzz = {
      id: "zzzz",
      chat_key: "weixin:user-1",
      session_alias: "weixin:frontend-codex",
      execute_at: "2026-05-26T01:00:00.000Z",
      message: "不应该先显示",
      status: "pending",
      created_at: "2026-05-25T10:00:00.000Z",
    };
    state.scheduled_tasks.k8f2 = {
      id: "k8f2",
      chat_key: "weixin:user-1",
      session_alias: "weixin:backend-codex",
      session_mode: "temp",
      agent: "codex",
      workspace: "backend",
      execute_at: "2026-05-25T12:00:00.000Z",
      message: "检查 CI",
      status: "pending",
      created_at: "2026-05-25T10:00:00.000Z",
    };
    state.scheduled_tasks.done1 = {
      id: "done1",
      chat_key: "weixin:user-1",
      session_alias: "weixin:backend-codex",
      execute_at: "2026-05-25T11:00:00.000Z",
      message: "已完成任务不显示",
      status: "executed",
      created_at: "2026-05-25T10:00:00.000Z",
      executed_at: "2026-05-25T11:01:00.000Z",
    };
    await writeStateJson(home, state);

    const lines: string[] = [];
    await expect(runCli(["later", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    const output = lines.join("\n");
    expect(output).toContain("待执行定时任务：");
    // ScheduledTaskService.listPending() sorts by execute_at, so the task
    // inserted second with the earlier execution time must render first.
    expect(output.indexOf("#k8f2")).toBeLessThan(output.indexOf("#zzzz"));
    expect(output).toContain("临时会话（backend · codex）");
    expect(output).toContain("检查 CI");
    expect(output).toContain("会话：frontend-codex");
    expect(output).toContain("不应该先显示");
    expect(output).not.toContain("已完成任务不显示");
  });
});

test("later list reports when there are no pending scheduled tasks", async () => {
  await withTempHome(async (home) => {
    await writeStateJson(home, createEmptyState());

    const lines: string[] = [];
    await expect(runCli(["lt", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual(["当前没有待执行定时任务。"]);
  });
});

test("later cancel cancels a pending scheduled task by id", async () => {
  await withTempHome(async (home) => {
    const state = createEmptyState();
    state.scheduled_tasks.k8f2 = {
      id: "k8f2",
      chat_key: "weixin:user-1",
      session_alias: "weixin:backend-codex",
      execute_at: "2026-05-25T12:00:00.000Z",
      message: "检查 CI",
      status: "pending",
      created_at: "2026-05-25T10:00:00.000Z",
    };
    await writeStateJson(home, state);

    const lines: string[] = [];
    await expect(runCli(["later", "cancel", "#K8F2"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toEqual(["已取消定时任务 #k8f2"]);
    const updated = await readStateJson(home);
    expect(updated.scheduled_tasks.k8f2.status).toBe("cancelled");
    expect(typeof updated.scheduled_tasks.k8f2.cancelled_at).toBe("string");
  });
});

test("later cancel returns 1 when the scheduled task is not pending", async () => {
  await withTempHome(async (home) => {
    const state = createEmptyState();
    state.scheduled_tasks.k8f2 = {
      id: "k8f2",
      chat_key: "weixin:user-1",
      session_alias: "weixin:backend-codex",
      execute_at: "2026-05-25T12:00:00.000Z",
      message: "检查 CI",
      status: "executed",
      created_at: "2026-05-25T10:00:00.000Z",
      executed_at: "2026-05-25T12:01:00.000Z",
    };
    await writeStateJson(home, state);

    const lines: string[] = [];
    await expect(runCli(["lt", "cancel", "k8f2"], { print: (line) => lines.push(line) })).resolves.toBe(1);

    expect(lines).toEqual(["未找到待执行的定时任务 #k8f2。", "可以用 xacpx later list 查看当前待执行任务。"]);
    const updated = await readStateJson(home);
    expect(updated.scheduled_tasks.k8f2.status).toBe("executed");
  });
});

test("later commands reject invalid arguments", async () => {
  const lines: string[] = [];

  await expect(runCli(["later"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["later", "cancel"], { print: (line) => lines.push(line) })).resolves.toBe(1);
  await expect(runCli(["lt", "create"], { print: (line) => lines.push(line) })).resolves.toBe(1);

  expect(lines.filter((line) => line === "xacpx later|lt list|cancel <id> - 管理本机待执行定时任务")).toHaveLength(3);
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

  expect(lines).toContain("xacpx doctor - 运行诊断");
});

test("prints version for 'version' command", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["version"], {
      print: (line) => {
        lines.push(line);
      },
      readVersion: () => "9.9.9",
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("9.9.9");
});

test("prints version for '--version' flag", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["--version"], {
      print: (line) => {
        lines.push(line);
      },
      readVersion: () => "9.9.9",
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("9.9.9");
});

test("prints version for '-v' flag", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["-v"], {
      print: (line) => {
        lines.push(line);
      },
      readVersion: () => "9.9.9",
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("9.9.9");
});

test("default readVersion returns the real package version", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["version"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toBe("unknown");
  expect(lines[0]).toMatch(/^\d+\.\d+\.\d+/);
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


test("mcp coordinator startup keeps existing xacpx sessions without workspace", async () => {
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

test("mcp coordinator startup rejects explicit external registration that collides with an existing xacpx session", async () => {
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
  const error = new Error("connect ECONNREFUSED /tmp/xacpx/orchestration.sock") as NodeJS.ErrnoException;
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
  ).rejects.toThrow("xacpx daemon orchestration IPC is unavailable; run `xacpx start` and check `xacpx status`");
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
  const error = new Error("connect ENOENT /tmp/xacpx/orchestration.sock") as NodeJS.ErrnoException;
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
  ).rejects.toThrow("xacpx daemon orchestration IPC is unavailable; run `xacpx start` and check `xacpx status`");
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
    'workspace "backend" is not configured in the running daemon; restart it with `xacpx stop && xacpx start`',
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
  ).resolves.toEqual({
    coordinatorSession: "external_claude-code:backend",
    isExternalCoordinator: true,
  });

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
  expect(identity.isExternalCoordinator).toBe(true);
  expect(registrations).toEqual([{ coordinatorSession: identity.coordinatorSession }]);
});

test("mcp-stdio identity resolution omits isExternalCoordinator when the session matches an existing logical session", async () => {
  const registrations: unknown[] = [];
  const resolver = createMcpStdioIdentityResolver({
    parsedCoordinatorSession: "backend:main",
    sourceHandle: null,
    workspace: null,
    config: { workspaces: { backend: { cwd: "/repo/backend" } } },
    state: {
      sessions: {
        "user-a": {
          alias: "main",
          transport_session: "backend:main",
          agent: "codex",
          workspace: "backend",
          chatKey: "wx:user-a",
        },
      },
    },
    client: {
      registerExternalCoordinator: async (input) => {
        registrations.push(input);
      },
    },
  });

  const identity = await resolver({
    clientName: "Claude Code",
    listRoots: async () => [],
  });

  expect(identity).toEqual({ coordinatorSession: "backend:main" });
  // Internal coordinators must NOT carry isExternalCoordinator — the registry would otherwise
  // hide coordinator_request_human_input from a WeChat coordinator that legitimately needs it.
  expect(identity).not.toHaveProperty("isExternalCoordinator");
  expect(registrations).toEqual([]);
});

test("mcp-stdio identity resolution enables internal session tools only for existing non-worker sessions", async () => {
  const state = {
    sessions: {
      "user-a": {
        alias: "main",
        transport_session: "backend:main",
        agent: "codex",
        workspace: "backend",
        chatKey: "wx:user-a",
      },
    },
  };
  const base = {
    parsedCoordinatorSession: "backend:main",
    workspace: null,
    config: { workspaces: { backend: { cwd: "/repo/backend" } } },
    state,
    client: {
      registerExternalCoordinator: async () => {
        throw new Error("should not register existing sessions");
      },
    },
    internalSessionTools: true,
  };

  const coordinatorResolver = createMcpStdioIdentityResolver({
    ...base,
    sourceHandle: null,
  });
  const workerResolver = createMcpStdioIdentityResolver({
    ...base,
    sourceHandle: "backend:worker",
  });

  await expect(coordinatorResolver({ clientName: "xacpx", listRoots: async () => [] })).resolves.toEqual({
    coordinatorSession: "backend:main",
    internalSessionTools: true,
  });
  await expect(workerResolver({ clientName: "xacpx", listRoots: async () => [] })).resolves.toEqual({
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });
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

test("mcp-stdio eagerly fails when an explicit coordinator session cannot register", async () => {
  const stderr: string[] = [];
  const previousSocket = process.env.XACPX_ORCHESTRATION_SOCKET;
  process.env.XACPX_ORCHESTRATION_SOCKET = "/tmp/xacpx-missing-orchestration.sock";

  try {
    await expect(
      runCli(["mcp-stdio", "--coordinator-session", "codex:backend"], {
        stderr: (text) => {
          stderr.push(text);
        },
      }),
    ).resolves.toBe(2);
  } finally {
    if (previousSocket === undefined) {
      delete process.env.XACPX_ORCHESTRATION_SOCKET;
    } else {
      process.env.XACPX_ORCHESTRATION_SOCKET = previousSocket;
    }
  }

  expect(stderr.join("")).toContain("xacpx daemon orchestration IPC is unavailable");
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

  expect(stderr.join("")).toContain("[xacpx:mcp] mcp.stdio.start");
});

test("mcp-stdio returns a controlled startup error when local state is malformed", async () => {
  await withTempHome(async (home) => {
    const root = join(home, ".xacpx");
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

    const expectedStatePath = join(root, "state.json").replaceAll("\\", "/");
    expect(stderr.join("").replaceAll("\\", "/")).toContain(`failed to parse state file "${expectedStatePath}"`);
  });
});

test("login channel resolver ignores feishu channel.type and returns weixin", async () => {
  await withTempHome(async (home) => {
    const configPath = join(home, ".xacpx", "config.json");
    await mkdir(join(home, ".xacpx"), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      transport: { type: "acpx-bridge" },
      channel: {
        type: "feishu",
        replyMode: "stream",
        feishu: {
          appId: "cli_xxx",
          appSecret: "secret_xxx",
          domain: "feishu",
          requireMention: true,
          textMessageFormat: "text",
          dedupTtlMs: 43200000,
          dedupMaxEntries: 5000,
        },
      },
      agents: { codex: { driver: "codex" } },
      workspaces: {},
    }, null, 2));

    const channel = await resolveLoginChannelForCli();

    expect(channel.id).toBe("weixin");
  });
});

test("dispatches channel alias to channel CLI", async () => {
  await withTempHome(async (home) => {
    const lines: string[] = [];

    await expect(runCli(["ch", "list"], { print: (line) => lines.push(line) })).resolves.toBe(0);

    expect(lines).toContain("消息频道：");
    const config = await readConfigJson(home);
    expect(config.channels).toEqual([{ id: "weixin", type: "weixin", enabled: true }]);
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

  expect(lines).toContain("xacpx version - 查看版本");
  expect(lines).toContain("xacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务");
});

test("help includes restart and channel commands", async () => {
  const lines: string[] = [];

  await expect(runCli(["--help"], { print: (line) => lines.push(line) })).resolves.toBe(0);

  expect(lines).toContain("xacpx restart - 重启后台服务");
  expect(lines).toContain("xacpx channel|ch list|show|add|rm|enable|disable [--account <id>] - 管理消息频道（多 bot 用 --account）");
});

test("restart stops then starts a running daemon", async () => {
  const lines: string[] = [];
  const events: string[] = [];

  await expect(
    runCli(["restart"], {
      controller: {
        getStatus: async () => ({
          state: "running",
          pid: 111,
          status: {
            pid: 111,
            started_at: "2026-05-05T00:00:00.000Z",
            heartbeat_at: "2026-05-05T00:00:01.000Z",
            config_path: "/cfg",
            state_path: "/state",
            app_log: "/app",
            stdout_log: "/out",
            stderr_log: "/err",
          },
        }),
        stop: async () => {
          events.push("stop");
          return { state: "stopped", detail: "stopped" };
        },
        start: async () => {
          events.push("start");
          return { state: "started", pid: 222 };
        },
      },
      print: (line) => lines.push(line),
    }),
  ).resolves.toBe(0);

  expect(events).toEqual(["stop", "start"]);
  expect(lines).toEqual(["xacpx 正在重启...", "xacpx 已停止", "xacpx 已在后台启动", "PID: 222"]);
});

test("restart starts a stopped daemon", async () => {
  const lines: string[] = [];
  const events: string[] = [];

  await expect(
    runCli(["restart"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        stop: async () => {
          events.push("stop");
          return { state: "stopped", detail: "not-running" };
        },
        start: async () => {
          events.push("start");
          return { state: "started", pid: 333 };
        },
      },
      print: (line) => lines.push(line),
    }),
  ).resolves.toBe(0);

  expect(events).toEqual(["start"]);
  expect(lines).toEqual(["xacpx 未运行，正在启动...", "xacpx 已在后台启动", "PID: 333"]);
});

test("restart rejects indeterminate daemon state", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["restart"], {
      controller: {
        getStatus: async () => ({ state: "indeterminate", pid: 444, reason: "missing-status" }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
        start: async () => ({ state: "started", pid: 555 }),
      },
      print: (line) => lines.push(line),
    }),
  ).resolves.toBe(1);

  expect(lines).toEqual([
    "xacpx 进程仍在运行，但状态元数据缺失",
    "PID: 444",
    "请先执行 `xacpx stop`，或手动清理 stale PID/status 后再重试。",
  ]);
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

  expect(lines).toContain("xacpx version - 查看版本");
  expect(lines).toContain("xacpx mcp-stdio [--coordinator-session <session>] [--source-handle <handle>] [--workspace <name>] - 启动 MCP stdio 服务");
});

test("runCli routes plugin command", async () => {
  const lines: string[] = [];
  const code = await runCli(["plugin", "list"], {
    print: (line) => lines.push(line),
    pluginCliDeps: {
      loadConfig: async () => ({
        transport: { type: "acpx-bridge", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
        logging: { level: "info", maxSizeBytes: 2097152, maxFiles: 5, retentionDays: 7 },
        channel: { type: "weixin", replyMode: "stream" },
        channels: [{ id: "weixin", type: "weixin", enabled: true }],
        plugins: [],
        agents: {},
        workspaces: {},
        orchestration: {
          maxPendingAgentRequestsPerCoordinator: 3,
          allowWorkerChainedRequests: false,
          allowedAgentRequestTargets: [],
          allowedAgentRequestRoles: [],
          progressHeartbeatSeconds: 300,
        },
      }),
      saveConfig: async () => {},
      getDaemonStatus: async () => ({ state: "stopped" }),
      restartDaemon: async () => 0,
    },
  });

  expect(code).toBe(0);
  expect(lines).toEqual(["还没有安装插件。"]);
});
