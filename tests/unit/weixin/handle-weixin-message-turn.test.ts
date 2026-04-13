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
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      capturedReply = request.reply;
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

test("handleWeixinMessageTurn treats reply as the only text output channel once it is used", async () => {
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
      await request.reply?.("Hello! What can I help with?");
      return { text: "A different final text that should stay internal" };
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

  expect(sentTexts).toEqual(["Hello! What can I help with?"]);
  mock.restore();
});
