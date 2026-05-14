import { expect, test } from "bun:test";
import type { AppConfig } from "../../src/config/types";
import { handleUpdateCli } from "../../src/cli-update";

function config(plugins: AppConfig["plugins"] = []): AppConfig {
  return {
    transport: { type: "acpx-bridge", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 1, maxFiles: 1, retentionDays: 1 },
    channel: { type: "weixin", replyMode: "stream" },
    channels: [],
    plugins,
    agents: {},
    workspaces: {},
    orchestration: { maxPendingAgentRequestsPerCoordinator: 1, allowWorkerChainedRequests: false, allowedAgentRequestTargets: [], allowedAgentRequestRoles: [], progressHeartbeatSeconds: 0 },
  };
}

test("update --all updates weacpx and plugins after checking latest versions", async () => {
  const lines: string[] = [];
  const updated: string[] = [];
  let saved: AppConfig | null = null;

  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async (next) => { saved = next; },
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "weacpx" ? "0.5.0" : "1.2.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
    validatePlugin: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["weacpx", "p1"]);
  expect(saved?.plugins[0]?.version).toBe("1.2.0");
  expect(lines).toContain("1. weacpx (0.4.0 -> 0.5.0)");
  expect(lines).toContain("2. 插件 p1 (1.0.0 -> 1.2.0)");
});

test("update prompts for selection when plugins are installed", async () => {
  const updated: string[] = [];
  const code = await handleUpdateCli([], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: () => {},
    isInteractive: () => true,
    promptText: async () => "2",
    getLatestVersion: async () => "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
    validatePlugin: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["p1"]);
});

test("update unknown target does not fall back to self", async () => {
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["not-exist"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async () => "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain("没有找到更新项：not-exist");
});

test("update skips entries already at latest version", async () => {
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => { throw new Error("should not save"); },
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "weacpx" ? "0.4.0" : "1.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(0);
  expect(updated).toEqual([]);
  expect(lines).toContain("没有需要更新的项目。");
});

test("update rolls back pinned plugin and does not save config when validation fails", async () => {
  const operations: string[] = [];
  const code = await handleUpdateCli(["p1"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => { throw new Error("should not save"); },
    readCurrentVersion: () => "0.4.0",
    print: () => {},
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "p1" ? "2.0.0" : "0.4.0",
    updateSelf: async () => {},
    updatePlugin: async ({ packageName, version }) => { operations.push(`${packageName}@${version ?? "latest"}`); },
    validatePlugin: async () => { throw new Error("bad plugin"); },
  });

  expect(code).toBe(1);
  expect(operations).toEqual(["p1@2.0.0", "p1@1.0.0"]);
});

test("update --all fails when any latest version cannot be checked", async () => {
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "weacpx" ? null : "2.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain("以下项目无法检查最新版本，已取消更新：weacpx");
});

test("self-only update requires confirmation in implicit non-interactive mode", async () => {
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli([], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async () => "0.5.0",
    updateSelf: async (name) => { updated.push(name); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain("更新 weacpx 本体需要确认；非交互模式请使用 `weacpx update --all` 或 `weacpx update weacpx`。");
});


test("update --all refuses unpinned plugins because current version is unknown", async () => {
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", enabled: true }]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async () => "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain("以下项目无法检查最新版本，已取消更新：p1");
});
