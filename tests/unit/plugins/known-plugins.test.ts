import { expect, test } from "bun:test";

import {
  findKnownPluginByChannel,
  getMovedChannelInstallHint,
  listKnownPlugins,
} from "../../../src/plugins/known-plugins";

test("listKnownPlugins includes Feishu and Yuanbao first-party packages", () => {
  const plugins = listKnownPlugins();
  const packageNames = plugins.map((plugin) => plugin.packageName);
  expect(packageNames).toContain("@ganglion/weacpx-channel-feishu");
  expect(packageNames).toContain("@ganglion/weacpx-channel-yuanbao");
});

test("listKnownPlugins marks every entry as official", () => {
  for (const plugin of listKnownPlugins()) {
    expect(plugin.official).toBe(true);
  }
});

test("listKnownPlugins does not surface weixin as an installable plugin", () => {
  const plugins = listKnownPlugins();
  for (const plugin of plugins) {
    expect(plugin.channels).not.toContain("weixin");
    expect(plugin.packageName).not.toContain("weixin");
  }
});

test("listKnownPlugins returns a copy so callers cannot mutate the source", () => {
  const before = listKnownPlugins();
  before[0]!.channels.push("mutated");
  const after = listKnownPlugins();
  expect(after[0]!.channels).not.toContain("mutated");
});

test("findKnownPluginByChannel returns the matching first-party package", () => {
  expect(findKnownPluginByChannel("feishu")?.packageName).toBe("@ganglion/weacpx-channel-feishu");
  expect(findKnownPluginByChannel("yuanbao")?.packageName).toBe("@ganglion/weacpx-channel-yuanbao");
});

test("findKnownPluginByChannel returns null for built-in or unknown channels", () => {
  expect(findKnownPluginByChannel("weixin")).toBeNull();
  expect(findKnownPluginByChannel("totally-unknown")).toBeNull();
});

test("getMovedChannelInstallHint returns the explicit install command for known channels", () => {
  expect(getMovedChannelInstallHint("feishu")).toBe(
    "频道 feishu 需要安装插件：weacpx plugin add @ganglion/weacpx-channel-feishu",
  );
  expect(getMovedChannelInstallHint("yuanbao")).toBe(
    "频道 yuanbao 需要安装插件：weacpx plugin add @ganglion/weacpx-channel-yuanbao",
  );
});

test("getMovedChannelInstallHint returns null for unknown channel types", () => {
  expect(getMovedChannelInstallHint("weixin")).toBeNull();
  expect(getMovedChannelInstallHint("nope")).toBeNull();
});
