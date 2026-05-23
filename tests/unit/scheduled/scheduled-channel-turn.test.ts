import { beforeAll, expect, test, mock } from "bun:test";

import { MessageChannelRegistry } from "../../../src/channels/channel-registry";
import { registerKnownChannelId } from "../../../src/channels/channel-scope";
import type { MessageChannelRuntime, ScheduledChannelMessageInput } from "../../../src/channels/types";
import { FeishuChannel } from "../../../packages/channel-feishu/src/channel";
import { YuanbaoChannel } from "../../../packages/channel-yuanbao/src/channel";

// Register feishu and yuanbao so we can test multi-channel routing
beforeAll(() => {
  registerKnownChannelId("feishu");
  registerKnownChannelId("yuanbao");
});

function createFakeChannel(
  id: string,
  options?: {
    sendScheduledMessage?: (input: ScheduledChannelMessageInput) => Promise<void>;
  },
): MessageChannelRuntime {
  return {
    id,
    isLoggedIn: () => true,
    login: async () => id,
    logout: () => {},
    start: async () => {},
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
    sendScheduledMessage: options?.sendScheduledMessage ?? (async () => {}),
  };
}

const startInput = {
  agent: {} as never,
  abortSignal: new AbortController().signal,
  quota: {} as never,
  logger: {
    info: async () => {},
    error: async () => {},
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  } as never,
};

test("ChannelRegistry reports scheduled-message support by chatKey", () => {
  const weixin = createFakeChannel("weixin", {
    sendScheduledMessage: async () => {},
  });
  const feishu: MessageChannelRuntime = {
    id: "feishu",
    isLoggedIn: () => true,
    login: async () => "feishu",
    logout: () => {},
    start: async () => {},
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };

  const registry = new MessageChannelRegistry([weixin, feishu]);

  expect(registry.supportsScheduledMessages("weixin:account1:user1")).toBe(true);
  expect(registry.supportsScheduledMessages("feishu:default:oc_chat123")).toBe(false);
  expect(registry.supportsScheduledMessages("unknown:default:conv1")).toBe(false);
});

test("first-party plugin channels advertise scheduled-message support", () => {
  const registry = new MessageChannelRegistry([
    new FeishuChannel({ appId: "app", appSecret: "secret" }),
    new YuanbaoChannel({ appKey: "key", appSecret: "secret", botId: "bot" }),
  ]);

  expect(registry.supportsScheduledMessages("feishu:default:oc_chat123")).toBe(true);
  expect(registry.supportsScheduledMessages("yuanbao:default:group:group_123")).toBe(true);
});

test("ChannelRegistry routes sendScheduledMessage to correct channel by chatKey", async () => {
  const weixinCalls: ScheduledChannelMessageInput[] = [];
  const feishuCalls: ScheduledChannelMessageInput[] = [];

  const weixin = createFakeChannel("weixin", {
    sendScheduledMessage: async (input) => {
      weixinCalls.push(input);
    },
  });
  const feishu = createFakeChannel("feishu", {
    sendScheduledMessage: async (input) => {
      feishuCalls.push(input);
    },
  });

  const registry = new MessageChannelRegistry([weixin, feishu]);
  await registry.startAll(startInput);

  const weixinInput: ScheduledChannelMessageInput = {
    chatKey: "weixin:account1:user1",
    sessionAlias: "weixin:backend-codex",
    noticeText: "⏰ 定时任务触发",
    promptText: "检查 CI 状态",
  };
  await registry.sendScheduledMessage(weixinInput);

  expect(weixinCalls).toHaveLength(1);
  expect(weixinCalls[0]).toEqual(weixinInput);
  expect(feishuCalls).toHaveLength(0);

  const feishuInput: ScheduledChannelMessageInput = {
    chatKey: "feishu:default:oc_chat123",
    sessionAlias: "weixin:backend-codex",
    noticeText: "⏰ 定时任务触发",
    promptText: "检查 CI 状态",
  };
  await registry.sendScheduledMessage(feishuInput);

  expect(feishuCalls).toHaveLength(1);
  expect(feishuCalls[0]).toEqual(feishuInput);
});

test("ChannelRegistry throws clear error when channel does not support sendScheduledMessage", async () => {
  const channel: MessageChannelRuntime = {
    id: "basic",
    isLoggedIn: () => true,
    login: async () => "basic",
    logout: () => {},
    start: async () => {},
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
    // No sendScheduledMessage method
  };

  registerKnownChannelId("basic");
  const registry = new MessageChannelRegistry([channel]);
  await registry.startAll(startInput);

  const input: ScheduledChannelMessageInput = {
    chatKey: "basic:default:conv1",
    sessionAlias: "weixin:backend-codex",
    noticeText: "notice",
    promptText: "prompt",
  };

  await expect(registry.sendScheduledMessage(input)).rejects.toThrow(
    "channel 'basic' does not support scheduled messages",
  );
});

test("ChannelRegistry throws clear error when no channel owns the chatKey", async () => {
  const registry = new MessageChannelRegistry([]);

  const input: ScheduledChannelMessageInput = {
    chatKey: "unknown:default:conv1",
    sessionAlias: "weixin:backend-codex",
    noticeText: "notice",
    promptText: "prompt",
  };

  await expect(registry.sendScheduledMessage(input)).rejects.toThrow(
    "no message channel registered for chatKey: unknown:default:conv1",
  );
});

test("sendScheduledMessage passes all optional fields correctly", async () => {
  const calls: ScheduledChannelMessageInput[] = [];
  const channel = createFakeChannel("weixin", {
    sendScheduledMessage: async (input) => {
      calls.push(input);
    },
  });

  const registry = new MessageChannelRegistry([channel]);
  await registry.startAll(startInput);

  const input: ScheduledChannelMessageInput = {
    chatKey: "weixin:account1:user1",
    sessionAlias: "weixin:backend-codex",
    accountId: "account1",
    replyContextToken: "ctx-token-123",
    noticeText: "⏰ 定时提醒",
    promptText: "请帮我检查一下 CI",
  };

  await registry.sendScheduledMessage(input);

  expect(calls).toHaveLength(1);
  expect(calls[0]!.accountId).toBe("account1");
  expect(calls[0]!.replyContextToken).toBe("ctx-token-123");
});
