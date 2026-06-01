import { expect, test } from "bun:test";

import { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import type { ChatAgent } from "../../../../src/channels/types";
import type {
  YuanbaoGateway,
  YuanbaoGatewayStartInput,
} from "../../../../packages/channel-yuanbao/src/types";
import type {
  OutboundQueueScheduledTimer,
  OutboundQueueScheduler,
} from "../../../../packages/channel-yuanbao/src/outbound-queue";

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

function createManualScheduler(): { schedule: OutboundQueueScheduler; advance: (ms: number) => void } {
  let now = 0;
  const timers = new Map<number, { fireAt: number; handler: () => void }>();
  let nextId = 1;
  const schedule: OutboundQueueScheduler = (handler, ms): OutboundQueueScheduledTimer => {
    const id = nextId++;
    timers.set(id, { fireAt: now + ms, handler });
    return { cancel: () => { timers.delete(id); } };
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (t.fireAt <= now) {
        timers.delete(id);
        t.handler();
      }
    }
  };
  return { schedule, advance };
}

const baseGroupMessage = {
  accountId: "default",
  chatType: "group" as const,
  raw: {
    from_account: "user_001",
    group_code: "group_001",
    msg_id: "msg_p1",
    msg_body: [
      { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
      { msg_type: "TIMTextElem", msg_content: { text: "hello" } },
    ],
  },
};

test("merge-text merges small reply() fragments into one outbound message", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 100, maxChars: 1000, idleMs: 60_000 },
    { createGateway: () => gateway },
  );
  const agent: ChatAgent = {
    async chat(request) {
      await request.reply!("alpha ");
      await request.reply!("beta ");
      await request.reply!("gamma");
      return { text: "" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual(["alpha beta gamma"]);
});

test("merge-text flushes mid-turn once minChars is reached, leaving the rest for end-of-turn flush", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 6, maxChars: 1000, idleMs: 60_000 },
    { createGateway: () => gateway },
  );
  const agent: ChatAgent = {
    async chat(request) {
      await request.reply!("aaa"); // under minChars, buffered
      await request.reply!("bbb"); // 6 chars total → drains
      await request.reply!("ccc"); // under minChars again, buffered
      return { text: "" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual(["aaabbb", "ccc"]);
});

test("idleMs forces a drain when the agent pauses between fragments", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const { schedule, advance } = createManualScheduler();
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 100, maxChars: 1000, idleMs: 1_000 },
    { createGateway: () => gateway, outboundSchedule: schedule },
  );
  const agent: ChatAgent = {
    async chat(request) {
      await request.reply!("first-fragment ");
      advance(1_000); // trigger idle drain
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await request.reply!("second-fragment");
      return { text: "" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual(["first-fragment ", "second-fragment"]);
});

test("disableBlockStreaming buffers everything and sends one final message", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 1, maxChars: 1000, idleMs: 0, disableBlockStreaming: true },
    { createGateway: () => gateway },
  );
  const agent: ChatAgent = {
    async chat(request) {
      await request.reply!("a");
      await request.reply!("b");
      await request.reply!("c");
      return { text: "d" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual(["abcd"]);
});

test("merge-text keeps a code fence intact instead of cutting it across messages", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 1, maxChars: 1000, idleMs: 60_000 },
    { createGateway: () => gateway },
  );
  const agent: ChatAgent = {
    async chat(request) {
      // Open fence at line start in one fragment — must not be sent until closed.
      await request.reply!("preamble\n```ts\nconst x = 1;");
      await request.reply!("\nconst y = 2;\n```\n");
      await request.reply!("postscript");
      return { text: "" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toContain("```ts");
  expect(sent[0]!.trimEnd().endsWith("```")).toBe(true);
  expect(sent[1]).toBe("postscript");
});

test("no reply() and empty response.text falls back to fallbackReply (immediate send)", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "merge-text", minChars: 1, maxChars: 1000, idleMs: 0, fallbackReply: "no idea" },
    { createGateway: () => gateway },
  );
  const agent: ChatAgent = { async chat() { return { text: "" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual(["no idea"]);
});

test("overflowPolicy=stop throws when a single chunk exceeds maxChars", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(
    { appKey: "k", appSecret: "s", botId: "bot_001", outboundQueueStrategy: "immediate", minChars: 1, maxChars: 5, idleMs: 0, overflowPolicy: "stop" },
    { createGateway: () => gateway },
  );
  const errors: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      try { await request.reply!("definitely longer than 5"); } catch (e) { errors.push(e); }
      return { text: "" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage(baseGroupMessage);
  expect(sent).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("maxChars");
});
