import { expect, mock, test } from "bun:test";

import type { Agent, ChatResponse } from "../../../src/weixin/agent/interface";
import type { WeixinMessage } from "../../../src/weixin/api/types";
import { MessageItemType, TypingStatus } from "../../../src/weixin/api/types";

function makeMessage(text: string): WeixinMessage {
  return {
    from_user_id: "test-user",
    to_user_id: "bot",
    msg_id: "msg-typing",
    create_time_ms: Date.now(),
    context_token: "ctx-token",
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text },
      },
    ],
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function loadHandleWithTypingSpy(statuses: number[], sentTexts: string[] = []) {
  mock.restore();
  mock.module("../../../src/weixin/api/api.ts", () => ({
    buildBaseInfo: () => ({ channel_version: "test" }),
    apiGetFetch: async () => "{}",
    getUpdates: async () => ({ ret: 0, errcode: 0, msgs: [] }),
    getUploadUrl: async () => ({}),
    sendMessage: async () => {},
    getConfig: async () => ({ ret: 0, typing_ticket: "ticket" }),
    sendTyping: async (params: { body: { status?: number } }) => {
      statuses.push(params.body.status ?? TypingStatus.TYPING);
    },
  }));
  mock.module("../../../src/weixin/messaging/send.ts", () => ({
    generateClientId: () => "client-id",
    markdownToPlainText: (text: string) => text,
    sendMessageWeixin: async ({ text }: { text: string }) => {
      sentTexts.push(text);
      return { messageId: `msg-${sentTexts.length}` };
    },
    sendImageMessageWeixin: async () => ({ messageId: "image-msg" }),
    sendVideoMessageWeixin: async () => ({ messageId: "video-msg" }),
    sendFileMessageWeixin: async () => ({ messageId: "file-msg" }),
  }));
  return await import("../../../src/weixin/messaging/handle-weixin-message-turn");
}

test("/clear sends typing while reset is in progress and cancels after completion", async () => {
  const statuses: number[] = [];
  const sentTexts: string[] = [];
  const clearDeferred = createDeferred();
  const { handleWeixinMessageTurn } = await loadHandleWithTypingSpy(statuses, sentTexts);

  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: "should not be called" };
    },
    async clearSession() {
      await clearDeferred.promise;
    },
  };

  const turn = handleWeixinMessageTurn(makeMessage("/clear"), {
    accountId: "acct",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "token",
    typingTicket: "ticket",
    log: () => {},
    errLog: () => {},
  });

  await Bun.sleep(0);
  expect(statuses).toEqual([TypingStatus.TYPING]);

  clearDeferred.resolve();
  await turn;

  expect(statuses).toEqual([TypingStatus.TYPING, TypingStatus.CANCEL]);
  expect(sentTexts).toEqual(["✅ 会话已清除，重新开始对话"]);
  mock.restore();
});

test("quick local slash commands do not send typing", async () => {
  const statuses: number[] = [];
  const sentTexts: string[] = [];
  const { handleWeixinMessageTurn } = await loadHandleWithTypingSpy(statuses, sentTexts);

  await handleWeixinMessageTurn(makeMessage("/echo hi"), {
    accountId: "acct",
    agent: { chat: async () => ({ text: "should not be called" }) },
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "token",
    typingTicket: "ticket",
    log: () => {},
    errLog: () => {},
  });

  expect(statuses).toEqual([]);
  expect(sentTexts).toEqual(["hi", expect.stringContaining("⏱ 通道耗时")]);
  mock.restore();
});

test("normal agent turns send typing before work and cancel in finally", async () => {
  const statuses: number[] = [];
  const { handleWeixinMessageTurn } = await loadHandleWithTypingSpy(statuses);
  const agentDeferred = createDeferred<ChatResponse>();

  const turn = handleWeixinMessageTurn(makeMessage("hello"), {
    accountId: "acct",
    agent: { chat: async () => await agentDeferred.promise },
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "token",
    typingTicket: "ticket",
    log: () => {},
    errLog: () => {},
  });

  await Bun.sleep(0);
  expect(statuses).toEqual([TypingStatus.TYPING]);

  agentDeferred.resolve({ text: "done" });
  await turn;

  expect(statuses).toEqual([TypingStatus.TYPING, TypingStatus.CANCEL]);
  mock.restore();
});
