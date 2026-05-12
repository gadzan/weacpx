import { afterEach, beforeAll, expect, test } from "bun:test";

import feishuPlugin from "../../../../packages/channel-feishu/src/index";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import { resetFeishuChatQueueForTests } from "../../../../packages/channel-feishu/src/chat-queue";
import { hasChannelFactory } from "../../../../src/channels/create-channel";
import { hasChannelCliProvider } from "../../../../src/channels/cli/registry";
import { registerChannelPlugin } from "../../../../src/channels/plugin";
import type { ChatAgent } from "../../../../src/channels/types";
import type { FeishuMessageEvent } from "../../../../packages/channel-feishu/src/types";

function ensureFeishuPluginRegisteredForTest(): void {
  const factoryRegistered = hasChannelFactory("feishu");
  const cliProviderRegistered = hasChannelCliProvider("feishu");
  if (factoryRegistered !== cliProviderRegistered) {
    throw new Error("inconsistent feishu test registration state");
  }
  if (!factoryRegistered) registerChannelPlugin(feishuPlugin.channels![0]!);
}

beforeAll(() => {
  ensureFeishuPluginRegisteredForTest();
});

afterEach(() => {
  resetFeishuChatQueueForTests();
});

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

const defaultFeishuConfig = {
  appId: "cli_test",
  appSecret: "secret_test",
  domain: "feishu",
  requireMention: false,
  textMessageFormat: "text" as const,
  dedupTtlMs: 43_200_000,
  dedupMaxEntries: 5000,
};

function makeTextEvent(messageId: string, text: string): FeishuMessageEvent {
  return {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: messageId,
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
      create_time: String(Date.now()),
    },
  };
}

test("FeishuChannel surfaces permission errors to user with grant URL (one-shot per cooldown)", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const replyCalls: Array<{ replyTo: string; text: string }> = [];
  const createCalls: Array<{ chatId: string; text: string }> = [];
  let throwPermErr = true;

  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: { path: { message_id: string }; data: { content: string } }) => {
                if (throwPermErr) {
                  throwPermErr = false;
                  throw {
                    code: 99991672,
                    msg: "missing scope [im:message] grant: https://open.feishu.cn/app/cli_x/auth?q=im:message",
                  };
                }
                replyCalls.push({ replyTo: payload.path.message_id, text: JSON.parse(payload.data.content).text });
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
              create: async (payload: { data: { receive_id: string; content: string } }) => {
                createCalls.push({ chatId: payload.data.receive_id, text: JSON.parse(payload.data.content).text });
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
        stop: () => {},
      }),
    },
  );

  const agent: ChatAgent = {
    async chat() {
      return { text: "agent reply that will fail to send" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hello"));

  expect(createCalls).toHaveLength(1);
  expect(createCalls[0].chatId).toBe("oc_chat");
  expect(createCalls[0].text).toContain("https://open.feishu.cn/app/cli_x/auth");
  expect(createCalls[0].text).toContain("im:message");
});
