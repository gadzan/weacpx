import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { handlePluginCli, looksLikePath } from "../../../src/plugins/plugin-cli";

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

function createHarness(initial: AppConfig) {
  let config = structuredClone(initial) as AppConfig;
  const lines: string[] = [];
  const calls: string[] = [];
  const summaries = new Map<string, { name: string; channels: string[] }>();
  const validateErrors = new Map<string, Error>();
  return {
    lines,
    calls,
    summaries,
    validateErrors,
    getConfig: () => config,
    deps: {
      loadConfig: async () => structuredClone(config) as AppConfig,
      saveConfig: async (next: AppConfig) => { config = structuredClone(next) as AppConfig; },
      print: (line: string) => lines.push(line),
      isInteractive: () => false,
      promptText: async () => "",
      getDaemonStatus: async () => ({ state: "stopped" as const }),
      restartDaemon: async () => 0,
      pluginHome: "/tmp/xacpx-plugins",
      installPackage: async (input: { packageName: string; version?: string }) => { calls.push(`install:${input.packageName}:${input.version ?? ""}`); },
      updatePackage: async (input: { packageName: string; version?: string }) => { calls.push(`update:${input.packageName}:${input.version ?? ""}`); },
      removePackage: async (packageName: string) => { calls.push(`remove:${packageName}`); },
      validateInstalledPlugin: async (packageName: string) => {
        const error = validateErrors.get(packageName);
        if (error) throw error;
        return summaries.get(packageName) ?? { name: packageName, channels: ["demo"] };
      },
      inspectPlugins: async () => [],
    },
  };
}

test("looksLikePath recognizes POSIX and Windows local paths", () => {
  // POSIX-style
  expect(looksLikePath("./packages/channel-yuanbao")).toBe(true);
  expect(looksLikePath("../foo")).toBe(true);
  expect(looksLikePath("/abs/path")).toBe(true);
  expect(looksLikePath(".")).toBe(true);
  // Windows-style (the bug: backslash relative paths weren't recognized)
  expect(looksLikePath(".\\packages\\channel-yuanbao")).toBe(true);
  expect(looksLikePath("..\\foo")).toBe(true);
  expect(looksLikePath("C:\\projects\\xacpx")).toBe(true);
  expect(looksLikePath("E:/projects/xacpx")).toBe(true);
  expect(looksLikePath("\\\\server\\share")).toBe(true);
});

test("looksLikePath treats npm package specs as non-paths", () => {
  expect(looksLikePath("xacpx-channel-demo")).toBe(false);
  expect(looksLikePath("@ganglion/xacpx-channel-yuanbao")).toBe(false);
  expect(looksLikePath("@scope/pkg")).toBe(false);
});

test("plugin list prints configured plugins", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", version: "1.0.0", enabled: true }] }));

  const code = await handlePluginCli(["list"], harness.deps);

  expect(code).toBe(0);
  expect(harness.lines).toEqual(["插件：", "- xacpx-channel-demo@1.0.0 (enabled)"]);
});

test("plugin add installs, validates, saves config, and does not enable channel", async () => {
  const harness = createHarness(baseConfig());

  const code = await handlePluginCli(["add", "xacpx-channel-demo", "--version", "^1.2.0"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["install:xacpx-channel-demo:^1.2.0"]);
  expect(harness.getConfig().plugins).toEqual([{ name: "xacpx-channel-demo", version: "^1.2.0", enabled: true }]);
  expect(harness.getConfig().channels).toEqual([{ id: "weixin", type: "weixin", enabled: true }]);
  expect(harness.lines).toContain("插件 xacpx-channel-demo 已安装");
  expect(harness.lines).toContain("提供频道：demo");
});

test("plugin rm removes plugin config and package", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));

  const code = await handlePluginCli(["rm", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["remove:xacpx-channel-demo"]);
  expect(harness.getConfig().plugins).toEqual([]);
});

test("plugin disable and enable toggle config", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));

  expect(await handlePluginCli(["disable", "xacpx-channel-demo"], harness.deps)).toBe(0);
  expect(harness.getConfig().plugins[0]?.enabled).toBe(false);

  expect(await handlePluginCli(["enable", "xacpx-channel-demo"], harness.deps)).toBe(0);
  expect(harness.getConfig().plugins[0]?.enabled).toBe(true);
});

