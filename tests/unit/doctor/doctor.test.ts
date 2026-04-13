import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, mock, test } from "bun:test";

import { checkBridge } from "../../../src/doctor/checks/bridge-check";
import { main as doctorMain } from "../../../src/doctor/index";
import { runDoctor } from "../../../src/doctor/doctor";
import type { DoctorCheckResult } from "../../../src/doctor/doctor-types";
import { checkConfig } from "../../../src/doctor/checks/config-check";
import { checkDaemon } from "../../../src/doctor/checks/daemon-check";
import { checkRuntime } from "../../../src/doctor/checks/runtime-check";
import { checkWechat } from "../../../src/doctor/checks/wechat-check";
import { DaemonStatusStore } from "../../../src/daemon/daemon-status";

async function createTempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "weacpx-doctor-"));
}

async function writeConfig(home: string, contents: string): Promise<string> {
  const configDir = join(home, ".weacpx");
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "config.json");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}

test("config check passes for a valid config file", async () => {
  const home = await createTempHome();

  try {
    await writeConfig(
      home,
      JSON.stringify(
        {
          transport: {
            type: "acpx-bridge",
          },
          agents: {
            codex: {
              driver: "codex",
            },
          },
          workspaces: {
            backend: {
              cwd: "/tmp",
            },
          },
        },
        null,
        2,
      ),
    );

    const result = await checkConfig({
      resolveRuntimePaths: () => ({
        configPath: join(home, ".weacpx", "config.json"),
        statePath: join(home, ".weacpx", "state.json"),
      }),
    });

    expect(result.severity).toBe("pass");
    expect(result.metadata?.configPath).toContain(join(home, ".weacpx", "config.json"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("config check fails with config path detail when parsing fails", async () => {
  const home = await createTempHome();

  try {
    await writeConfig(home, "{");

    const result = await checkConfig({
      resolveRuntimePaths: () => ({
        configPath: join(home, ".weacpx", "config.json"),
        statePath: join(home, ".weacpx", "state.json"),
      }),
    });

    expect(result.severity).toBe("fail");
    expect(result.details).toContain(`config path: ${join(home, ".weacpx", "config.json")}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("runtime check passes on a fresh install when runtime paths are creatable", async () => {
  const home = await createTempHome();

  try {
    const probe = createRuntimeProbe({
      directories: [home],
    });

    const result = await checkRuntime({
      home,
      probe: probe.probe,
      platform: "win32",
    });

    expect(result.severity).toBe("pass");
    expect(result.details?.join("\n") ?? "").toContain(`runtimeDir: ${join(home, ".weacpx", "runtime")}`);
    expect(probe.accessModesByPath.get(home)?.length ?? 0).toBeGreaterThan(0);
    expect(probe.accessModesByPath.get(home)?.every((mode) => mode === constants.W_OK)).toBe(true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("runtime check fails when a critical daemon path parent is not writable", async () => {
  const home = await createTempHome();

  try {
    const protectedParent = join(home, ".weacpx");
    const probe = createRuntimeProbe({
      directories: [home, protectedParent],
      deniedAccess: [protectedParent],
    });

    const result = await checkRuntime({
      home,
      probe: probe.probe,
    });

    expect(result.severity).toBe("fail");
    expect(result.details?.join("\n") ?? "").toContain(protectedParent);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon check passes when daemon status is running", async () => {
  const home = await createTempHome();
  const runtimeDir = join(home, ".weacpx", "runtime");
  const pid = 12345;

  try {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "daemon.pid"), `${pid}\n`, "utf8");
    await new DaemonStatusStore(join(runtimeDir, "status.json")).save({
      pid,
      started_at: "2026-04-07T00:00:00.000Z",
      heartbeat_at: "2026-04-07T00:01:00.000Z",
      config_path: "/cfg",
      state_path: "/state",
      app_log: "/app",
      stdout_log: "/out",
      stderr_log: "/err",
    });

    const result = await checkDaemon({
      home,
      isProcessRunning: (currentPid) => currentPid === pid,
    });

    expect(result.severity).toBe("pass");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon check warns when daemon is stopped", async () => {
  const home = await createTempHome();

  try {
    const result = await checkDaemon({ home });

    expect(result.severity).toBe("warn");
    expect(result.suggestions ?? []).toContain("run: weacpx start");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon check fails when daemon status is indeterminate", async () => {
  const home = await createTempHome();
  const runtimeDir = join(home, ".weacpx", "runtime");
  const pid = 12345;

  try {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "daemon.pid"), `${pid}\n`, "utf8");

    const result = await checkDaemon({
      home,
      isProcessRunning: (currentPid) => currentPid === pid,
    });

    expect(result.severity).toBe("fail");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("daemon check fails gracefully when status files are broken", async () => {
  const home = await createTempHome();
  const runtimeDir = join(home, ".weacpx", "runtime");

  try {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "daemon.pid"), "12345\n", "utf8");
    await writeFile(join(runtimeDir, "status.json"), "{", "utf8");

    const result = await checkDaemon({
      home,
      isProcessRunning: () => true,
    });

    expect(result.severity).toBe("fail");
    expect(result.summary).toContain("could not be read");
    expect(result.details?.join("\n") ?? "").toContain("status file");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("wechat check passes when at least one account is logged in", async () => {
  const stateDir = await createTempHome();
  const accountId = "wx-test";
  const accountsDir = join(stateDir, "openclaw-weixin");
  const accountStoreDir = join(accountsDir, "accounts");

  try {
    await mkdir(accountStoreDir, { recursive: true });
    await writeFile(join(accountsDir, "accounts.json"), JSON.stringify([accountId], null, 2), "utf8");
    await writeFile(
      join(accountStoreDir, `${accountId}.json`),
      JSON.stringify({ token: "test-token", baseUrl: "https://example.com" }, null, 2),
      "utf8",
    );

    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const result = await checkWechat();
      expect(result.severity).toBe("pass");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("wechat check passes when a later account is configured even if the first is not", async () => {
  const stateDir = await createTempHome();
  const firstAccountId = "wx-first";
  const secondAccountId = "wx-second";
  const accountsDir = join(stateDir, "openclaw-weixin");
  const accountStoreDir = join(accountsDir, "accounts");

  try {
    await mkdir(accountStoreDir, { recursive: true });
    await writeFile(
      join(accountsDir, "accounts.json"),
      JSON.stringify([firstAccountId, secondAccountId], null, 2),
      "utf8",
    );
    await writeFile(join(accountStoreDir, `${firstAccountId}.json`), JSON.stringify({}, null, 2), "utf8");
    await writeFile(
      join(accountStoreDir, `${secondAccountId}.json`),
      JSON.stringify({ token: "test-token", baseUrl: "https://example.com" }, null, 2),
      "utf8",
    );

    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const result = await checkWechat();
      expect(result.severity).toBe("pass");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("wechat check warns when no account is logged in", async () => {
  const stateDir = await createTempHome();

  try {
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const result = await checkWechat();

      expect(result.severity).toBe("warn");
      expect(result.suggestions ?? []).toContain("weacpx login");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("bridge check passes when acpx-bridge client starts and pings", async () => {
  let disposed = false;

  const result = await checkBridge({
    loadConfig: async () => ({
      transport: {
        type: "acpx-bridge",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "/resolved/acpx",
      source: "bundled",
      explanation: "bundled acpx found",
    }),
    resolveBridgeEntryPath: () => "/resolved/bridge-main.ts",
    spawnAcpxBridgeClient: async (options) => {
      expect(options).toMatchObject({
        acpxCommand: "/resolved/acpx",
        bridgeEntryPath: "/resolved/bridge-main.ts",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      });

      return {
        waitUntilReady: async () => {},
        dispose: async () => {
          disposed = true;
        },
        request: async () => ({}) as never,
        handleLine() {},
        handleExit() {},
      } as any;
    },
  });

  expect(result.severity).toBe("pass");
  expect(result.summary).toContain("responded to ping");
  expect(result.metadata).toMatchObject({
    acpxCommand: "/resolved/acpx",
    source: "bundled",
  });
  expect(disposed).toBe(true);
});

test("bridge check skips when transport type is acpx-cli", async () => {
  const result = await checkBridge({
    loadConfig: async () => ({
      transport: {
        type: "acpx-cli",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
  });

  expect(result.severity).toBe("skip");
  expect(result.summary).toContain("acpx-cli");
});

test("bridge check fails when bridge startup fails", async () => {
  const result = await checkBridge({
    loadConfig: async () => ({
      transport: {
        type: "acpx-bridge",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "/resolved/acpx",
      source: "config",
      explanation: "configured command",
    }),
    spawnAcpxBridgeClient: async () => {
      throw new Error("spawn exploded");
    },
  });

  expect(result.severity).toBe("fail");
  expect(result.details?.join("\n") ?? "").toContain("spawn exploded");
});

function createRuntimeProbe(options: {
  directories: string[];
  deniedAccess?: string[];
}): {
  probe: {
    stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
    access: (path: string, mode: number) => Promise<void>;
  };
  accessModesByPath: Map<string, number[]>;
} {
  const directories = new Set(options.directories);
  const deniedAccess = new Set(options.deniedAccess ?? []);
  const accessModesByPath = new Map<string, number[]>();

  return {
    accessModesByPath,
    probe: {
      async stat(path: string) {
        if (directories.has(path)) {
          return {
            isDirectory: () => true,
          };
        }

        throw createErrno("ENOENT", path);
      },
      async access(path: string, mode: number) {
        const calls = accessModesByPath.get(path) ?? [];
        calls.push(mode);
        accessModesByPath.set(path, calls);

        if (!directories.has(path) || deniedAccess.has(path)) {
          throw createErrno("EACCES", path);
        }
      },
    },
  };
}

function createErrno(code: string, path: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: ${path}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}


test("doctor orchestrator runs baseline checks in stable order and records smoke skip when not requested", async () => {
  const calls: string[] = [];
  const createCheck = (id: string) => async (): Promise<DoctorCheckResult> => {
    calls.push(id);
    return {
      id,
      label: id,
      severity: "pass",
      summary: `${id} ok`,
    };
  };

  const result = await runDoctor(
    {},
    {
      checkConfig: createCheck("config"),
      checkRuntime: createCheck("runtime"),
      checkDaemon: createCheck("daemon"),
      checkWechat: createCheck("wechat"),
      checkAcpx: createCheck("acpx"),
      checkBridge: createCheck("bridge"),
    },
  );

  expect(calls).toEqual(["config", "runtime", "daemon", "wechat", "acpx", "bridge"]);
  expect(result.report.checks.map((check) => check.id)).toEqual([
    "config",
    "runtime",
    "daemon",
    "wechat",
    "acpx",
    "bridge",
    "smoke",
  ]);
  expect(result.report.checks.at(-1)).toMatchObject({
    id: "smoke",
    severity: "skip",
  });
});

test("doctor orchestrator runs the real smoke check only when --smoke is true", async () => {
  let smokeCalls = 0;

  const withoutSmoke = await runDoctor(
    {},
    {
      checkConfig: async () => ({ id: "config", label: "Config", severity: "pass", summary: "ok" }),
      checkRuntime: async () => ({ id: "runtime", label: "Runtime", severity: "pass", summary: "ok" }),
      checkDaemon: async () => ({ id: "daemon", label: "Daemon", severity: "pass", summary: "ok" }),
      checkWechat: async () => ({ id: "wechat", label: "WeChat", severity: "pass", summary: "ok" }),
      checkAcpx: async () => ({ id: "acpx", label: "acpx", severity: "pass", summary: "ok" }),
      checkBridge: async () => ({ id: "bridge", label: "Bridge", severity: "pass", summary: "ok" }),
      checkSmoke: async () => {
        smokeCalls += 1;
        return { id: "smoke", label: "Smoke", severity: "pass", summary: "ok" };
      },
    },
  );

  const withSmoke = await runDoctor(
    { smoke: true },
    {
      checkConfig: async () => ({ id: "config", label: "Config", severity: "pass", summary: "ok" }),
      checkRuntime: async () => ({ id: "runtime", label: "Runtime", severity: "pass", summary: "ok" }),
      checkDaemon: async () => ({ id: "daemon", label: "Daemon", severity: "pass", summary: "ok" }),
      checkWechat: async () => ({ id: "wechat", label: "WeChat", severity: "pass", summary: "ok" }),
      checkAcpx: async () => ({ id: "acpx", label: "acpx", severity: "pass", summary: "ok" }),
      checkBridge: async () => ({ id: "bridge", label: "Bridge", severity: "pass", summary: "ok" }),
      checkSmoke: async () => {
        smokeCalls += 1;
        return { id: "smoke", label: "Smoke", severity: "warn", summary: "probe ran" };
      },
    },
  );

  expect(smokeCalls).toBe(1);
  expect(withoutSmoke.report.checks.at(-1)).toMatchObject({ id: "smoke", severity: "skip" });
  expect(withSmoke.report.checks.at(-1)).toMatchObject({ id: "smoke", severity: "warn", summary: "probe ran" });
});

test("doctor orchestrator uses injected home coherently for runtime and config-based checks", async () => {
  const home = "/tmp/weacpx-alt-home";
  const seen = {
    configPath: undefined as string | undefined,
    runtimeHome: undefined as string | undefined,
    daemonHome: undefined as string | undefined,
    acpxPath: undefined as string | undefined,
    bridgePath: undefined as string | undefined,
  };

  await runDoctor(
    {},
    {
      home,
      checkConfig: async (options) => {
        seen.configPath = options.resolveRuntimePaths?.().configPath;
        return { id: "config", label: "Config", severity: "pass", summary: "ok" };
      },
      checkRuntime: async (options) => {
        seen.runtimeHome = options.home;
        return { id: "runtime", label: "Runtime", severity: "pass", summary: "ok" };
      },
      checkDaemon: async (options) => {
        seen.daemonHome = options.home;
        return { id: "daemon", label: "Daemon", severity: "pass", summary: "ok" };
      },
      checkWechat: async () => ({ id: "wechat", label: "WeChat", severity: "pass", summary: "ok" }),
      checkAcpx: async (options) => {
        seen.acpxPath = options.resolveRuntimePaths?.().configPath;
        return { id: "acpx", label: "acpx", severity: "pass", summary: "ok" };
      },
      checkBridge: async (options) => {
        seen.bridgePath = options.resolveRuntimePaths?.().configPath;
        return { id: "bridge", label: "Bridge", severity: "pass", summary: "ok" };
      },
    },
  );

  expect(seen.runtimeHome).toBe(home);
  expect(seen.daemonHome).toBe(home);
  const expectedConfigPath = join(home, ".weacpx", "config.json");
  expect(seen.configPath).toBe(expectedConfigPath);
  expect(seen.acpxPath).toBe(expectedConfigPath);
  expect(seen.bridgePath).toBe(expectedConfigPath);
});

test("doctor orchestrator returns exit code 1 when any check fails", async () => {
  const result = await runDoctor(
    {},
    {
      checkConfig: async () => ({ id: "config", label: "Config", severity: "pass", summary: "ok" }),
      checkRuntime: async () => ({ id: "runtime", label: "Runtime", severity: "fail", summary: "broken" }),
      checkDaemon: async () => ({ id: "daemon", label: "Daemon", severity: "warn", summary: "warn" }),
      checkWechat: async () => ({ id: "wechat", label: "WeChat", severity: "pass", summary: "ok" }),
      checkAcpx: async () => ({ id: "acpx", label: "acpx", severity: "pass", summary: "ok" }),
      checkBridge: async () => ({ id: "bridge", label: "Bridge", severity: "skip", summary: "skip" }),
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Summary: PASS 3, WARN 1, FAIL 1, SKIP 2");
});

test("doctor orchestrator returns exit code 0 when report only contains pass warn and skip", async () => {
  const result = await runDoctor(
    {},
    {
      checkConfig: async () => ({ id: "config", label: "Config", severity: "pass", summary: "ok" }),
      checkRuntime: async () => ({ id: "runtime", label: "Runtime", severity: "warn", summary: "warn" }),
      checkDaemon: async () => ({ id: "daemon", label: "Daemon", severity: "pass", summary: "ok" }),
      checkWechat: async () => ({ id: "wechat", label: "WeChat", severity: "pass", summary: "ok" }),
      checkAcpx: async () => ({ id: "acpx", label: "acpx", severity: "pass", summary: "ok" }),
      checkBridge: async () => ({ id: "bridge", label: "Bridge", severity: "skip", summary: "skip" }),
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Summary: PASS 4, WARN 1, FAIL 0, SKIP 2");
});

test("doctor index main runs orchestrator and prints rendered output", async () => {
  const lines: string[] = [];
  const restore = console.log;
  const log = mock((line: string) => {
    lines.push(line);
  });
  console.log = log as typeof console.log;

  try {
    const exitCode = await doctorMain(
      {},
      {
        runDoctor: async () => ({
          report: {
            checks: [],
          },
          output: ["PASS Config: ok", "Summary: PASS 1, WARN 0, FAIL 0, SKIP 0"],
          exitCode: 0,
        }),
      },
    );

    expect(exitCode).toBe(0);
    expect(lines).toEqual(["PASS Config: ok", "Summary: PASS 1, WARN 0, FAIL 0, SKIP 0"]);
  } finally {
    console.log = restore;
  }
});
