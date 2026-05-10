import { expect, test } from "bun:test";

import { installPluginPackage, removePluginPackage, updatePluginPackage } from "../../../src/plugins/package-manager";

test("installPluginPackage runs add in plugin home", async () => {
  const calls: unknown[] = [];
  await installPluginPackage({
    packageName: "weacpx-channel-demo",
    pluginHome: "/tmp/weacpx-plugins",
    packageManager: "npm",
    runCommand: async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); },
  });

  expect(calls).toEqual([{ command: "npm", args: ["install", "weacpx-channel-demo"], cwd: "/tmp/weacpx-plugins" }]);
});

test("installPluginPackage appends version range", async () => {
  const calls: unknown[] = [];
  await installPluginPackage({
    packageName: "weacpx-channel-demo",
    version: "^1.2.0",
    pluginHome: "/tmp/weacpx-plugins",
    packageManager: "bun",
    runCommand: async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); },
  });

  expect(calls).toEqual([{ command: "bun", args: ["add", "weacpx-channel-demo@^1.2.0"], cwd: "/tmp/weacpx-plugins" }]);
});

test("updatePluginPackage reuses package-manager add semantics", async () => {
  const calls: unknown[] = [];
  await updatePluginPackage({
    packageName: "weacpx-channel-demo",
    version: "2.0.0",
    pluginHome: "/tmp/weacpx-plugins",
    packageManager: "npm",
    runCommand: async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); },
  });

  expect(calls).toEqual([{ command: "npm", args: ["install", "weacpx-channel-demo@2.0.0"], cwd: "/tmp/weacpx-plugins" }]);
});

test("updatePluginPackage without version uses bare package name", async () => {
  const calls: unknown[] = [];
  await updatePluginPackage({
    packageName: "weacpx-channel-demo",
    pluginHome: "/tmp/weacpx-plugins",
    packageManager: "bun",
    runCommand: async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); },
  });

  expect(calls).toEqual([{ command: "bun", args: ["add", "weacpx-channel-demo"], cwd: "/tmp/weacpx-plugins" }]);
});

test("removePluginPackage runs remove in plugin home", async () => {
  const calls: unknown[] = [];
  await removePluginPackage({
    packageName: "weacpx-channel-demo",
    pluginHome: "/tmp/weacpx-plugins",
    packageManager: "npm",
    runCommand: async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); },
  });

  expect(calls).toEqual([{ command: "npm", args: ["uninstall", "weacpx-channel-demo"], cwd: "/tmp/weacpx-plugins" }]);
});