test("plugin rm refuses when a configured channel depends on it", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "yuanbao", type: "yuanbao", enabled: true },
    ],
  }));
  harness.summaries.set("@ganglion/xacpx-channel-yuanbao", {
    name: "@ganglion/xacpx-channel-yuanbao",
    channels: ["yuanbao"],
  });

  const code = await handlePluginCli(["rm", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual([]);
  expect(harness.getConfig().plugins).toEqual([{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }]);
  expect(harness.getConfig().channels).toEqual([
    { id: "weixin", type: "weixin", enabled: true },
    { id: "yuanbao", type: "yuanbao", enabled: true },
  ]);
  expect(harness.lines.some((line) => line.includes("yuanbao") && line.includes("xacpx channel rm"))).toBe(true);
});

test("plugin disable refuses when a configured channel depends on it", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "yuanbao", type: "yuanbao", enabled: true },
    ],
  }));
  harness.summaries.set("@ganglion/xacpx-channel-yuanbao", {
    name: "@ganglion/xacpx-channel-yuanbao",
    channels: ["yuanbao"],
  });

  const code = await handlePluginCli(["disable", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins[0]?.enabled).toBe(true);
  expect(harness.lines.some((line) => line.includes("yuanbao") && line.includes("xacpx channel rm"))).toBe(true);
});

test("plugin rm proceeds when no configured channel depends on the plugin", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
  }));
  harness.summaries.set("@ganglion/xacpx-channel-yuanbao", {
    name: "@ganglion/xacpx-channel-yuanbao",
    channels: ["yuanbao"],
  });

  const code = await handlePluginCli(["rm", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["remove:@ganglion/xacpx-channel-yuanbao"]);
  expect(harness.getConfig().plugins).toEqual([]);
});

test("plugin rm refuses when validation fails and non-weixin channels are configured", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "yuanbao", type: "yuanbao", enabled: true },
    ],
  }));
  harness.validateErrors.set("@ganglion/xacpx-channel-yuanbao", new Error("plugin module missing"));

  const code = await handlePluginCli(["rm", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual([]);
  expect(harness.getConfig().plugins).toEqual([{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }]);
  expect(harness.lines.some((line) => line.includes("无法确定"))).toBe(true);
});

test("plugin rm proceeds when validation fails but only built-in channels are configured", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
  }));
  harness.validateErrors.set("@ganglion/xacpx-channel-yuanbao", new Error("plugin module missing"));

  const code = await handlePluginCli(["rm", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["remove:@ganglion/xacpx-channel-yuanbao"]);
  expect(harness.getConfig().plugins).toEqual([]);
});

test("plugin disable ignores channels that are themselves disabled", async () => {
  const harness = createHarness(baseConfig({
    plugins: [{ name: "@ganglion/xacpx-channel-yuanbao", enabled: true }],
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "yuanbao", type: "yuanbao", enabled: false },
    ],
  }));
  harness.summaries.set("@ganglion/xacpx-channel-yuanbao", {
    name: "@ganglion/xacpx-channel-yuanbao",
    channels: ["yuanbao"],
  });

  const code = await handlePluginCli(["disable", "@ganglion/xacpx-channel-yuanbao"], harness.deps);

  expect(code).toBe(0);
  expect(harness.getConfig().plugins[0]?.enabled).toBe(false);
});

test("plugin remove is the canonical alias for plugin rm", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));

  const code = await handlePluginCli(["remove", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["remove:xacpx-channel-demo"]);
  expect(harness.getConfig().plugins).toEqual([]);
  expect(harness.lines).toContain("插件 xacpx-channel-demo 已移除");
});

test("plugin update updates one configured plugin and preserves enabled state", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", version: "^1.0.0", enabled: false }] }));

  const code = await handlePluginCli(["update", "xacpx-channel-demo", "--version", "^2.0.0"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["update:xacpx-channel-demo:^2.0.0"]);
  expect(harness.getConfig().plugins).toEqual([{ name: "xacpx-channel-demo", version: "^2.0.0", enabled: false }]);
  expect(harness.lines).toContain("插件 xacpx-channel-demo 已更新");
  expect(harness.lines).toContain("提供频道：demo");
});

