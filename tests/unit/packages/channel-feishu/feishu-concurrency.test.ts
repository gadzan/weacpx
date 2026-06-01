import { expect, test } from "bun:test";

import { createConversationExecutor } from "../../../../src/plugin-api";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import type { FeishuMessageEvent } from "../../../../packages/channel-feishu/src/types";

function makeChannel(): FeishuChannel {
  return new FeishuChannel({ appId: "cli_test", appSecret: "secret_test" });
}

function textEvent(chatId: string, text: string, messageId: string): FeishuMessageEvent {
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
  } as FeishuMessageEvent;
}

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
  };
}

function createRuntimeStub() {
  return {
    account: { accountId: "acct", replyMode: "static", dmPolicy: "open", groupPolicy: "open", allowFrom: [] },
    client: {
      sdk: {
        im: {
          message: {
            reply: async () => ({ data: { message_id: "om_reply", chat_id: "oc_chat" } }),
            create: async () => ({ data: { message_id: "om_created", chat_id: "oc_chat" } }),
          },
        },
      },
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async () => {},
      stop: () => {},
    },
    botOpenId: "ou_bot",
  };
}

// Wire the channel's collaborators so handleMessageEvent reaches dispatch
// without real network. A controlled executor records the (lane, sessionKey)
// the channel computes per inbound.
function wireStubs(
  channel: FeishuChannel,
  calls: Array<{ lane: string; sessionKey: string | undefined }>,
  currentAlias: string | undefined,
): void {
  (channel as any).executor = {
    run: (_conv: string, lane: string, task: () => Promise<unknown>, sessionKey?: string) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };
  (channel as any).sessions = { peekCurrentSessionAlias: () => currentAlias };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).agent = { chat: async () => ({ text: "ok" }) };
  (channel as any).quota = createNoopQuota();
  (channel as any).logger = createNoopLogger();
  (channel as any).accounts = new Map([["acct", createRuntimeStub()]]);
  // Keep runTurn off the network: it constructs a typing indicator + maybe a
  // card; stub deliverResponse and the typing helpers via a noop runTurn-side
  // path by making the agent return immediately and disabling streaming.
  (channel as any).deliverResponse = async () => {};
}

test("a prompt dispatches on the normal lane keyed by the bound (current) session alias", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeChannel();
  wireStubs(channel, calls, "feishu:acct:c:codex");
  await (channel as any).handleMessageEvent("acct", textEvent("c", "帮我跑个任务", "m1"));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.lane).toBe("normal");
  expect(calls[0]!.sessionKey).toBe("feishu:acct:c:codex");
});

test("a /ss switch command dispatches on the control lane (preempts running prompt)", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeChannel();
  wireStubs(channel, calls, "feishu:acct:c:codex");
  await (channel as any).handleMessageEvent("acct", textEvent("c", "/ss backend", "m2"));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.lane).toBe("control");
});

// Prove the REAL executor (the channel's actual concurrency engine) overlaps
// different-session lanes while serializing same-session turns.
test("different session lanes run concurrently; same session serializes", async () => {
  const ex = createConversationExecutor();
  const order: string[] = [];
  let releaseA!: () => void;
  const aGate = new Promise<void>((res) => { releaseA = res; });

  const aDone = ex.run("chat", "normal", async () => {
    order.push("A:start");
    await aGate;
    order.push("A:end");
  }, "sessionA");

  const bDone = ex.run("chat", "normal", async () => {
    order.push("B:start");
    order.push("B:end");
  }, "sessionB");

  await bDone; // B finishes while A is still gated → parallel lanes
  expect(order).toContain("B:end");
  expect(order).not.toContain("A:end");
  releaseA();
  await aDone;
  expect(order).toContain("A:end");
});

test("same session serializes: second task waits for the first", async () => {
  const ex = createConversationExecutor();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((res) => { releaseFirst = res; });

  const first = ex.run("chat", "normal", async () => {
    order.push("1:start");
    await firstGate;
    order.push("1:end");
  }, "sameSession");

  const second = ex.run("chat", "normal", async () => {
    order.push("2:start");
    order.push("2:end");
  }, "sameSession");

  await Promise.resolve();
  expect(order).toEqual(["1:start"]); // second has not started — serialized behind first
  releaseFirst();
  await Promise.all([first, second]);
  expect(order).toEqual(["1:start", "1:end", "2:start", "2:end"]);
});
