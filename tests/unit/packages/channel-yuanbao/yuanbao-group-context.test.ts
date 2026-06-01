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
  minChars: 1,
  maxChars: 1000,
  idleMs: 0,
  historyLimit: 10,
};

function mentionAtBotBody(text: string) {
  return [
    { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
    { msg_type: "TIMTextElem", msg_content: { text } },
  ];
}

function textBody(text: string) {
  return [{ msg_type: "TIMTextElem", msg_content: { text } }];
}

test("unmentioned group messages are buffered into group history (no agent call)", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const requests: { text: string }[] = [];
  const agent: ChatAgent = {
    async chat(req) { requests.push({ text: req.text }); return { text: "ok" }; },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: { from_account: "alice_id", sender_nickname: "Alice", group_code: "g1", msg_id: "m1", msg_time: 1715600000, msg_body: textBody("hello everyone") },
  });
  expect(requests).toHaveLength(0);

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: { from_account: "bob_id", sender_nickname: "Bob", group_code: "g1", msg_id: "m2", msg_time: 1715600060, msg_body: textBody("hi alice") },
  });
  expect(requests).toHaveLength(0);

  // Now Charlie @s the bot: agent should see Alice + Bob's prior messages.
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: { from_account: "charlie_id", sender_nickname: "Charlie", group_code: "g1", msg_id: "m3", msg_time: 1715600120, msg_body: mentionAtBotBody("what did they say?") },
  });

  expect(requests).toHaveLength(1);
  const prompt = requests[0]!.text;
  expect(prompt).toContain("[group history]");
  expect(prompt).toContain("@Alice");
  expect(prompt).toContain("hello everyone");
  expect(prompt).toContain("@Bob");
  expect(prompt).toContain("hi alice");
  expect(prompt.endsWith("what did they say?")).toBe(true);
});

test("group history is cleared after @bot consumes it (next turn has no history)", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "alice_id", group_code: "g1", msg_id: "m1", msg_body: textBody("background") },
  });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "bob_id", group_code: "g1", msg_id: "m2", msg_body: mentionAtBotBody("question 1") },
  });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "bob_id", group_code: "g1", msg_id: "m3", msg_body: mentionAtBotBody("question 2") },
  });

  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain("background");
  expect(prompts[1]).not.toContain("background");
  expect(prompts[1]).not.toContain("[group history]");
});

test("historyLimit=0 disables both recording and history context injection", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel({ ...config, historyLimit: 0 }, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "alice_id", group_code: "g1", msg_id: "m1", msg_body: textBody("aside") },
  });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "bob_id", group_code: "g1", msg_id: "m2", msg_body: mentionAtBotBody("ping") },
  });

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).not.toContain("[group history]");
  expect(prompts[0]).not.toContain("aside");
});

test("replying to bot in a group is treated as implicit @bot (passes requireMention gate)", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "alice_id",
      group_code: "g1",
      msg_id: "m_followup",
      cloud_custom_data: JSON.stringify({ quote: { msg_id: "bot_msg", sender_id: "bot_001", sender_nickname: "Bot", desc: "earlier reply" } }),
      msg_body: textBody("can you expand on that?"),
    },
  });

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("can you expand on that?");
  // Quote of bot's own reply is suppressed; chat-key conversation memory already has it.
  expect(prompts[0]).not.toContain("[Quoted message");
});

test("quoting a user message prepends a quote context block to the prompt", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "alice_id",
      group_code: "g1",
      msg_id: "m_q",
      cloud_custom_data: JSON.stringify({ quote: { msg_id: "x", sender_id: "bob_id", sender_nickname: "Bob", desc: "the deal with X is..." } }),
      msg_body: mentionAtBotBody("@bot please summarize"),
    },
  });

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("> [Quoted message from Bob]:");
  expect(prompts[0]).toContain("the deal with X");
  expect(prompts[0].endsWith("please summarize")).toBe(true);
});

test("group history is scoped per group — different groups don't bleed into each other", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "u", group_code: "g1", msg_id: "m1", msg_body: textBody("g1-secret") },
  });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "u", group_code: "g2", msg_id: "m2", msg_body: mentionAtBotBody("ping") },
  });

  expect(prompts).toHaveLength(1);
  expect(prompts[0]).not.toContain("g1-secret");
});

test("logout clears group history (next start sees empty)", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(config, { createGateway: () => gateway });
  const prompts: string[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push(req.text); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "u", group_code: "g1", msg_id: "m1", msg_body: textBody("stash") },
  });
  channel.logout();

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default", chatType: "group",
    raw: { from_account: "u", group_code: "g1", msg_id: "m2", msg_body: mentionAtBotBody("ping") },
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).not.toContain("stash");
});
