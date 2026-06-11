import { expect, test } from "bun:test";

import { checkPlugins } from "../../../../src/doctor/checks/plugin-check";
import type { AppConfig } from "../../../../src/config/types";
import type { PluginDoctorIssue } from "../../../../src/plugins/plugin-doctor";

const CONFIG_PATH = "/home/.xacpx/config.json";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    plugins: [{ name: "@ganglion/xacpx-channel-feishu", enabled: true }],
    channels: [],
    ...overrides,
  } as AppConfig;
}

function baseDeps(issues: PluginDoctorIssue[], config: AppConfig = makeConfig()) {
  return {
    home: "/home",
    loadConfig: async () => config,
    resolveRuntimePaths: () => ({ configPath: CONFIG_PATH, statePath: "/home/.xacpx/state.json" }),
    resolvePluginHome: () => "/home/.xacpx/plugins",
    inspectPlugins: async () => issues,
    currentXacpxVersion: "9.9.9",
  };
}

test("checkPlugins passes when every issue is ok", async () => {
  const result = await checkPlugins(
    baseDeps([
      { level: "ok", plugin: "@ganglion/xacpx-channel-feishu", message: "plugin is installed and valid; channels: feishu" },
    ]),
  );

  expect(result.id).toBe("plugins");
  expect(result.label).toBe("Plugins");
  expect(result.severity).toBe("pass");
  expect(result.summary).toContain("healthy");
});

test("checkPlugins warns when an ok issue is mixed with a warn", async () => {
  const result = await checkPlugins(
    baseDeps([
      { level: "ok", plugin: "a", message: "plugin is installed and valid; channels: x" },
      { level: "warn", plugin: "b", message: "plugin is installed and valid but disabled; run xacpx plugin enable b" },
    ]),
  );

  expect(result.severity).toBe("warn");
  expect(result.details?.join("\n") ?? "").toContain("b: plugin is installed and valid but disabled");
});

test("checkPlugins fails when any issue is an error", async () => {
  const result = await checkPlugins(
    baseDeps([
      { level: "ok", plugin: "a", message: "ok" },
      { level: "error", plugin: "b", message: "channel type x is already provided by a" },
    ]),
  );

  expect(result.severity).toBe("fail");
  expect(result.summary).toContain("issue");
});

test("checkPlugins surfaces an import failure as fail with the package name and an actionable suggestion", async () => {
  const result = await checkPlugins(
    baseDeps([
      {
        level: "error",
        plugin: "@ganglion/xacpx-channel-feishu",
        message: "failed to import plugin: Cannot find module '@ganglion/xacpx-channel-feishu'",
      },
    ]),
  );

  expect(result.severity).toBe("fail");
  expect(result.details?.join("\n") ?? "").toContain("@ganglion/xacpx-channel-feishu");
  const suggestions = result.suggestions ?? [];
  expect(suggestions.some((s) => s.includes("xacpx plugin add @ganglion/xacpx-channel-feishu"))).toBe(true);
});

test("checkPlugins skips when config cannot be loaded and points at the Config check", async () => {
  const result = await checkPlugins({
    home: "/home",
    loadConfig: async () => {
      throw new Error("ENOENT: config.json");
    },
    resolveRuntimePaths: () => ({ configPath: CONFIG_PATH, statePath: "/home/.xacpx/state.json" }),
    resolvePluginHome: () => "/home/.xacpx/plugins",
    inspectPlugins: async () => [],
    currentXacpxVersion: "9.9.9",
  });

  expect(result.severity).toBe("skip");
  expect(result.summary).toContain("configuration could not be loaded");
  expect((result.suggestions ?? []).join("\n")).toContain("Config check");
});

test("checkPlugins skips when no plugins and no plugin-provided channels are configured", async () => {
  let inspected = false;
  const result = await checkPlugins({
    home: "/home",
    loadConfig: async () => makeConfig({ plugins: [], channels: [{ id: "weixin", type: "weixin", enabled: true }] }),
    resolveRuntimePaths: () => ({ configPath: CONFIG_PATH, statePath: "/home/.xacpx/state.json" }),
    resolvePluginHome: () => "/home/.xacpx/plugins",
    inspectPlugins: async () => {
      inspected = true;
      return [];
    },
    currentXacpxVersion: "9.9.9",
  });

  expect(result.severity).toBe("skip");
  expect(result.summary).toContain("no plugins configured");
  expect(inspected).toBe(false);
});

test("checkPlugins inspects when a plugin-provided channel is configured even with no plugins array", async () => {
  const result = await checkPlugins({
    home: "/home",
    loadConfig: async () => makeConfig({ plugins: [], channels: [{ id: "feishu", type: "feishu", enabled: true }] }),
    resolveRuntimePaths: () => ({ configPath: CONFIG_PATH, statePath: "/home/.xacpx/state.json" }),
    resolvePluginHome: () => "/home/.xacpx/plugins",
    inspectPlugins: async () => [
      { level: "error", message: "channel feishu is configured but no enabled plugin provides it; run xacpx plugin add @ganglion/xacpx-channel-feishu" },
    ],
    currentXacpxVersion: "9.9.9",
  });

  expect(result.severity).toBe("fail");
});

test("checkPlugins dedups suggestions", async () => {
  const result = await checkPlugins(
    baseDeps([
      { level: "error", plugin: "a", message: "package not installed in plugin home; run xacpx plugin add a" },
      { level: "error", plugin: "a", message: "failed to import plugin: Cannot find module 'a'" },
    ]),
  );

  const suggestions = result.suggestions ?? [];
  const unique = new Set(suggestions);
  expect(unique.size).toBe(suggestions.length);
});

test("checkPlugins passes currentXacpxVersion and resolved plugin home to inspectPlugins", async () => {
  let seen: { pluginHome?: string; currentXacpxVersion?: string } = {};
  await checkPlugins({
    home: "/home",
    loadConfig: async () => makeConfig(),
    resolveRuntimePaths: () => ({ configPath: CONFIG_PATH, statePath: "/home/.xacpx/state.json" }),
    resolvePluginHome: (input) => {
      expect(input).toMatchObject({ home: "/home" });
      return "/resolved/plugins";
    },
    inspectPlugins: async (input) => {
      seen = { pluginHome: input.pluginHome, currentXacpxVersion: input.currentXacpxVersion };
      return [{ level: "ok", plugin: "@ganglion/xacpx-channel-feishu", message: "ok" }];
    },
    currentXacpxVersion: "1.2.3",
  });

  expect(seen.pluginHome).toBe("/resolved/plugins");
  expect(seen.currentXacpxVersion).toBe("1.2.3");
});
