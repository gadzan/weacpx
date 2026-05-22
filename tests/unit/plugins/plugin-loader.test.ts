import { expect, test } from "bun:test";
import { join } from "node:path";

import { createMessageChannel } from "../../../src/channels/create-channel";
import { getChannelCliProvider } from "../../../src/channels/cli/registry";
import { loadConfiguredPlugins } from "../../../src/plugins/plugin-loader";

test("loadConfiguredPlugins imports enabled plugins and registers channels", async () => {
  const fixture = join(process.cwd(), "tests/fixtures/channel-demo-plugin/index.mjs");

  const loaded = await loadConfiguredPlugins({
    plugins: [{ name: "demo-fixture-plugin", enabled: true }],
    importPlugin: async () => await import(fixture),
  });

  expect(loaded).toEqual([{ name: "demo-fixture-plugin", channels: ["demo-fixture"] }]);
  expect(createMessageChannel("demo-fixture").id).toBe("demo-fixture");
  expect(getChannelCliProvider("demo-fixture")?.displayName).toBe("Demo Fixture");
});

test("loadConfiguredPlugins skips disabled plugins", async () => {
  const loaded = await loadConfiguredPlugins({
    plugins: [{ name: "disabled-plugin", enabled: false }],
    importPlugin: async () => { throw new Error("should not import disabled plugin"); },
  });

  expect(loaded).toEqual([]);
});

test("loadConfiguredPlugins wraps import errors with package name", async () => {
  await expect(loadConfiguredPlugins({
    plugins: [{ name: "missing-plugin", enabled: true }],
    importPlugin: async () => { throw new Error("Cannot find package"); },
  })).rejects.toThrow("failed to load plugin missing-plugin: Cannot find package");
});

test("loadConfiguredPlugins skips a failing plugin and continues when onPluginError is provided", async () => {
  const errors: { name: string; message: string }[] = [];

  const loaded = await loadConfiguredPlugins({
    plugins: [
      { name: "broken-plugin", enabled: true },
      { name: "ok-plugin", enabled: true },
    ],
    currentWeacpxVersion: "0.3.3",
    importPlugin: async (name) => {
      if (name === "broken-plugin") throw new Error("boom");
      return { default: { apiVersion: 1, name: "ok-plugin", channels: [] } };
    },
    onPluginError: ({ name, error }) => {
      errors.push({ name, message: error instanceof Error ? error.message : String(error) });
    },
  });

  expect(loaded).toEqual([{ name: "ok-plugin", channels: [] }]);
  expect(errors).toEqual([
    { name: "broken-plugin", message: "failed to load plugin broken-plugin: boom" },
  ]);
});

test("loadConfiguredPlugins still throws on plugin failure when no onPluginError is provided", async () => {
  await expect(loadConfiguredPlugins({
    plugins: [{ name: "broken-plugin", enabled: true }],
    importPlugin: async () => { throw new Error("boom"); },
  })).rejects.toThrow("failed to load plugin broken-plugin: boom");
});

test("loadConfiguredPlugins surfaces upgrade-weacpx hint when plugin requires newer core", async () => {
  await expect(loadConfiguredPlugins({
    plugins: [{ name: "future-plugin", enabled: true }],
    currentWeacpxVersion: "0.3.3",
    importPlugin: async () => ({
      default: {
        apiVersion: 1,
        name: "future-plugin",
        minWeacpxVersion: "99.0.0",
        channels: [],
      },
    }),
  })).rejects.toThrow(/future-plugin.*requires weacpx >=?99\.0\.0.*upgrade weacpx/i);
});

test("loadConfiguredPlugins surfaces unsupported-apiVersion hint when plugin built for newer plugin API", async () => {
  await expect(loadConfiguredPlugins({
    plugins: [{ name: "next-api-plugin", enabled: true }],
    currentWeacpxVersion: "0.3.3",
    importPlugin: async () => ({
      default: {
        apiVersion: 2,
        name: "next-api-plugin",
        channels: [],
      },
    }),
  })).rejects.toThrow(/apiVersion 2.*supported.*1.*install/i);
});
