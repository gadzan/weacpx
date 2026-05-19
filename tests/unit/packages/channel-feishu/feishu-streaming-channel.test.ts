import { afterEach, beforeAll, expect, test } from "bun:test";

import feishuPlugin from "../../../../packages/channel-feishu/src/index";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import { resetFeishuChatQueueForTests } from "../../../../packages/channel-feishu/src/chat-queue";
import { resetMessageUnavailableCacheForTests } from "../../../../packages/channel-feishu/src/message-unavailable";
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
  resetMessageUnavailableCacheForTests();
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

const streamingConfig = {
  appId: "cli_test",
  appSecret: "secret_test",
  domain: "feishu",
  requireMention: false,
  textMessageFormat: "text" as const,
  dedupTtlMs: 43_200_000,
  dedupMaxEntries: 5000,
  replyMode: "streaming" as const,
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

interface CapturedCalls {
  cardCreate: number;
  messageReply: Array<{ replyTo: string; msgType: string; content: string }>;
  messageCreate: Array<{ receiveIdType: string; receiveId: string; msgType: string; content: string }>;
  cardUpdate: Array<{ cardId: string; sequence: number; cardJson: { config: { streaming_mode: boolean; summary: { content: string } }; body: { elements: Array<{ content: string }> } } }>;
}

function buildSdk(calls: CapturedCalls): unknown {
  let createSeq = 0;
  return {
    cardkit: {
      v1: {
        card: {
          create: async () => {
            createSeq += 1;
            calls.cardCreate += 1;
            return { data: { card_id: `card_${createSeq}` } };
          },
          update: async (input: { path: { card_id: string }; data: { sequence: number; card: { data: string } } }) => {
            calls.cardUpdate.push({
              cardId: input.path.card_id,
              sequence: input.data.sequence,
              cardJson: JSON.parse(input.data.card.data),
            });
            return {};
          },
        },
      },
    },
    im: {
      message: {
        reply: async (payload: { path: { message_id: string }; data: { msg_type: string; content: string } }) => {
          calls.messageReply.push({ replyTo: payload.path.message_id, msgType: payload.data.msg_type, content: payload.data.content });
          return { data: { message_id: "om_card", chat_id: "oc_chat" } };
        },
        create: async (payload: { params: { receive_id_type: string }; data: { receive_id: string; msg_type: string; content: string } }) => {
          calls.messageCreate.push({
            receiveIdType: payload.params.receive_id_type,
            receiveId: payload.data.receive_id,
            msgType: payload.data.msg_type,
            content: payload.data.content,
          });
          return { data: { message_id: "om_card_fresh", chat_id: "oc_chat" } };
        },
      },
    },
  };
}

test("FeishuChannel with replyMode=streaming seeds a card and finalises with complete state", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };

  const channel = new FeishuChannel(
    streamingConfig,
    {
      createClient: () => ({
        sdk: buildSdk(calls),
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
        stop: () => {},
      }),
    },
  );

  const agent: ChatAgent = {
    async chat(request) {
      await request.reply?.("partial 1");
      await request.reply?.("partial 2");
      // In streaming mode the transport returns text:"" because every segment
      // was already pushed via reply(). Returning a tail text simulates the
      // WeChat-overflow path where the transport surfaces a summary plus the
      // dropped final answer — both of which must be appended below the
      // streamed progress, never replace it.
      return { text: "summary tail" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hi"));

  expect(calls.cardCreate).toBe(1);
  expect(calls.messageReply).toHaveLength(1);
  expect(calls.messageReply[0].msgType).toBe("interactive");
  expect(calls.messageCreate).toHaveLength(0);
  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(1);
  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  expect(last.cardJson.config.streaming_mode).toBe(false);
  expect(last.cardJson.config.summary.content).toBe("Done");
  expect(last.cardJson.body.elements[0].content).toBe("partial 1\n\npartial 2\n\nsummary tail");
});

test("FeishuChannel streaming abort fast-path renders aborted card instead of separate reply", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };

  const channel = new FeishuChannel(
    streamingConfig,
    {
      createClient: () => ({
        sdk: buildSdk(calls),
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
      return { text: "should be suppressed" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const longRunning = handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "long task"));
  await agentEntered;
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_stop", "stop"));
  await longRunning;

  // No separate text reply to the abort message — abort is rendered into the card.
  const textReplies = calls.messageReply.filter((c) => c.msgType === "text");
  expect(textReplies).toHaveLength(0);

  const lastUpdate = calls.cardUpdate[calls.cardUpdate.length - 1];
  expect(lastUpdate.cardJson.config.summary.content).toBe("Stopped");
  expect(lastUpdate.cardJson.body.elements[0].content).toBe("已停止当前任务。");
});

test("FeishuChannel with replyMode='auto' uses streaming in p2p and static in groups", async () => {
  const replyModeConfig = { ...streamingConfig, replyMode: "auto" as const };

  // p2p — should seed a card.
  let p2pHandlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const p2pCalls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };
  const p2pChannel = new FeishuChannel(
    replyModeConfig,
    {
      createClient: () => ({
        sdk: buildSdk(p2pCalls),
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          p2pHandlers = input.handlers;
        },
        stop: () => {},
      }),
    },
  );
  await p2pChannel.start({
    agent: { async chat() { return { text: "answer" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  await p2pHandlers["im.message.receive_v1"]!(makeTextEvent("om_p2p", "hi"));
  expect(p2pCalls.cardCreate).toBe(1);

  // Group — should NOT seed a card.
  let groupHandlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const groupCalls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };
  const groupChannel = new FeishuChannel(
    replyModeConfig,
    {
      createClient: () => ({
        sdk: buildSdk(groupCalls),
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          groupHandlers = input.handlers;
        },
        stop: () => {},
      }),
    },
  );
  await groupChannel.start({
    agent: { async chat() { return { text: "answer" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  const groupEvent: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_group",
      chat_id: "oc_chat",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "hi" }),
      create_time: String(Date.now()),
    },
  };
  await groupHandlers["im.message.receive_v1"]!(groupEvent);
  expect(groupCalls.cardCreate).toBe(0);
  // group used the text reply path
  expect(groupCalls.messageReply.length).toBeGreaterThan(0);
  expect(groupCalls.messageReply[0].msgType).toBe("text");
});

test("FeishuChannel falls back to static reply when card.create throws permission error", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };

  const channel = new FeishuChannel(
    streamingConfig,
    {
      createClient: () => ({
        sdk: {
          cardkit: {
            v1: {
              card: {
                create: async () => {
                  throw {
                    code: 99991672,
                    msg: "missing scope [cardkit:card:write] grant: https://open.feishu.cn/app/cli_x/auth?q=cardkit:card:write",
                  };
                },
                update: async () => ({}),
              },
            },
          },
          im: {
            message: {
              reply: async (payload: { path: { message_id: string }; data: { msg_type: string; content: string } }) => {
                calls.messageReply.push({ replyTo: payload.path.message_id, msgType: payload.data.msg_type, content: payload.data.content });
                return { data: { message_id: "om_out", chat_id: "oc_chat" } };
              },
              create: async (payload: { params: { receive_id_type: string }; data: { receive_id: string; msg_type: string; content: string } }) => {
                calls.messageCreate.push({
                  receiveIdType: payload.params.receive_id_type,
                  receiveId: payload.data.receive_id,
                  msgType: payload.data.msg_type,
                  content: payload.data.content,
                });
                return { data: { message_id: "om_out_fresh", chat_id: "oc_chat" } };
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
      return { text: "fallback text reply" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hi"));

  // The fallback path sends the final response as a static text reply.
  const textReply = calls.messageReply.find((c) => c.msgType === "text" && c.replyTo === "om_in");
  expect(textReply).toBeTruthy();
  expect(JSON.parse(textReply!.content).text).toBe("fallback text reply");

  // Permission notification with grant URL also went out (fresh send, no reply).
  const grantNotice = calls.messageCreate.find((c) => c.msgType === "text" && c.content.includes("cardkit:card:write"));
  expect(grantNotice).toBeTruthy();
});

test("FeishuChannel in static mode still folds tool calls into the text reply stream", async () => {
  // Static mode: no card controller, so onToolEvent must NOT be set on the
  // ChatRequest. Otherwise the transport's streaming-prompt parser would
  // route tool_call events into the structured side-channel and drop them
  // (cardController?.recordToolEvent no-ops when controller is null).
  // Instead, the legacy text-segment path must keep firing — tool calls
  // arrive as plain text replies.
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };

  const staticConfig = { ...streamingConfig, replyMode: "static" as const };
  const channel = new FeishuChannel(staticConfig, {
    createClient: () => ({
      sdk: buildSdk(calls),
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
        handlers = input.handlers;
      },
      stop: () => {},
    }),
  });

  let receivedOnToolEvent: unknown = "unset";
  let receivedOnThought: unknown = "unset";
  const agent: ChatAgent = {
    async chat(request) {
      // Capture whether the channel passed onToolEvent through. In static
      // mode the channel must NOT pass it, so the field should be undefined.
      receivedOnToolEvent = request.onToolEvent;
      receivedOnThought = request.onThought;
      await request.reply?.("📖 Read File: foo.ts");
      await request.reply?.("final answer");
      return { text: "" };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hi"));

  // The channel must NOT have set onToolEvent on the agent's chat request
  // when there's no card controller — otherwise tool calls would be silently
  // dropped by the streaming-prompt parser.
  expect(receivedOnToolEvent).toBeUndefined();
  // Similarly, onThought must NOT be set in static mode — there is no card
  // reasoning panel to receive the chunks.
  expect(receivedOnThought).toBeUndefined();
  // No card was seeded in static mode.
  expect(calls.cardCreate).toBe(0);
  // The simulated tool-call line + final answer arrived as text replies.
  const textContents = calls.messageReply.map((r) => {
    try { return (JSON.parse(r.content) as { text?: string }).text ?? ""; } catch { return ""; }
  });
  expect(textContents.some((t) => t.includes("Read File"))).toBe(true);
});

test("FeishuChannel forwards tool events into the streaming card panel", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };
  const channel = new FeishuChannel(streamingConfig, {
    createClient: () => ({
      sdk: buildSdk(calls),
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
        handlers = input.handlers;
      },
      stop: () => {},
    }),
  });

  const agent: ChatAgent = {
    async chat(request) {
      await request.onToolEvent?.({
        toolCallId: "t1",
        toolName: "Read File",
        kind: "read",
        summary: "foo.ts",
        status: "success",
      });
      await request.reply?.("agent done");
      return { text: "" };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hi"));

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const elements = (last.cardJson.body as { elements: Array<{ tag: string; content?: string; element_id?: string }> }).elements;
  expect(elements.find((el) => el.tag === "collapsible_panel")).toBeDefined();
  const body = elements.find((el) => el.element_id === "streaming_content");
  expect(body?.content).toBe("agent done");
});

test("FeishuChannel forwards thought chunks into the streaming card reasoning panel", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const calls: CapturedCalls = { cardCreate: 0, messageReply: [], messageCreate: [], cardUpdate: [] };
  const channel = new FeishuChannel(streamingConfig, {
    createClient: () => ({
      sdk: buildSdk(calls),
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
        handlers = input.handlers;
      },
      stop: () => {},
    }),
  });

  const agent: ChatAgent = {
    async chat(request) {
      await request.onThought?.("the agent is thinking hard");
      await request.reply?.("agent done");
      return { text: "" };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_in", "hi"));

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const elements = (last.cardJson.body as { elements: Array<{ tag: string; content?: string; element_id?: string }> }).elements;
  const panel = elements.find((el) => el.tag === "collapsible_panel");
  expect(panel).toBeDefined();
  const inner = (panel as { elements: Array<{ content?: string }> }).elements?.[0];
  expect(inner?.content).toContain("the agent is thinking hard");
});
