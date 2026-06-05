import { expect, test, beforeAll } from "bun:test";

import { validateWeacpxPlugin } from "../../../src/plugins/validate-plugin";
import { setLocale, t } from "../../../src/i18n";

beforeAll(() => { setLocale("zh"); });

test("validateWeacpxPlugin accepts a channel plugin", () => {
  const plugin = validateWeacpxPlugin({
    apiVersion: 1,
    name: "weacpx-channel-demo",
    channels: [
      { type: "demo", factory: () => ({ id: "demo", start: async () => {} }) },
    ],
  }, "weacpx-channel-demo", { currentXacpxVersion: "0.3.3" });

  expect(plugin.name).toBe("weacpx-channel-demo");
  expect(plugin.channels?.[0]?.type).toBe("demo");
});

test("validateWeacpxPlugin rejects invalid plugin shapes", () => {
  expect(() => validateWeacpxPlugin(null, "x", { currentXacpxVersion: "0.3.3" })).toThrow(t().pluginCli.pluginNoDefaultExport("x"));
  expect(() => validateWeacpxPlugin({ apiVersion: 2 }, "x", { currentXacpxVersion: "0.3.3" })).toThrow(/apiVersion 2/);
  expect(() => validateWeacpxPlugin({}, "x", { currentXacpxVersion: "0.3.3" })).toThrow(/apiVersion/);
  expect(() => validateWeacpxPlugin({ apiVersion: 1, name: "other" }, "x", { currentXacpxVersion: "0.3.3" })).toThrow(t().pluginCli.pluginNameMismatch("x", "other"));
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{}] }, "x", { currentXacpxVersion: "0.3.3" })).toThrow(t().pluginCli.pluginIllegalChannelTypeNoType("x"));
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{ type: "a:b", factory: () => ({ id: "a:b", start: async () => {} }) }] }, "x", { currentXacpxVersion: "0.3.3" })).toThrow(t().pluginCli.pluginIllegalChannelType("x", "a:b"));
  expect(() => validateWeacpxPlugin({ apiVersion: 1, channels: [{ type: "demo" }] }, "x", { currentXacpxVersion: "0.3.3" })).toThrow(t().pluginCli.pluginMissingFactory("x", "demo"));
});

test("validateWeacpxPlugin retains compatibility metadata on the normalized plugin", () => {
  const plugin = validateWeacpxPlugin({
    apiVersion: 1,
    name: "weacpx-channel-demo",
    minWeacpxVersion: "0.3.3",
    compatibleWeacpxVersions: ">=0.3.3",
    channels: [],
  }, "weacpx-channel-demo", { currentXacpxVersion: "0.3.3" });

  expect(plugin.minWeacpxVersion).toBe("0.3.3");
  expect(plugin.compatibleWeacpxVersions).toBe(">=0.3.3");
});

test("validateWeacpxPlugin rejects plugin built for newer weacpx core", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "0.4.0" },
    "weacpx-channel-demo",
    { currentXacpxVersion: "0.3.3" },
  )).toThrow(/upgrade xacpx/i);
});

test("validateWeacpxPlugin rejects plugin with malformed compatibility metadata", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "not-a-version" },
    "weacpx-channel-demo",
    { currentXacpxVersion: "0.3.3" },
  )).toThrow(/invalid plugin metadata/i);
});

test("validateWeacpxPlugin skips core-version checks when currentXacpxVersion is unknown", () => {
  expect(() => validateWeacpxPlugin(
    { apiVersion: 1, minWeacpxVersion: "0.4.0", channels: [] },
    "weacpx-channel-demo",
    { currentXacpxVersion: "unknown" },
  )).not.toThrow();
});
