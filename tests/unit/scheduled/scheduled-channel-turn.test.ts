import { beforeAll, expect, test, mock } from "bun:test";

import { MessageChannelRegistry } from "../../../src/channels/channel-registry";
import { registerKnownChannelId } from "../../../src/channels/channel-scope";
import type { MessageChannelRuntime, ScheduledChannelMessageInput } from "../../../src/channels/types";

// Register feishu so we can test multi-channel routing
beforeAll(() => {
  registerKnownChannelId("feishu");
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
    noticeText: "⏰ 定时任务触发",
    promptText: "检查 CI 状态",
  };
  await registry.sendScheduledMessage(weixinInput);

  expect(weixinCalls).toHaveLength(1);
  expect(weixinCalls[0]).toEqual(weixinInput);
  expect(feishuCalls).toHaveLength(0);

  const feishuInput: ScheduledChannelMessageInput = {
    chatKey: "feishu:default:oc_chat123",
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
