import { expect, test } from "bun:test";

import {
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  compareSemver,
  isVersionSatisfied,
  validatePluginCompatibility,
} from "../../../src/plugins/compatibility";

test("compareSemver orders patch/minor/major", () => {
  expect(compareSemver("0.3.3", "0.3.3")).toBe(0);
  expect(compareSemver("0.3.3", "0.3.4")).toBe(-1);
  expect(compareSemver("0.3.4", "0.3.3")).toBe(1);
  expect(compareSemver("0.3.3", "0.4.0")).toBe(-1);
  expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  expect(compareSemver("10.0.0", "9.0.0")).toBe(1);
});

test("compareSemver throws on malformed versions", () => {
  expect(() => compareSemver("0.3", "0.3.3")).toThrow();
  expect(() => compareSemver("not-a-version", "0.3.3")).toThrow();
});

test("isVersionSatisfied accepts exact, >= and ^ ranges", () => {
  expect(isVersionSatisfied("0.3.3", "0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.3.4", "0.3.3")).toBe(false);
  expect(isVersionSatisfied("0.3.3", ">=0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.3.4", ">=0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.3.2", ">=0.3.3")).toBe(false);
  expect(isVersionSatisfied("0.4.0", ">=0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.3.3", "^0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.3.9", "^0.3.3")).toBe(true);
  expect(isVersionSatisfied("0.4.0", "^0.3.3")).toBe(false);
  expect(isVersionSatisfied("1.2.3", "^1.0.0")).toBe(true);
  expect(isVersionSatisfied("2.0.0", "^1.0.0")).toBe(false);
});

test("isVersionSatisfied rejects malformed range", () => {
  expect(() => isVersionSatisfied("0.3.3", "<0.3.3")).toThrow();
  expect(() => isVersionSatisfied("0.3.3", "")).toThrow();
});

test("validatePluginCompatibility accepts current core matching minWeacpxVersion", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, minWeacpxVersion: "0.3.3" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).not.toThrow();
});

test("validatePluginCompatibility accepts current core matching range", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, compatibleWeacpxVersions: ">=0.3.3" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.4.0" },
  )).not.toThrow();
});

test("validatePluginCompatibility rejects too-new plugin with upgrade-weacpx hint", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, minWeacpxVersion: "0.4.0" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/weacpx-channel-demo.*requires weacpx >=?0\.4\.0.*current is 0\.3\.3.*upgrade weacpx/i);
});

test("validatePluginCompatibility rejects when range excludes current core", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, compatibleWeacpxVersions: ">=0.5.0" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/upgrade weacpx/i);
});

test("validatePluginCompatibility rejects malformed compatibility metadata", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, minWeacpxVersion: "not-a-version" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/插件元数据.*minWeacpxVersion|invalid plugin metadata/i);
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, compatibleWeacpxVersions: "<2.0.0" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/插件元数据.*compatibleWeacpxVersions|invalid plugin metadata/i);
});

test("validatePluginCompatibility rejects unsupported apiVersion with upgrade-plugin hint", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 2 },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/apiVersion 2.*supported.*1.*(upgrade|降级|安装|install)/i);
});

test("validatePluginCompatibility rejects missing apiVersion", () => {
  expect(() => validatePluginCompatibility(
    {},
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "0.3.3" },
  )).toThrow(/apiVersion/);
});

test("validatePluginCompatibility skips core-version checks when current version is unknown", () => {
  expect(() => validatePluginCompatibility(
    { apiVersion: 1, minWeacpxVersion: "0.4.0" },
    { packageName: "weacpx-channel-demo", currentWeacpxVersion: "unknown" },
  )).not.toThrow();
});

test("WEACPX_PLUGIN_API_SUPPORTED_VERSIONS includes the current API version", () => {
  expect(WEACPX_PLUGIN_API_SUPPORTED_VERSIONS).toContain(WEACPX_PLUGIN_API_VERSION);
});
