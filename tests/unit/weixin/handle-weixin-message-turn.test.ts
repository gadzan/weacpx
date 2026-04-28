import { expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getWeixinMessageTurnLane,
  handleWeixinMessageTurn,
  resolveMediaTempDir,
} from "../../../src/weixin/messaging/handle-weixin-message-turn";
import type { Agent, ChatResponse } from "../../../src/weixin/agent/interface";
import type { HandleWeixinMessageTurnDeps } from "../../../src/weixin/messaging/handle-weixin-message-turn";
import type { WeixinMessage } from "../../../src/weixin/api/types";
import { MessageItemType } from "../../../src/weixin/api/types";

function makeMessage(text: string, contextToken = "ctx-token-123"): WeixinMessage {
  return {
    from_user_id: "test-user",
    to_user_id: "bot",
    msg_id: "msg-1",
    create_time_ms: Date.now(),
    context_token: contextToken,
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text },
      },
    ],
  };
}

test("handleWeixinMessageTurn passes reply callback to agent.chat", async () => {
  let capturedReply: ((text: string) => Promise<void>) | undefined;
  let capturedReplyContextToken: string | undefined;
  let capturedAccountId: string | undefined;
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      capturedReply = request.reply;
      capturedReplyContextToken = request.replyContextToken;
      capturedAccountId = request.accountId;
      return { text: "done" };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
  };

  await handleWeixinMessageTurn(makeMessage("hello"), deps);
  expect(typeof capturedReply).toBe("function");
  expect(capturedReplyContextToken).toBe("ctx-token-123");
  expect(capturedAccountId).toBe("test-account");
});

test("getWeixinMessageTurnLane classifies /cancel as control", () => {
  expect(getWeixinMessageTurnLane(makeMessage("/cancel"))).toBe("control");
});

test("getWeixinMessageTurnLane classifies /stop as control", () => {
  expect(getWeixinMessageTurnLane(makeMessage("/stop"))).toBe("control");
});

test("getWeixinMessageTurnLane keeps normal text on the normal lane", () => {
  expect(getWeixinMessageTurnLane(makeMessage("hello there"))).toBe("normal");
});

test("getWeixinMessageTurnLane keeps /clear on the normal lane", () => {
  expect(getWeixinMessageTurnLane(makeMessage("/clear"))).toBe("normal");
});

test("resolveMediaTempDir uses injected root when provided", () => {
  expect(resolveMediaTempDir("C:/temp/weacpx-test")).toBe("C:/temp/weacpx-test");
});

test("resolveMediaTempDir falls back to the system temp dir", () => {
  expect(resolveMediaTempDir()).toBe(join(tmpdir(), "weacpx", "media"));
});

test("handleWeixinMessageTurn reports agent failures via errLog", async () => {
  const errors: string[] = [];
  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      throw new Error("agent exploded");
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: (msg) => {
      errors.push(msg);
    },
  };

  await handleWeixinMessageTurn(makeMessage("hello", undefined), deps);
  expect(errors.some((msg) => msg.includes("agent exploded"))).toBe(true);
});

test("handleWeixinMessageTurn does NOT call onInbound (fired by monitor before lane queueing)", async () => {
  // onInbound was moved to monitor.ts so a user reply during a long-running
  // prompt resets quota immediately rather than waiting for the queued turn
  // to drain. The dep field remains on this surface for backward compatibility
  // but is intentionally not invoked here.
  const calls: { kind: string; chat: string }[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async () => ({ messageId: "msg-x" }),
  }));
  mock.module("../../../src/weixin/messaging/slash-commands.ts", () => ({
    handleSlashCommand: async () => ({ handled: true }),
  }));

  const { handleWeixinMessageTurn: handleWithMock } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: "ok" };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    onInbound: (chat) => {
      calls.push({ kind: "onInbound", chat });
    },
  };

  await handleWithMock(makeMessage("/help"), deps);
  expect(calls).toEqual([]);
  mock.restore();
});

test("handleWeixinMessageTurn no longer gates mid-segments (mid quota lives at transport sink)", async () => {
  // After P0-1 fix, sendReplySegment no longer consults a reserveMidSegment dep —
  // mid-tier quota is enforced exclusively at the transport quota-gated reply
  // sink. handle-weixin-message-turn is a thin send shim for any reply() the
  // agent calls.
  const sentTexts: string[] = [];
  const order: string[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `msg-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: handleWithMock } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      await request.reply?.("mid progress");
      return { text: "final" };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    onInbound: (chat) => order.push(`inbound:${chat}`),
    reserveFinal: (chat) => {
      order.push(`final:${chat}`);
      return true;
    },
  };

  await handleWithMock(makeMessage("hello"), deps);

  // Both mid and final make it through — no double-counting on this layer.
  // mid goes via reply(); final comes back as turn.text and is gated by
  // reserveFinal in handle-weixin-message-turn (final quota slot is intended
  // for exactly this case so it always reaches the user).
  expect(sentTexts).toEqual(["mid progress", "final"]);
  // onInbound is fired by monitor.ts now, not handle-weixin-message-turn.
  expect(order).toEqual(["final:test-user"]);
  // reserveMidSegment is no longer part of the dep surface.
  expect("reserveMidSegment" in deps).toBe(false);
  mock.restore();
});

test("v1.3: short final → single reserveFinal + single send (no pagination prefix)", async () => {
  const sentTexts: string[] = [];
  const reserveCalls: string[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `msg-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: h } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: "短答" };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    reserveFinal: (chatKey) => {
      reserveCalls.push(chatKey);
      return true;
    },
  };

  await h(makeMessage("hi"), deps);
  expect(sentTexts).toEqual(["短答"]);
  expect(reserveCalls).toEqual(["test-user"]);
  // No pagination prefix on a single chunk.
  expect(sentTexts[0]!.startsWith("(")).toBe(false);
  mock.restore();
});