test("plugin update refuses unknown plugin", async () => {
  const harness = createHarness(baseConfig());

  const code = await handlePluginCli(["update", "missing-plugin"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual([]);
  expect(harness.lines).toContain("没有找到插件：missing-plugin");
});

test("plugin update rolls back to previous pinned version when validation fails", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", version: "^1.0.0", enabled: true }] }));
  harness.validateErrors.set("xacpx-channel-demo", new Error("broken plugin export"));

  const code = await handlePluginCli(["update", "xacpx-channel-demo", "--version", "^2.0.0"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual([
    "update:xacpx-channel-demo:^2.0.0",
    "update:xacpx-channel-demo:^1.0.0",
  ]);
  expect(harness.getConfig().plugins).toEqual([{ name: "xacpx-channel-demo", version: "^1.0.0", enabled: true }]);
  expect(harness.lines).toContain("插件 xacpx-channel-demo 更新后校验失败：broken plugin export");
  expect(harness.lines).toContain("已回滚到 ^1.0.0");
});

test("plugin update without prior pinned version surfaces no-rollback hint", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));
  harness.validateErrors.set("xacpx-channel-demo", new Error("broken plugin export"));

  const code = await handlePluginCli(["update", "xacpx-channel-demo", "--version", "^2.0.0"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual(["update:xacpx-channel-demo:^2.0.0"]);
  expect(harness.lines).toContain("无法自动回滚（xacpx-channel-demo 未锁定先前版本）；请手动 xacpx plugin add xacpx-channel-demo 重装。");
});

test("plugin update --all updates configured plugins in order", async () => {
  const harness = createHarness(baseConfig({
    plugins: [
      { name: "plugin-a", enabled: true },
      { name: "plugin-b", version: "^1.0.0", enabled: false },
    ],
  }));
  harness.summaries.set("plugin-a", { name: "plugin-a", channels: ["a"] });
  harness.summaries.set("plugin-b", { name: "plugin-b", channels: ["b"] });

  const code = await handlePluginCli(["update", "--all"], harness.deps);

  expect(code).toBe(0);
  expect(harness.calls).toEqual(["update:plugin-a:", "update:plugin-b:^1.0.0"]);
  expect(harness.getConfig().plugins).toEqual([
    { name: "plugin-a", enabled: true },
    { name: "plugin-b", version: "^1.0.0", enabled: false },
  ]);
  expect(harness.lines).toContain("插件 plugin-a 已更新");
  expect(harness.lines).toContain("插件 plugin-b 已更新");
});

test("plugin update --all rejects shared version flag", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "plugin-a", enabled: true }] }));

  const code = await handlePluginCli(["update", "--all", "--version", "^2.0.0"], harness.deps);

  expect(code).toBe(1);
  expect(harness.calls).toEqual([]);
  expect(harness.lines).toContain("--all cannot be combined with --version");
});

