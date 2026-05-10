import { expect, test } from "bun:test";

import { parseYuanbaoChannelConfig } from "../../../../packages/channel-yuanbao/src/config";

test("parseYuanbaoChannelConfig parses token appKey:appSecret and defaults", () => {
  const config = parseYuanbaoChannelConfig({ token: "key_1:secret_1" });

  expect(config.defaultAccount).toBe("default");
  expect(config.accounts).toHaveLength(1);
  expect(config.accounts[0]).toMatchObject({
    accountId: "default",
    appKey: "key_1",
    appSecret: "secret_1",
    token: undefined,
    apiDomain: "bot.yuanbao.tencent.com",
    wsUrl: "wss://bot-wss.yuanbao.tencent.com/wss/connection",
    requireMention: true,
    replyToMode: "first",
    overflowPolicy: "split",
    outboundQueueStrategy: "merge-text",
    minChars: 2800,
    maxChars: 3000,
    idleMs: 5000,
    mediaMaxMb: 20,
    historyLimit: 100,
    disableBlockStreaming: false,
    markdownHintEnabled: true,
  });
});

test("parseYuanbaoChannelConfig merges multi-account options", () => {
  const config = parseYuanbaoChannelConfig({
    appKey: "base_key",
    appSecret: "base_secret",
    requireMention: false,
    defaultAccount: "bot2",
    gatewayModule: "/opt/yuanbao-gateway.js",
    accounts: {
      bot1: { name: "Bot One" },
      bot2: { appKey: "key2", appSecret: "secret2", requireMention: true, botId: "bot_2" },
    },
  });

  expect(config.defaultAccount).toBe("bot2");
  expect(config.gatewayModule).toBe("/opt/yuanbao-gateway.js");
  expect(config.accounts.map((account) => account.accountId)).toEqual(["bot1", "bot2"]);
  expect(config.accounts[0]).toMatchObject({ accountId: "bot1", appKey: "base_key", requireMention: false });
  expect(config.accounts[1]).toMatchObject({ accountId: "bot2", appKey: "key2", appSecret: "secret2", requireMention: true, botId: "bot_2" });
});

test("parseYuanbaoChannelConfig rejects invalid config", () => {
  expect(() => parseYuanbaoChannelConfig({})).toThrow("channel.options.appKey and channel.options.appSecret are required");
  expect(() => parseYuanbaoChannelConfig({ appKey: "key" })).toThrow("channel.options.appKey and channel.options.appSecret are required");
  expect(() => parseYuanbaoChannelConfig({ appKey: "key", appSecret: "secret", maxChars: 0 })).toThrow("channel.options.maxChars must be a positive number");
  expect(() => parseYuanbaoChannelConfig({ appKey: "key", appSecret: "secret", replyToMode: "bad" })).toThrow("channel.options.replyToMode must be one of");
  expect(() => parseYuanbaoChannelConfig({ appKey: "key", appSecret: "secret", gatewayModule: "./gateway.js" })).toThrow("channel.options.gatewayModule must be an absolute path");
  expect(() => parseYuanbaoChannelConfig({ token: "static_token" })).toThrow("botId is required");
});
