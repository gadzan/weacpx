import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { inspectPlugins } from "../../../src/plugins/plugin-doctor";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    transport: { type: "acpx-bridge", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 2097152, maxFiles: 5, retentionDays: 7 },
    channel: { type: "weixin", replyMode: "stream" },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
    plugins: [],
    agents: { codex: { driver: "codex" } },
    workspaces: {},
    orchestration: {
      maxPendingAgentRequestsPerCoordinator: 3,
      allowWorkerChainedRequests: false,
      allowedAgentRequestTargets: [],
      allowedAgentRequestRoles: [],
      progressHeartbeatSeconds: 300,
    },
    ...overrides,
  };
}

async function createPluginHome(dependencies: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-plugin-doctor-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }, null, 2));
  return dir;
}

test("doctor reports ok for valid configured plugin", async () => {
  const pluginHome = await createPluginHome({ "weacpx-channel-demo": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => ({ default: { apiVersion: 1, name: "weacpx-channel-demo", channels: [{ type: "demo", factory: () => ({ id: "demo", start: async () => {}, stop: async () => {} }) }] } }),
    });

    expect(issues).toContainEqual({ level: "ok", plugin: "weacpx-channel-demo", message: "plugin is installed and valid; channels: demo" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports missing dependency error", async () => {
  const pluginHome = await createPluginHome();
  try {
    const issues = await inspectPlugins({
      pluginHome,
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => ({ default: { apiVersion: 1, name: "weacpx-channel-demo", channels: [] } }),
    });

    expect(issues).toContainEqual({ level: "error", plugin: "weacpx-channel-demo", message: "package not installed in plugin home; run xacpx plugin add weacpx-channel-demo" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports import and validation failures", async () => {
  const pluginHome = await createPluginHome({ "weacpx-channel-demo": "1.0.0" });
  try {
    const importIssues = await inspectPlugins({
      pluginHome,
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => { throw new Error("module not found"); },
    });
    expect(importIssues).toContainEqual({ level: "error", plugin: "weacpx-channel-demo", message: "failed to import plugin: module not found" });

    const validationIssues = await inspectPlugins({
      pluginHome,
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => ({ default: { apiVersion: 2, name: "weacpx-channel-demo", channels: [] } }),
    });
    expect(validationIssues.some((issue) => issue.level === "error" && issue.message.includes("apiVersion"))).toBe(true);
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports duplicate channel type across configured plugins", async () => {
  const pluginHome = await createPluginHome({ "plugin-a": "1.0.0", "plugin-b": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      config: baseConfig({ plugins: [{ name: "plugin-a", enabled: true }, { name: "plugin-b", enabled: true }] }),
      importPlugin: async (name) => ({ default: { apiVersion: 1, name, channels: [{ type: "demo", factory: () => ({ id: "demo", start: async () => {}, stop: async () => {} }) }] } }),
    });

    expect(issues).toContainEqual({ level: "error", plugin: "plugin-b", message: "channel type demo is already provided by plugin-a" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports error when configured channel has no provider plugin", async () => {
  const pluginHome = await createPluginHome();
  try {
    const issues = await inspectPlugins({
      pluginHome,
      config: baseConfig({
        plugins: [],
        channels: [
          { id: "weixin", type: "weixin", enabled: true },
          { id: "yuanbao", type: "yuanbao", enabled: true },
        ],
      }),
      importPlugin: async () => ({ default: { apiVersion: 1, channels: [] } }),
    });

    expect(issues).toContainEqual({ level: "error", message: "channel yuanbao is configured but no enabled plugin provides it; run xacpx plugin add @ganglion/xacpx-channel-yuanbao or another plugin that provides type \"yuanbao\"" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor with name filter still detects cross-plugin channel type conflicts", async () => {
  const pluginHome = await createPluginHome({ "plugin-a": "1.0.0", "plugin-b": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      pluginName: "plugin-b",
      config: baseConfig({ plugins: [{ name: "plugin-a", enabled: true }, { name: "plugin-b", enabled: true }] }),
      importPlugin: async (name) => ({ default: { apiVersion: 1, name, channels: [{ type: "demo", factory: () => ({ id: "demo", start: async () => {}, stop: async () => {} }) }] } }),
    });

    expect(issues).toContainEqual({ level: "error", plugin: "plugin-b", message: "channel type demo is already provided by plugin-a" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports plugin requiring newer weacpx core", async () => {
  const pluginHome = await createPluginHome({ "weacpx-channel-demo": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      currentWeacpxVersion: "0.3.3",
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => ({
        default: {
          apiVersion: 1,
          name: "weacpx-channel-demo",
          minWeacpxVersion: "0.4.0",
          channels: [{ type: "demo", factory: () => ({ id: "demo", start: async () => {}, stop: async () => {} }) }],
        },
      }),
    });

    expect(issues.some((issue) =>
      issue.level === "error" &&
      issue.plugin === "weacpx-channel-demo" &&
      /requires xacpx >=?0\.4\.0/.test(issue.message) &&
      /upgrade xacpx/i.test(issue.message),
    )).toBe(true);
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor reports plugin built for unsupported apiVersion", async () => {
  const pluginHome = await createPluginHome({ "weacpx-channel-demo": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      currentWeacpxVersion: "0.3.3",
      config: baseConfig({ plugins: [{ name: "weacpx-channel-demo", enabled: true }] }),
      importPlugin: async () => ({
        default: {
          apiVersion: 2,
          name: "weacpx-channel-demo",
          channels: [],
        },
      }),
    });

    expect(issues.some((issue) =>
      issue.level === "error" &&
      issue.plugin === "weacpx-channel-demo" &&
      /apiVersion 2/.test(issue.message) &&
      /supported: 1/.test(issue.message),
    )).toBe(true);
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});

test("doctor errors when configured channel provider plugin is disabled", async () => {
  const pluginHome = await createPluginHome({ "weacpx-channel-demo": "1.0.0" });
  try {
    const issues = await inspectPlugins({
      pluginHome,
      config: baseConfig({
        plugins: [{ name: "weacpx-channel-demo", enabled: false }],
        channels: [
          { id: "weixin", type: "weixin", enabled: true },
          { id: "demo", type: "demo", enabled: true },
        ],
      }),
      importPlugin: async () => ({ default: { apiVersion: 1, name: "weacpx-channel-demo", channels: [{ type: "demo", factory: () => ({ id: "demo", start: async () => {}, stop: async () => {} }) }] } }),
    });

    expect(issues).toContainEqual({ level: "error", plugin: "weacpx-channel-demo", message: "channel demo is configured but provider plugin is disabled; run xacpx plugin enable weacpx-channel-demo" });
  } finally {
    await rm(pluginHome, { recursive: true, force: true });
  }
});
