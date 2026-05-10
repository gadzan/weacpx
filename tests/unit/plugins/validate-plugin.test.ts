import { expect, test } from "bun:test";

import { validateWeacpxPlugin } from "../../../src/plugins/validate-plugin";

test("validateWeacpxPlugin accepts a channel plugin", () => {
  const plugin = validateWeacpxPlugin({
    apiVersion: 1,
    name: "weacpx-channel-demo",
    channels: [
      { type: "demo", factory: () => ({ id: "demo", start: async () => {} }) },
    ],
  }, "weacpx-channel-demo", { currentWeacpxVersion: "0.3.3" });

  expect(plugin.name).toBe("weacpx-channel-demo");
  expect(plugin.channels?.[0]?.type).toBe("demo");
});

test("validateWeacpxPlugin rejects invalid plugin shapes", () => {
  expect(() => validateWeacpxPlugin(null, "x", { currentWeacpxVersion: "0.3.3" })).toThrow("插件 x 没有默认导出 weacpx plugin definition");
  expect(() => validateWeacpxPlugin({ apiVersion: 2 }, "x", { currentWeacpxVersion: "0.3.3" })).toThrow(/apiVersion 2/);
  expect(() => validateWeacpxPlugin({}, "x", { currentWeacpxVersion: "0.3.3" })).toThrow(/apiVersion/);
  expect(() => validateWeacpxPlugin({ apiVersion: 1, name: "other" }, "x", { currentWeacpxVersion: "0.3.3" })).toThrow("插件 x 声明的 name 与安装包名不一致：other");
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{}] }, "x", { currentWeacpxVersion: "0.3.3" })).toThrow("插件 x 注册了非法频道类型");
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{ type: "a:b", factory: () => ({ id: "a:b", start: async () => {} }) }] }, "x", { currentWeacpxVersion: "0.3.3" })).toThrow("插件 x 注册了非法频道类型：a:b");
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{ type: "demo" }] }, "x", { currentWeacpxVersion: "0.3.3" })).toThrow("插件 x 的频道 demo 缺少 factory");
});

test("validateWeacpxPlugin retains compatibility metadata on the normalized plugin", () => {
  const plugin = validateWeacpxPlugin({
    apiVersion: 1,
    name: "weacpx-channel-demo",
    minWeacpxVersion: "0.3.3",
    compatibleWeacpxVersions: ">=0.3.3",
    channels: [],
  }, "weacpx-channel-demo", { currentWeacpxVersion: "0.3.3" });

  expect(plugin.minWeacpxVersion).toBe("0.3.3");
  expect(plugin.compatibleWeacpxVersions).toBe(">=0.3.3");
});

test("validateWeacpxPlugin rejects plugin built for newer weacpx core", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "0.4.0" },
    "weacpx-channel-demo",
    { currentWeacpxVersion: "0.3.3" },
  )).toThrow(/upgrade weacpx/i);
});

test("validateWeacpxPlugin rejects plugin with malformed compatibility metadata", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "not-a-version" },
    "weacpx-channel-demo",
    { currentWeacpxVersion: "0.3.3" },
  )).toThrow(/invalid plugin metadata/i);
});

test("validateWeacpxPlugin skips core-version checks when currentWeacpxVersion is unknown", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "0.4.0", channels: [] },
    "weacpx-channel-demo",
    { currentWeacpxVersion: "unknown" },
  )).not.toThrow();
});
