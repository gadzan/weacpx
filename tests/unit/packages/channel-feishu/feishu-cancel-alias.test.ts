import { expect, test } from "bun:test";

import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

function makeChannel(): FeishuChannel {
  return new FeishuChannel({ appId: "cli_test", appSecret: "secret_test" });
}

test("registerActiveTask records the bound session alias on the task", () => {
  const channel = makeChannel();
  const { active } = (channel as any).registerActiveTask({
    accountId: "a",
    chatId: "c",
    messageId: "m",
    queueKey: "a:c",
    senderOpenId: "ou_1",
    chatType: "p2p",
    boundAlias: "feishu:a:c:codex",
  });
  expect(active.boundAlias).toBe("feishu:a:c:codex");
});

test("registerActiveTask accepts an undefined bound alias (slash commands / no sessions)", () => {
  const channel = makeChannel();
  const { active } = (channel as any).registerActiveTask({
    accountId: "a",
    chatId: "c",
    messageId: "m",
    queueKey: "a:c",
    senderOpenId: "ou_1",
    chatType: "p2p",
    boundAlias: undefined,
  });
  expect(active.boundAlias).toBeUndefined();
});

// Task 8: /cancel <alias> and /stop <alias> must take the CONTROL lane so they
// preempt an in-flight prompt and reach core's handleCancel (which resolves the
// alias and cancels that session's acpx turn) without waiting in a per-session
// queue. The actual transport-level cancellation is owned + tested by core; the
// feishu-side contract is that these commands are dispatched for preemption.
function textEvent(chatId, text, messageId) {
  return {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: messageId,
      chat_id: chatId,
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
      create_time: String(Date.now()),
    },
  };
}

function wireForDispatch(channel, calls) {
  channel.executor = {
    run: (_conv, lane, task, sessionKey) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };
  channel.sessions = { peekCurrentSessionAlias: () => "feishu:acct:c:codex" };
  channel.activeTurns = { markActive() {}, markInactive() {}, isActive: () => false, isActiveAnywhere: () => false };
  channel.agent = { chat: async () => ({ text: "cancelled" }) };
  channel.quota = {
    onInbound() {}, reserveMidSegment: () => true, reserveFinal: () => true,
    finalRemaining: () => 4, hasPendingFinal: () => false, drainPendingFinalUpToBudget: () => [],
    prependPendingFinal() {}, enqueuePendingFinal() {}, clearPendingFinal() {},
  };
  channel.logger = { info: async () => {}, error: async () => {}, debug: async () => {}, cleanup: async () => {}, flush: async () => {} };
  channel.accounts = new Map([["acct", {
    account: { accountId: "acct", replyMode: "static", dmPolicy: "open", groupPolicy: "open", allowFrom: [] },
    client: { sdk: { im: { message: { reply: async () => ({ data: {} }), create: async () => ({ data: {} }) } } }, probeBot: async () => ({}), startWS: async () => {}, stop: () => {} },
    botOpenId: "ou_bot",
  }]]);
  channel.deliverResponse = async () => {};
}

test("/cancel <alias> dispatches on the control lane (preempts running prompt)", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeChannel();
  wireForDispatch(channel as any, calls);
  await (channel as any).handleMessageEvent("acct", textEvent("c", "/cancel backend", "mc1"));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.lane).toBe("control");
});

test("/stop <alias> dispatches on the control lane", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeChannel();
  wireForDispatch(channel as any, calls);
  await (channel as any).handleMessageEvent("acct", textEvent("c", "/stop backend", "mc2"));
  expect(calls[0]!.lane).toBe("control");
});
