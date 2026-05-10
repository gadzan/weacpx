import { expect, test } from "bun:test";

import { parseConfig } from "../../../src/config/load-config";

function minimalRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transport: { type: "acpx-bridge" },
    agents: { codex: { driver: "codex" } },
    workspaces: {},
    ...overrides,
  };
}

test("parseConfig defaults plugins to an empty array", () => {
  const config = parseConfig(minimalRaw());
  expect(config.plugins).toEqual([]);
});

test("parseConfig accepts enabled plugin entries", () => {
  const config = parseConfig(minimalRaw({
    plugins: [
      { name: "@scope/weacpx-channel-demo", version: "1.2.3", enabled: true },
      { name: "weacpx-channel-disabled", enabled: false },
    ],
  }));

  expect(config.plugins).toEqual([
    { name: "@scope/weacpx-channel-demo", version: "1.2.3", enabled: true },
    { name: "weacpx-channel-disabled", enabled: false },
  ]);
});

test("parseConfig defaults plugin enabled to true", () => {
  const config = parseConfig(minimalRaw({ plugins: [{ name: "weacpx-channel-demo" }] }));
  expect(config.plugins).toEqual([{ name: "weacpx-channel-demo", enabled: true }]);
});

test("parseConfig rejects invalid plugins shape", () => {
  expect(() => parseConfig(minimalRaw({ plugins: {} }))).toThrow("plugins must be an array");
  expect(() => parseConfig(minimalRaw({ plugins: [{}] }))).toThrow("plugins[0].name must be a non-empty string");
  expect(() => parseConfig(minimalRaw({ plugins: [{ name: "demo", version: 1 }] }))).toThrow("plugins[0].version must be a string");
  expect(() => parseConfig(minimalRaw({ plugins: [{ name: "demo", enabled: "yes" }] }))).toThrow("plugins[0].enabled must be a boolean");
});

test("parseConfig rejects duplicate plugin names", () => {
  expect(() => parseConfig(minimalRaw({
    plugins: [
      { name: "weacpx-channel-demo" },
      { name: "weacpx-channel-demo" },
    ],
  }))).toThrow("plugins names must be unique");
});
