import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";

import feishuPlugin from "../../../../packages/channel-feishu/src/index";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import { resetFeishuChatQueueForTests } from "../../../../packages/channel-feishu/src/chat-queue";
import { hasChannelFactory } from "../../../../src/channels/create-channel";
import { hasChannelCliProvider } from "../../../../src/channels/cli/registry";
import { registerChannelPlugin } from "../../../../src/channels/plugin";
import { setChannelLocale, t } from "../../../../packages/channel-feishu/src/i18n/index";
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

beforeEach(() => {
  setChannelLocale("zh");
});

afterEach(() => {
  setChannelLocale("en");
  resetFeishuChatQueueForTests();
});

afterAll(() => {
  setChannelLocale("en");
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

function makeTextEvent(
  messageId: string,
  text: string,
  overrides: {
    senderOpenId?: string;
    chatType?: "p2p" | "group";
    mentions?: Array<{ id: { open_id: string }; key: string }>;
  } = {},
): FeishuMessageEvent {
  return {
    sender: { sender_id: { open_id: overrides.senderOpenId ?? "ou_sender" } },
    message: {
      message_id: messageId,
      chat_id: "oc_chat",
      chat_type: overrides.chatType ?? "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
      create_time: String(Date.now()),
      ...(overrides.mentions ? { mentions: overrides.mentions } : {}),
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
    { replyTo: "om_stop", text: t().abortAck },
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
  const abortAck = t().abortAck;
  expect(sentTexts.some((s) => s.includes(abortAck))).toBe(true);
});

test("FeishuChannel stop suppresses ALL queued turns when multiple are pending", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const agentCalls: string[] = [];

  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
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

  // First turn blocks; turns 2 and 3 queue up behind it; stop arrives. All
  // three should be suppressed — agent must see only turn 1.
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
      return { text: "leaked" };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  const t1 = handlers["im.message.receive_v1"]!(makeTextEvent("om_1", "first"));
  await firstStartedPromise;
  const t2 = handlers["im.message.receive_v1"]!(makeTextEvent("om_2", "second"));
  const t3 = handlers["im.message.receive_v1"]!(makeTextEvent("om_3", "third"));
  await new Promise((r) => setTimeout(r, 10));
  await handlers["im.message.receive_v1"]!(makeTextEvent("om_stop", "stop"));

  releaseFirst();
  await Promise.all([t1, t2, t3]);

  // Turn 1 ran; turns 2 and 3 were suppressed before reaching the agent.
  expect(agentCalls).toEqual(["first"]);
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

  expect(replied.map((r) => r.text)).toEqual([t().abortAck]);
});

test("stop from a different sender does not abort the owner's task", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
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

  let abortObserved = false;
  let resolveOwnerEntered = (): void => {};
  const ownerEntered = new Promise<void>((r) => {
    resolveOwnerEntered = r;
  });
  const releaseOwner = { resolve: (): void => {} };
  let chatCount = 0;
  const agent: ChatAgent = {
    async chat(request) {
      chatCount += 1;
      if (chatCount === 1) {
        resolveOwnerEntered();
        request.abortSignal?.addEventListener("abort", () => {
          abortObserved = true;
        });
        await new Promise<void>((r) => {
          releaseOwner.resolve = r;
        });
        return { text: "done" };
      }
      // The intruder's "stop" is not authorized → treated as a regular turn,
      // queued behind the owner's. Return immediately so the test can finish.
      return { text: "fall-through reply" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  // Owner is "ou_owner"; outsider sends stop with sender "ou_outsider".
  const owner = handlers["im.message.receive_v1"]!(
    makeTextEvent("om_owner", "do the thing", { senderOpenId: "ou_owner" }),
  );
  await ownerEntered;
  const intruder = handlers["im.message.receive_v1"]!(
    makeTextEvent("om_intruder_stop", "stop", { senderOpenId: "ou_outsider" }),
  );
  // Give any spurious abort a chance to fire.
  await new Promise((r) => setTimeout(r, 20));
  expect(abortObserved).toBe(false);

  releaseOwner.resolve();
  await owner;
  await intruder;
});

test("stop in a group without mentioning the bot does not abort", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const channel = new FeishuChannel(
    { ...defaultFeishuConfig, requireMention: true },
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
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

  let abortObserved = false;
  let resolveOwnerEntered = (): void => {};
  const ownerEntered = new Promise<void>((r) => {
    resolveOwnerEntered = r;
  });
  let releaseOwner = (): void => {};
  const agent: ChatAgent = {
    async chat(request) {
      resolveOwnerEntered();
      request.abortSignal?.addEventListener("abort", () => {
        abortObserved = true;
      });
      await new Promise<void>((r) => {
        releaseOwner = r;
      });
      return { text: "done" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  // Owner @-mentions the bot to start a turn (requireMention=true).
  const mentionedEvent = makeTextEvent("om_owner", "@bot do the thing", {
    senderOpenId: "ou_owner",
    chatType: "group",
    mentions: [{ id: { open_id: "ou_bot" }, key: "@bot" }],
  });
  const owner = handlers["im.message.receive_v1"]!(mentionedEvent);
  await ownerEntered;

  // Same owner sends "stop" but does NOT mention the bot — should NOT abort.
  await handlers["im.message.receive_v1"]!(
    makeTextEvent("om_no_mention_stop", "stop", {
      senderOpenId: "ou_owner",
      chatType: "group",
    }),
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(abortObserved).toBe(false);

  releaseOwner();
  await owner;
});

test("stop from the owner aborts every queued card in the stack", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const abortsObserved: number[] = [];
  const channel = new FeishuChannel(
    { ...defaultFeishuConfig, replyMode: "streaming" as const },
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
              create: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
            },
          },
          cardkit: {
            v1: {
              card: {
                create: async () => ({ data: { card_id: `card_${Math.random()}` } }),
                update: async () => ({}),
              },
              cardElement: {
                content: async () => ({}),
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

  let releaseFirst = (): void => {};
  let firstStarted = (): void => {};
  const firstStartedPromise = new Promise<void>((r) => {
    firstStarted = r;
  });
  let chatCount = 0;
  const agent: ChatAgent = {
    async chat(request) {
      chatCount += 1;
      if (chatCount === 1) {
        firstStarted();
        request.abortSignal?.addEventListener("abort", () => abortsObserved.push(chatCount));
        await new Promise<void>((r) => {
          releaseFirst = r;
        });
        return { text: "first done" };
      }
      request.abortSignal?.addEventListener("abort", () => abortsObserved.push(chatCount));
      // queued tasks never reach here because they're suppressed before body runs.
      return { text: "should not reach" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const t1 = handlers["im.message.receive_v1"]!(
    makeTextEvent("om_1", "first", { senderOpenId: "ou_owner" }),
  );
  await firstStartedPromise;
  const t2 = handlers["im.message.receive_v1"]!(
    makeTextEvent("om_2", "second", { senderOpenId: "ou_owner" }),
  );
  await new Promise((r) => setTimeout(r, 10));
  await handlers["im.message.receive_v1"]!(
    makeTextEvent("om_stop", "stop", { senderOpenId: "ou_owner" }),
  );

  releaseFirst();
  await Promise.all([t1, t2]);

  // The first (in-flight) turn observed an abort; the second never reached
  // agent.chat (queued/suppressed). Either way, the test must pass without
  // hanging — proves abort propagated through the stack.
  expect(abortsObserved).toContain(1);
});

test("abort during card seed terminates the freshly-seeded card and skips agent.chat", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const cardUpdates: Array<{ summaryZh: string | undefined }> = [];
  let releaseSeed = (): void => {};
  let seedStarted = (): void => {};
  const seedStartedPromise = new Promise<void>((r) => {
    seedStarted = r;
  });
  let chatCount = 0;

  const channel = new FeishuChannel(
    { ...defaultFeishuConfig, replyMode: "streaming" as const },
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
              create: async () => ({ data: { message_id: "om_out", chat_id: "oc_chat" } }),
            },
          },
          cardkit: {
            v1: {
              card: {
                // Delay card.create so abort can land mid-seed.
                create: async () => {
                  seedStarted();
                  await new Promise<void>((r) => {
                    releaseSeed = r;
                  });
                  return { data: { card_id: "card_seeded" } };
                },
                update: async (input: { data: { card: { data: string } } }) => {
                  const json = JSON.parse(input.data.card.data) as {
                    config?: { summary?: { i18n_content?: { zh_cn?: string } } };
                  };
                  cardUpdates.push({ summaryZh: json.config?.summary?.i18n_content?.zh_cn });
                  return {};
                },
              },
              cardElement: { content: async () => ({}) },
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
      chatCount += 1;
      return { text: "should not run" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  // Owner sends a turn that will be in the middle of card.create when stop arrives.
  const owner = handlers["im.message.receive_v1"]!(
    makeTextEvent("om_owner", "do the thing", { senderOpenId: "ou_owner" }),
  );
  await seedStartedPromise;
  // Stop from the same owner — abort fast-path fires while cardController is
  // still null (seed not complete). The race fix should: (a) suppress, then
  // (b) once seed resolves, drive the just-created card to aborted, (c)
  // skip agent.chat entirely.
  await handlers["im.message.receive_v1"]!(
    makeTextEvent("om_stop", "stop", { senderOpenId: "ou_owner" }),
  );
  releaseSeed();
  await owner;

  expect(chatCount).toBe(0);
  // At least one update should mark the card as aborted ("已停止").
  expect(cardUpdates.some((u) => u.summaryZh === "已停止")).toBe(true);
});
