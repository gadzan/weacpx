import { expect, test } from "bun:test";

import { PLUGIN_VERSION, syncCommandsOnReady, toSyncInformationData } from "../../../../packages/channel-yuanbao/src/command-sync";
import type { CommandSyncClient } from "../../../../packages/channel-yuanbao/src/command-sync";
import type { WsSyncInformationData } from "../../../../packages/channel-yuanbao/src/access/ws/types";
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

test("toSyncInformationData routes commands into pluginCommands (free-form bucket), not botCommands", () => {
  const data = toSyncInformationData({
    botVersion: "0.6.0",
    pluginVersion: "0.2.0",
    commands: [{ name: "/help", description: "查看命令帮助。" }],
  });
  expect(data.syncType).toBe(1);
  expect(data.botVersion).toBe("0.6.0");
  expect(data.pluginVersion).toBe("0.2.0");
  // botCommands is validated against the platform's framework vocabulary and
  // drops unknown names; custom weacpx commands must go in pluginCommands.
  expect(data.commandData?.botCommands).toEqual([]);
  expect(data.commandData?.pluginCommands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
});

test("PLUGIN_VERSION matches the channel package.json", () => {
  expect(PLUGIN_VERSION).toBe((pkg as { version: string }).version);
});

const SYNC_INPUT = {
  botVersion: "0.6.0",
  pluginVersion: PLUGIN_VERSION,
  commands: [{ name: "/help", description: "查看命令帮助。" }],
};

test("syncCommandsOnReady sends mapped data when hints present", async () => {
  const calls: WsSyncInformationData[] = [];
  const logs: string[] = [];
  const client: CommandSyncClient = {
    syncInformation: async (data) => { calls.push(data); return { code: 0 }; },
  };
  await syncCommandsOnReady(client, SYNC_INPUT, { info: async (e) => { logs.push(e); }, error: async () => {} }, "a1");

  expect(calls).toHaveLength(1);
  expect(calls[0]!.syncType).toBe(1);
  expect(calls[0]!.commandData?.pluginCommands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
  expect(logs).toContain("yuanbao.ws.sync_commands");
});

test("syncCommandsOnReady skips when no client, no commandSync, or empty commands", async () => {
  let called = 0;
  const client: CommandSyncClient = { syncInformation: async () => { called += 1; return { code: 0 }; } };
  const noop = { info: async () => {}, error: async () => {} };

  await syncCommandsOnReady(undefined, SYNC_INPUT, noop, "a1");
  await syncCommandsOnReady(client, undefined, noop, "a1");
  await syncCommandsOnReady(client, { ...SYNC_INPUT, commands: [] }, noop, "a1");

  expect(called).toBe(0);
});

test("syncCommandsOnReady logs error on non-zero code without throwing", async () => {
  const errors: string[] = [];
  const client: CommandSyncClient = { syncInformation: async () => ({ code: 500 }) };
  await syncCommandsOnReady(client, SYNC_INPUT, { info: async () => {}, error: async (e) => { errors.push(e); } }, "a1");
  expect(errors).toContain("yuanbao.ws.sync_commands_rejected");
});

test("syncCommandsOnReady swallows rejection and never throws", async () => {
  const errors: string[] = [];
  const client: CommandSyncClient = { syncInformation: async () => { throw new Error("ws down"); } };
  // Must resolve (not reject); fire-and-forget safety.
  await syncCommandsOnReady(client, SYNC_INPUT, { info: async () => {}, error: async (e) => { errors.push(e); } }, "a1");
  expect(errors).toContain("yuanbao.ws.sync_commands_failed");
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
  expect(captured!.commandSync?.commands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
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
