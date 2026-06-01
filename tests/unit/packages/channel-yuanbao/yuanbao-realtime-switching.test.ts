import { expect, test } from "bun:test";

import { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import type { ChatAgent } from "../../../../src/channels/types";
import type { YuanbaoGateway, YuanbaoGatewayStartInput } from "../../../../packages/channel-yuanbao/src/types";

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

const config = {
  appKey: "yb_key",
  appSecret: "yb_secret",
  botId: "bot_001",
  requireMention: true,
  outboundQueueStrategy: "immediate" as const,
};

// A direct (1:1) message is always "addressed", so the bot handles it without a
// mention — keeps these tests focused on the dispatch/lane/background path.
function directText(text: string, messageId: string): Parameters<YuanbaoGatewayStartInput["onMessage"]>[0] {
  return {
    accountId: "default",
    chatType: "direct",
    raw: {
      from_account: "user_001",
      msg_id: messageId,
      msg_body: [{ msg_type: "TIMTextElem", msg_content: { text } }],
    },
  };
}

test("a prompt dispatches on the normal lane keyed by the bound (current) session alias", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const agent: ChatAgent = { async chat() { return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  (channel as any).sessions = { peekCurrentSessionAlias: () => "yuanbao:default:user_001:codex" };
  (channel as any).executor = {
    run: (_conv: string, lane: string, task: () => Promise<unknown>, sessionKey?: string) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };

  await startInput!.onMessage(directText("帮我跑个任务", "m1"));

  expect(calls).toHaveLength(1);
  expect(calls[0]!.lane).toBe("normal");
  expect(calls[0]!.sessionKey).toBe("yuanbao:default:user_001:codex");
});

test("a /ss switch command dispatches on the control lane (preempts a running prompt)", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const agent: ChatAgent = { async chat() { return { text: "ok" }; }, isKnownCommand: () => true };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  (channel as any).sessions = { peekCurrentSessionAlias: () => "yuanbao:default:user_001:codex" };
  (channel as any).executor = {
    run: (_conv: string, lane: string, task: () => Promise<unknown>, sessionKey?: string) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };

  await startInput!.onMessage(directText("/ss backend", "m2"));

  expect(calls).toHaveLength(1);
  expect(calls[0]!.lane).toBe("control");
  // Slash commands never bind, so they share the chat-level lane.
  expect(calls[0]!.sessionKey).toBe("__chat__");
});

// Switched-away (background): peek returns the bound session at dispatch, then a
// different session afterwards — simulating a /use that moved the foreground.
function switchedAwaySessions(boundAlias: string, otherAlias: string) {
  let n = 0;
  const setCalls: Array<{ chatKey: string; alias: string; result: any }> = [];
  return {
    setCalls,
    stub: {
      peekCurrentSessionAlias: () => (++n === 1 ? boundAlias : otherAlias),
      setBackgroundResult: async (chatKey: string, alias: string, result: any) => {
        setCalls.push({ chatKey, alias, result });
      },
    },
  };
}

test("a backgrounded turn stores its final text for /use replay and pings completion", async () => {
  const sent: string[] = [];
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const agent: ChatAgent = { async chat() { return { text: "the background answer" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const sessions = switchedAwaySessions("yuanbao:default:user_001:codex", "yuanbao:default:user_001:other");
  (channel as any).sessions = sessions.stub;

  await startInput!.onMessage(directText("帮我跑个任务", "m3"));

  // Final text is stored under the bound alias for switch-back replay.
  expect(sessions.setCalls).toHaveLength(1);
  expect(sessions.setCalls[0]!.alias).toBe("yuanbao:default:user_001:codex");
  expect(sessions.setCalls[0]!.result.status).toBe("done");
  expect(sessions.setCalls[0]!.result.text).toBe("the background answer");
  // The answer must NOT leak into the now-foreground chat — only a short ping.
  expect(sent.some((t) => t.includes("the background answer"))).toBe(false);
  expect(sent.some((t) => t.includes("已完成") && t.includes("/use"))).toBe(true);
});

test("a turn still in the foreground delivers normally and records no background result", async () => {
  const sent: string[] = [];
  const setCalls: unknown[] = [];
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const agent: ChatAgent = { async chat() { return { text: "foreground answer" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "yuanbao:default:user_001:codex", // never switches away
    setBackgroundResult: async (...a: unknown[]) => { setCalls.push(a); },
  };

  await startInput!.onMessage(directText("帮我跑个任务", "m4"));

  expect(setCalls).toHaveLength(0);
  expect(sent.some((t) => t.includes("foreground answer"))).toBe(true);
  expect(sent.some((t) => t.includes("已完成"))).toBe(false);
});

test("a backgrounded turn that errors records an error result and pings failure", async () => {
  const sent: string[] = [];
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const agent: ChatAgent = { async chat() { throw new Error("boom"); } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const sessions = switchedAwaySessions("yuanbao:default:user_001:codex", "yuanbao:default:user_001:other");
  (channel as any).sessions = sessions.stub;

  // A backgrounded error is recorded + pinged, not thrown into the void.
  await startInput!.onMessage(directText("帮我跑个任务", "m5"));

  expect(sessions.setCalls).toHaveLength(1);
  expect(sessions.setCalls[0]!.result.status).toBe("error");
  expect(sessions.setCalls[0]!.result.text).toContain("执行出错");
  expect(sent.some((t) => t.includes("失败"))).toBe(true);
});
