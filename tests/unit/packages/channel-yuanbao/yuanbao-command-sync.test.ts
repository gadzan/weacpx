import { expect, test } from "bun:test";

import { PLUGIN_VERSION, toSyncInformationData } from "../../../../packages/channel-yuanbao/src/command-sync";
import pkg from "../../../../packages/channel-yuanbao/package.json";
import { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import type { YuanbaoGateway, YuanbaoGatewayStartInput } from "../../../../packages/channel-yuanbao/src/types";
import type { ChatAgent } from "../../../../src/channels/types";

const defaultYuanbaoConfig = {
  appKey: "yb_key",
  appSecret: "yb_secret",
  botId: "bot_001",
  requireMention: true,
};

function createNoopQuota() {
  return {
    onInbound() {},
    reserveMidSegment: () => true,
    reserveFinal: () => true,
    finalRemaining: () => 4,
    hasPendingFinal: () => false,
    drainPendingFinalUpToBudget: () => [],
    prependPendingFinal() {},
    enqueuePendingFinal() {},
    clearPendingFinal() {},
  };
}

function createNoopLogger() {
  return {
    info: async () => {},
    error: async () => {},
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  } as never;
}

const stubAgent: ChatAgent = { async chat() { return { text: "" }; } };

test("toSyncInformationData maps hints to commands with syncType=1 and empty pluginCommands", () => {
  const data = toSyncInformationData({
    botVersion: "0.6.0",
    pluginVersion: "0.2.0",
    botCommands: [{ name: "/help", description: "查看命令帮助。" }],
  });
  expect(data.syncType).toBe(1);
  expect(data.botVersion).toBe("0.6.0");
  expect(data.pluginVersion).toBe("0.2.0");
  expect(data.commandData?.botCommands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
  expect(data.commandData?.pluginCommands).toEqual([]);
});

test("PLUGIN_VERSION matches the channel package.json", () => {
  expect(PLUGIN_VERSION).toBe((pkg as { version: string }).version);
});

test("channel.start forwards injected command hints into gateway.commandSync", async () => {
  let captured: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (i) => { captured = i; },
    sendText: async () => ({ messageId: "x" }),
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });

  await channel.start({
    agent: stubAgent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
    commandHints: [{ name: "/help", description: "查看命令帮助。" }],
    coreVersion: "0.6.0",
  });

  expect(captured).not.toBeNull();
  expect(captured!.commandSync?.botVersion).toBe("0.6.0");
  expect(captured!.commandSync?.pluginVersion).toBe(PLUGIN_VERSION);
  expect(captured!.commandSync?.botCommands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
});

test("channel.start omits commandSync when no hints injected", async () => {
  let captured: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (i) => { captured = i; },
    sendText: async () => ({ messageId: "x" }),
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });

  await channel.start({
    agent: stubAgent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  expect(captured!.commandSync).toBeUndefined();
});
