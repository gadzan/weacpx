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

test("FeishuChannel abort fast-path aborts the in-flight task and acks", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const replied: Array<{ replyTo: string; text: string }> = [];
  const reactions: Array<{ op: "add" | "del"; messageId: string; reactionId?: string }> = [];

  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: { path: { message_id: string }; data: { content: string } }) => {
                replied.push({ replyTo: payload.path.message_id, text: JSON.parse(payload.data.content).text });
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
              create: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
            },
            messageReaction: {
              create: async (payload: { path: { message_id: string } }) => {
                reactions.push({ op: "add", messageId: payload.path.message_id });
                return { data: { reaction_id: `rx_${payload.path.message_id}` } };
              },
              delete: async (payload: { path: { message_id: string; reaction_id: string } }) => {
                reactions.push({ op: "del", messageId: payload.path.message_id, reactionId: payload.path.reaction_id });
                return {};
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

  let resolveAgentEntered = (): void => {};
  const agentEntered = new Promise<void>((resolve) => {
    resolveAgentEntered = resolve;
  });
  let abortObserved = false;
  const agent: ChatAgent = {
    async chat(request) {
      resolveAgentEntered();
      await new Promise<void>((resolve) => {
        request.abortSignal?.addEventListener("abort", () => {
          abortObserved = true;
          resolve();
        });
      });
      return { text: "should be suppressed" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const longRunning = handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "do the long thing"));
  await agentEntered;
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_stop", "stop"));
  await longRunning;

  expect(abortObserved).toBe(true);
  expect(replied).toEqual([
    { replyTo: "om_stop", text: "已停止当前任务。" },
  ]);
  expect(reactions.some((r) => r.op === "add" && r.messageId === "om_in")).toBe(true);
  expect(reactions.some((r) => r.op === "del" && r.messageId === "om_in")).toBe(true);
});

test("FeishuChannel suppresses queued task when abort arrives before it starts", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const agentCalls: string[] = [];
  const sentTexts: string[] = [];

  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: { path: { message_id: string }; data: { content: string } }) => {
                sentTexts.push(`reply:${payload.path.message_id}:${JSON.parse(payload.data.content).text}`);
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
              create: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
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

  // First message blocks indefinitely (we'll never release it). The second is
  // queued behind it; the third is "stop" which should mark the queued second
  // turn as suppressed before its task body ever runs.
  let releaseFirst = (): void => {};
  let firstStarted = (): void => {};
  const firstStartedPromise = new Promise<void>((r) => {
    firstStarted = r;
  });
  let chatCount = 0;
  const agent: ChatAgent = {
    async chat(request) {
      chatCount += 1;
      agentCalls.push(request.text);
      if (chatCount === 1) {
        firstStarted();
        await new Promise<void>((r) => {
          releaseFirst = r;
        });
        return { text: "first done" };
      }
      // second turn should never reach here — should be suppressed
      return { text: "second leaked through" };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  const turn1 = handlers["im.message.receive_v1"]!(makeTextEvent("om_1", "first task"));
  await firstStartedPromise;
  const turn2 = handlers["im.message.receive_v1"]!(makeTextEvent("om_2", "second task"));
  // give turn2 a chance to enqueue/pre-register active before stop arrives
  await new Promise((r) => setTimeout(r, 5));
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_stop", "stop"));

  releaseFirst();
  await turn1;
  await turn2;

  // First turn completed; second was suppressed (never reached agent).
  expect(agentCalls).toEqual(["first task"]);
  // Stop should have acked.
  expect(sentTexts.some((t) => t.includes("已停止"))).toBe(true);
});

test("FeishuChannel suppresses agent.reply() output after abort", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const replied: Array<{ replyTo: string; text: string }> = [];

  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: { path: { message_id: string }; data: { content: string } }) => {
                replied.push({ replyTo: payload.path.message_id, text: JSON.parse(payload.data.content).text });
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
              create: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
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

  let resolveAgentEntered = (): void => {};
  const agentEntered = new Promise<void>((resolve) => {
    resolveAgentEntered = resolve;
  });

  const agent: ChatAgent = {
    async chat(request) {
      resolveAgentEntered();
      await new Promise<void>((resolve) => {
        request.abortSignal?.addEventListener("abort", () => resolve());
      });
      await request.reply?.("this should not appear");
      return { text: "neither should this" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const longRunning = handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "do the long thing"));
  await agentEntered;
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_stop", "/stop"));
  await longRunning;

  expect(replied.map((r) => r.text)).toEqual(["已停止当前任务。"]);
});
