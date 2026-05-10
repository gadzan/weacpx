import { beforeAll, expect, test } from "bun:test";

import plugin, { YuanbaoChannel, yuanbaoCliProvider } from "../../../../packages/channel-yuanbao/src/index";
import { validateWeacpxPlugin } from "../../../../src/plugins/validate-plugin";
import { createMessageChannel, hasChannelFactory } from "../../../../src/channels/create-channel";
import { getChannelCliProvider, hasChannelCliProvider } from "../../../../src/channels/cli/registry";
import { registerChannelPlugin } from "../../../../src/channels/plugin";

function ensureYuanbaoPluginRegisteredForTest(): void {
  const factoryRegistered = hasChannelFactory("yuanbao");
  const cliProviderRegistered = hasChannelCliProvider("yuanbao");
  if (factoryRegistered !== cliProviderRegistered) {
    throw new Error("inconsistent yuanbao test registration state");
  }
  if (!factoryRegistered) registerChannelPlugin(plugin.channels![0]!);
}

beforeAll(() => {
  ensureYuanbaoPluginRegisteredForTest();
});

test("@ganglion/weacpx-channel-yuanbao exports a valid plugin definition", () => {
  const validated = validateWeacpxPlugin(plugin, "@ganglion/weacpx-channel-yuanbao", { currentWeacpxVersion: "0.3.3" });

  expect(validated.name).toBe("@ganglion/weacpx-channel-yuanbao");
  expect(validated.channels?.map((channel) => channel.type)).toEqual(["yuanbao"]);
  expect(validated.channels?.[0]?.cliProvider?.type).toBe("yuanbao");
});

test("@ganglion/weacpx-channel-yuanbao declares D3 compatibility metadata", () => {
  expect(plugin.apiVersion).toBe(1);
  expect(plugin.minWeacpxVersion).toBe("0.3.3");
});

test("yuanbao plugin factory creates the YuanbaoChannel runtime", () => {
  const channel = plugin.channels?.[0]?.factory({ appKey: "key", appSecret: "secret" });

  expect(channel).toBeInstanceOf(YuanbaoChannel);
  expect(channel?.id).toBe("yuanbao");
  expect(yuanbaoCliProvider.type).toBe("yuanbao");
});

test("registering @ganglion/weacpx-channel-yuanbao restores yuanbao runtime and CLI provider", () => {
  expect(plugin.channels?.[0]).toBeDefined();
  expect(createMessageChannel("yuanbao", { options: { appKey: "key", appSecret: "secret" } })).toBeInstanceOf(YuanbaoChannel);
  expect(getChannelCliProvider("yuanbao")?.displayName).toBe("Yuanbao");
});
