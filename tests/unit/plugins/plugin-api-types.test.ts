import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type {
  ChannelCliProvider,
  ChannelFactory,
  ChannelRuntimeConfig,
  MessageChannelRuntime,
  WeacpxPlugin,
} from "../../../src/plugin-api";

test("plugin-api exports the types needed by channel packages", async () => {
  const runtime: Pick<MessageChannelRuntime, "id"> = { id: "demo" };
  const factory: ChannelFactory = () => runtime as MessageChannelRuntime;
  const provider: Pick<ChannelCliProvider, "type"> = { type: "demo" };
  const config: ChannelRuntimeConfig = { id: "demo", type: "demo", enabled: true };
  const plugin: WeacpxPlugin = {
    apiVersion: 1,
    name: "demo-plugin",
    channels: [{ type: provider.type, factory }],
  };

  expect(config.type).toBe("demo");
  expect(plugin.channels?.[0]?.type).toBe("demo");

  const source = await readFile("src/plugin-api.ts", "utf8");
  expect(source).toContain("ChannelRuntimeConfig");
});