test("plugin add surfaces friendly error and exits 1 when package install fails", async () => {
  const harness = createHarness(baseConfig());
  harness.deps.installPackage = async () => {
    throw new Error("npm install xacpx-channel-demo exited with code 1");
  };

  const code = await handlePluginCli(["add", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins).toEqual([]);
  expect(harness.lines.some((line) => line.startsWith("插件 xacpx-channel-demo 安装失败："))).toBe(true);
  expect(harness.lines.every((line) => !line.includes("at "))).toBe(true);
});

test("plugin add surfaces friendly error when validation fails", async () => {
  const harness = createHarness(baseConfig());
  harness.validateErrors.set("xacpx-channel-demo", new Error("plugin module missing default export"));

  const code = await handlePluginCli(["add", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins).toEqual([]);
  expect(harness.lines.some((line) => line.startsWith("插件 xacpx-channel-demo 校验失败："))).toBe(true);
});

test("plugin add surfaces upgrade-xacpx hint when plugin requires newer core", async () => {
  const harness = createHarness(baseConfig());
  harness.validateErrors.set(
    "xacpx-channel-demo",
    new Error("插件 xacpx-channel-demo requires xacpx >=99.0.0; current is 0.3.3; upgrade xacpx"),
  );

  const code = await handlePluginCli(["add", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins).toEqual([]);
  expect(harness.lines.some((line) => /upgrade xacpx/i.test(line))).toBe(true);
});

test("plugin add surfaces unsupported-apiVersion hint", async () => {
  const harness = createHarness(baseConfig());
  harness.validateErrors.set(
    "xacpx-channel-demo",
    new Error("插件 xacpx-channel-demo 使用不支持的 apiVersion 2; supported: 1; 请安装与当前 xacpx 兼容的插件版本 (install a compatible plugin)"),
  );

  const code = await handlePluginCli(["add", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins).toEqual([]);
  expect(harness.lines.some((line) => /apiVersion 2/.test(line) && /install a compatible plugin/i.test(line))).toBe(true);
});

test("plugin rm surfaces friendly error and keeps config when uninstall fails", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));
  harness.deps.removePackage = async () => {
    throw new Error("npm uninstall xacpx-channel-demo exited with code 1");
  };

  const code = await handlePluginCli(["rm", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.getConfig().plugins).toEqual([{ name: "xacpx-channel-demo", enabled: true }]);
  expect(harness.lines.some((line) => line.startsWith("插件 xacpx-channel-demo 卸载失败："))).toBe(true);
});

test("plugin restart-after-mutation surfaces friendly error when daemon restart throws", async () => {
  const harness = createHarness(baseConfig());
  harness.deps.getDaemonStatus = async () => ({ state: "running" as const, pid: 1234 });
  harness.deps.isInteractive = () => true;
  harness.deps.promptText = async () => "y";
  harness.deps.restartDaemon = async () => {
    throw new Error("daemon did not exit within 5000ms (pid 1234)");
  };

  const code = await handlePluginCli(["add", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  // config still mutated and saved before restart attempt
  expect(harness.getConfig().plugins).toEqual([{ name: "xacpx-channel-demo", enabled: true }]);
  expect(harness.lines.some((line) => line.startsWith("配置已保存，但重启失败："))).toBe(true);
  expect(harness.lines).toContain("请查看日志：~/.xacpx/runtime/stderr.log");
  expect(harness.lines).toContain("也可以稍后执行：xacpx start");
});

test("plugin doctor prints structured diagnostics and returns zero without errors", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));
  harness.deps.inspectPlugins = async () => [
    { level: "ok", plugin: "xacpx-channel-demo", message: "plugin is installed and valid; channels: demo" },
    { level: "warn", plugin: "xacpx-channel-demo", message: "plugin has no configured channels" },
  ];

  const code = await handlePluginCli(["doctor"], harness.deps);

  expect(code).toBe(0);
  expect(harness.lines).toEqual([
    "OK xacpx-channel-demo: plugin is installed and valid; channels: demo",
    "WARN xacpx-channel-demo: plugin has no configured channels",
  ]);
});

test("plugin doctor returns one when any error is reported", async () => {
  const harness = createHarness(baseConfig({ plugins: [{ name: "xacpx-channel-demo", enabled: true }] }));
  harness.deps.inspectPlugins = async () => [
    { level: "error", plugin: "xacpx-channel-demo", message: "failed to import plugin: module not found" },
  ];

  const code = await handlePluginCli(["doctor", "xacpx-channel-demo"], harness.deps);

  expect(code).toBe(1);
  expect(harness.lines).toEqual([
    "ERROR xacpx-channel-demo: failed to import plugin: module not found",
  ]);
});

test("plugin doctor prints healthy empty state", async () => {
  const harness = createHarness(baseConfig());
  harness.deps.inspectPlugins = async () => [];

  const code = await handlePluginCli(["doctor"], harness.deps);

  expect(code).toBe(0);
  expect(harness.lines).toEqual(["插件检查通过。"]);
});

test("plugin known lists official Feishu and Yuanbao plugin packages", async () => {
  const harness = createHarness(baseConfig());

  const code = await handlePluginCli(["known"], harness.deps);

  expect(code).toBe(0);
  const output = harness.lines.join("\n");
  expect(output).toContain("@ganglion/xacpx-channel-feishu");
  expect(output).toContain("@ganglion/xacpx-channel-yuanbao");
  expect(output).toContain("xacpx plugin add <package>");
  expect(output).not.toContain("weixin");
});

test("plugin known --json outputs stable machine-readable JSON", async () => {
  const harness = createHarness(baseConfig());

  const code = await handlePluginCli(["known", "--json"], harness.deps);

  expect(code).toBe(0);
  expect(harness.lines).toHaveLength(1);
  const payload = JSON.parse(harness.lines[0]!);
  expect(Array.isArray(payload)).toBe(true);
  const packageNames = payload.map((entry: { packageName: string }) => entry.packageName);
  expect(packageNames).toContain("@ganglion/xacpx-channel-feishu");
  expect(packageNames).toContain("@ganglion/xacpx-channel-yuanbao");
  for (const entry of payload) {
    expect(entry.official).toBe(true);
    expect(Array.isArray(entry.channels)).toBe(true);
    expect(entry.channels).not.toContain("weixin");
  }
});

test("plugin known rejects unknown flags with an actionable message", async () => {
  const harness = createHarness(baseConfig());

  const code = await handlePluginCli(["known", "--bad-flag"], harness.deps);

  expect(code).toBe(1);
  expect(harness.lines.some((line) => line.includes("--bad-flag"))).toBe(true);
});