test("v1.3: very long final is paginated; each chunk reserves and carries (i/N) prefix", async () => {
  const sentTexts: string[] = [];
  const reserveCalls: string[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `msg-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: h } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  // Build a final around 4000 bytes split across two paragraphs (~2 chunks).
  const para = "字".repeat(600); // 1800 bytes (3 bytes/char * 600)
  const longFinal = `${para}\n\n${para}`;

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: longFinal };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    reserveFinal: (chatKey) => {
      reserveCalls.push(chatKey);
      return true;
    },
  };

  await h(makeMessage("review please"), deps);
  expect(sentTexts.length).toBe(2);
  expect(sentTexts[0]!.startsWith("(1/2) ")).toBe(true);
  expect(sentTexts[1]!.startsWith("(2/2) ")).toBe(true);
  expect(reserveCalls.length).toBe(2);
  mock.restore();
});

test("v1.3: reserveFinal returning false mid-pagination stops sends and logs weixin.final.dropped", async () => {
  const sentTexts: string[] = [];
  const errLogs: string[] = [];
  let reserved = 0;

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `m-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: h } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  // 3 chunks worth of payload.
  const para = "字".repeat(600);
  const longFinal = `${para}\n\n${para}\n\n${para}`;

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: longFinal };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: (m) => errLogs.push(m),
    // Allow first 2 reservations; reject the 3rd.
    reserveFinal: () => {
      reserved += 1;
      return reserved <= 2;
    },
  };

  await h(makeMessage("review please"), deps);
  expect(sentTexts.length).toBe(2);
  expect(errLogs.some((m) => m.includes("weixin.final.dropped"))).toBe(true);
  expect(errLogs.some((m) => m.includes("text_paginated"))).toBe(true);
  mock.restore();
});

test("v1.4: long final (8 segments) sends first 4 with heads-up tail; rest parked in pending", async () => {
  const sentTexts: string[] = [];
  const enqueued: { chatKey: string; chunks: { text: string; seq: number; total: number }[] }[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `m-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: h } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  // 8 paragraphs ~1800 bytes each → 8 raw chunks.
  const para = "字".repeat(600);
  const massiveFinal = Array.from({ length: 8 }, () => para).join("\n\n");

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: massiveFinal };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    reserveFinal: () => true,
    finalRemaining: () => 4,
    enqueuePendingFinal: (chatKey, chunks) => {
      enqueued.push({
        chatKey,
        chunks: chunks.map((c) => ({ text: c.text, seq: c.seq, total: c.total })),
      });
    },
  };

  await h(makeMessage("review"), deps);

  // Wave 1: 4 messages.
  expect(sentTexts.length).toBe(4);
  expect(sentTexts[0]!.startsWith("(1/8) ")).toBe(true);
  expect(sentTexts[3]!.startsWith("(4/8) ")).toBe(true);
  // 4th carries heads-up (still 4 pending).
  expect(sentTexts[3]!).toContain("📄 结果共 8 段，已发 4 段");
  expect(sentTexts[3]!).toContain("/jx");
  // First 3 do NOT carry heads-up.
  expect(sentTexts[0]!).not.toContain("📄");
  expect(sentTexts[2]!).not.toContain("📄");
  // 4 chunks parked in pending with continuous numbering 5..8.
  expect(enqueued.length).toBe(1);
  const parked = enqueued[0]!.chunks;
  expect(parked.length).toBe(4);
  expect(parked.map((c) => c.seq)).toEqual([5, 6, 7, 8]);
  expect(parked.every((c) => c.total === 8)).toBe(true);
  expect(parked[0]!.text.startsWith("(5/8) ")).toBe(true);
  expect(parked[3]!.text.startsWith("(8/8) ")).toBe(true);
  mock.restore();
});

test("v1.4: short final (≤4 segments) sends all without heads-up and without enqueueing", async () => {
  const sentTexts: string[] = [];
  const enqueued: unknown[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `m-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: h } = await import(
    "../../../src/weixin/messaging/handle-weixin-message-turn"
  );

  const para = "字".repeat(600);
  const final3 = `${para}\n\n${para}\n\n${para}`;

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: final3 };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
    reserveFinal: () => true,
    finalRemaining: () => 4,
    enqueuePendingFinal: (...args) => {
      enqueued.push(args);
    },
  };

  await h(makeMessage("review"), deps);
  expect(sentTexts.length).toBe(3);
  expect(sentTexts[0]!.startsWith("(1/3) ")).toBe(true);
  expect(sentTexts[2]!.startsWith("(3/3) ")).toBe(true);
  expect(sentTexts.some((t) => t.includes("📄"))).toBe(false);
  expect(enqueued.length).toBe(0);
  mock.restore();
});

test("handleWeixinMessageTurn forwards a distinct final text through reply when reply was used for progress", async () => {
  // A handler that uses reply() for progress messages and returns a distinct final
  // message (e.g. session creation with ensureSession progress + error renderer)
  // must have that final message delivered. Streaming prompt handlers that want
  // dedup should return text: undefined.
  const sentTexts: string[] = [];

  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `msg-${sentTexts.length}` };
    },
  }));

  const { handleWeixinMessageTurn: handleWeixinMessageTurnWithMock } = await import("../../../src/weixin/messaging/handle-weixin-message-turn");

  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      await request.reply?.("🚀 working…");
      return { text: "✅ final result" };
    },
  };

  const deps: HandleWeixinMessageTurnDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
  };

  await handleWeixinMessageTurnWithMock(makeMessage("hello"), deps);

  expect(sentTexts).toEqual(["🚀 working…", "✅ final result"]);
  mock.restore();
});
