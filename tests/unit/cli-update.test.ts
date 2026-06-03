import { expect, test } from "bun:test";
import type { AppConfig } from "../../src/config/types";
import { handleUpdateCli } from "../../src/cli-update";
import { setLocale, t } from "../../src/i18n";

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

test("update --all updates xacpx and plugins after checking latest versions", async () => {
  setLocale("zh");
  const lines: string[] = [];
  const updated: string[] = [];
  let saved: AppConfig | null = null;

  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async (next) => { saved = next; },
    readCurrentVersion: () => "0.8.0",
    packageName: "xacpx",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "xacpx" ? "0.8.1" : "1.2.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
    validatePlugin: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["xacpx", "p1"]);
  expect(saved?.plugins[0]?.version).toBe("1.2.0");
  expect(lines).toContain(`1. ${t().cliUpdate.formatSelf("xacpx", "0.8.0", "0.8.1")}`);
  expect(lines).toContain(`2. ${t().cliUpdate.formatPlugin("p1", "1.0.0", "1.2.0")}`);
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
    getLatestVersion: async (name) => name === "xacpx" ? null : "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
    validatePlugin: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["p1"]);
});

test("update unknown target does not fall back to self", async () => {
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["not-exist"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.4.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "xacpx" ? null : "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain(t().cliUpdate.targetNotFound("not-exist"));
});

test("update skips entries already at latest version", async () => {
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => { throw new Error("should not save"); },
    readCurrentVersion: () => "0.8.0",
    packageName: "xacpx",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "xacpx" ? "0.8.0" : "1.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(0);
  expect(updated).toEqual([]);
  expect(lines).toContain(t().cliUpdate.nothingToUpdate);
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
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", version: "1.0.0", enabled: true }]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.8.0",
    packageName: "xacpx",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async (name) => name === "xacpx" ? null : "2.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain(t().cliUpdate.unavailableAborted("xacpx"));
});

test("self-only update requires confirmation in implicit non-interactive mode", async () => {
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli([], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.8.0",
    packageName: "xacpx",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    getLatestVersion: async () => "0.8.1",
    updateSelf: async (name) => { updated.push(name); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain(t().cliUpdate.selfUpdateNeedsConfirmNonInteractive("xacpx"));
});


// --- weacpx → xacpx rename migration (forward-compat baked into 0.7.x) ---

test("update --all migrates to the renamed successor once it is published", async () => {
  setLocale("zh");
  const migrations: Array<{ from: string; to: string; toVersion?: string }> = [];
  const updated: string[] = [];
  let stopped = 0;
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "0.8.0" : "0.7.0"),
    updateSelf: async (name) => { updated.push(name); },
    migrateSelf: async (input) => { migrations.push(input); },
    stopDaemon: async () => { stopped += 1; },
  });

  expect(code).toBe(0);
  expect(migrations).toEqual([{ from: "weacpx", to: "xacpx", toVersion: "0.8.0" }]);
  expect(updated).toEqual([]); // in-place self-update must NOT be used for a rename
  expect(stopped).toBe(1); // daemon stopped before the package swap
  expect(lines.some((line) => line === `1. ${t().cliUpdate.formatRename("xacpx", "0.7.0", "0.8.0")}`)).toBe(true);
  expect(lines.some((line) => line === t().cliUpdate.renameMigrated("xacpx", "0.8.0"))).toBe(true);
});

test("update does not redirect while the successor is unpublished (dormant)", async () => {
  const migrations: unknown[] = [];
  const updated: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: () => {},
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? null : "0.7.1"),
    updateSelf: async (name) => { updated.push(name); },
    migrateSelf: async (input) => { migrations.push(input); },
    stopDaemon: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["weacpx"]); // normal in-place self-update
  expect(migrations).toEqual([]);
});

test("a successor prerelease does not trip the rename for everyone", async () => {
  const migrations: unknown[] = [];
  const updated: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: () => {},
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "0.8.0-rc.1" : "0.7.1"),
    updateSelf: async (name) => { updated.push(name); },
    migrateSelf: async (input) => { migrations.push(input); },
    stopDaemon: async () => {},
  });

  expect(code).toBe(0);
  expect(updated).toEqual(["weacpx"]);
  expect(migrations).toEqual([]);
});

test("a failed migration is reported and does not fall back to an in-place update", async () => {
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "0.8.0" : "0.7.0"),
    updateSelf: async (name) => { updated.push(name); },
    migrateSelf: async () => { throw new Error("npm install failed"); },
    stopDaemon: async () => {},
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines.some((line) => line === t().cliUpdate.updateFailed("weacpx", "npm install failed"))).toBe(true);
});

test("explicit `update xacpx` matches the self target and migrates", async () => {
  const migrations: Array<{ from: string; to: string }> = [];
  const code = await handleUpdateCli(["xacpx"], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: () => {},
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "0.8.0" : "0.7.0"),
    updateSelf: async () => {},
    migrateSelf: async ({ from, to }) => { migrations.push({ from, to }); },
    stopDaemon: async () => {},
  });

  expect(code).toBe(0);
  expect(migrations).toEqual([{ from: "weacpx", to: "xacpx" }]);
});

test("implicit rename migration requires confirmation in interactive mode", async () => {
  setLocale("zh");
  const migrations: unknown[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli([], {
    loadConfig: async () => config([]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.7.0",
    print: (line) => lines.push(line),
    isInteractive: () => true,
    promptText: async () => "n",
    packageName: "weacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "0.8.0" : "0.7.0"),
    updateSelf: async () => {},
    migrateSelf: async (input) => { migrations.push(input); },
    stopDaemon: async () => {},
  });

  expect(code).toBe(0);
  expect(migrations).toEqual([]); // user declined
  expect(lines.some((line) => line === t().cliUpdate.renameCancelled("xacpx"))).toBe(true);
});

test("update --all refuses unpinned plugins because current version is unknown", async () => {
  setLocale("zh");
  const updated: string[] = [];
  const lines: string[] = [];
  const code = await handleUpdateCli(["--all"], {
    loadConfig: async () => config([{ name: "p1", enabled: true }]),
    saveConfig: async () => {},
    readCurrentVersion: () => "0.8.0",
    packageName: "xacpx",
    print: (line) => lines.push(line),
    isInteractive: () => false,
    promptText: async () => "",
    // self (xacpx) is at latest so it is neither a candidate nor unavailable;
    // the unpinned plugin p1 is what gets refused.
    getLatestVersion: async (name) => name === "xacpx" ? "0.8.0" : "9.0.0",
    updateSelf: async (name) => { updated.push(name); },
    updatePlugin: async ({ packageName }) => { updated.push(packageName); },
  });

  expect(code).toBe(1);
  expect(updated).toEqual([]);
  expect(lines).toContain(t().cliUpdate.unavailableAborted("p1"));
});
