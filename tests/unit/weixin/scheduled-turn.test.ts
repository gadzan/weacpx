import { expect, mock, test } from "bun:test";

import { executeScheduledTurn } from "../../../src/weixin/messaging/scheduled-turn";
import type { Agent } from "../../../src/weixin/agent/interface";

function createLogger() {
  return {
    debug: async () => {},
    info: mock(async () => {}),
    error: mock(async () => {}),
    cleanup: async () => {},
    flush: async () => {},
  } as never;
}

test("executeScheduledTurn delivers notice, intermediate replies, and final response through quota", async () => {
  const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
  const reserveMidSegment = mock(() => true);
  const reserveFinal = mock(() => true);
  const agent: Agent = {
    chat: async (request) => {
      expect(request.accountId).toBe("acct");
      expect(request.conversationId).toBe("weixin:acct:user1");
      expect(request.replyContextToken).toBe("ctx");
      await request.reply?.("progress 1");
      return { text: "done" };
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      accountId: "acct",
      replyContextToken: "ctx-from-input",
      noticeText: "执行定时任务 #k8f2",
      promptText: "检查 CI",
    },
    {
      agent,
      listAccountIds: () => ["acct"],
      resolveAccount: () => ({ accountId: "acct", baseUrl: "https://example.test", token: "token" }),
      getContextToken: () => "ctx",
      reserveMidSegment,
      reserveFinal,
      sendMessage: mock(async ({ to, text, opts }) => {
        sent.push({ to, text, contextToken: opts.contextToken });
        return { messageId: `msg-${sent.length}` };
      }),
      logger: createLogger(),
    },
  );

  expect(sent).toEqual([
    { to: "user1", text: "执行定时任务 #k8f2", contextToken: "ctx" },
    { to: "user1", text: "progress 1", contextToken: "ctx" },
    { to: "user1", text: "done", contextToken: "ctx" },
  ]);
  expect(reserveMidSegment).toHaveBeenCalledTimes(2);
  expect(reserveMidSegment).toHaveBeenNthCalledWith(1, "weixin:acct:user1");
  expect(reserveMidSegment).toHaveBeenNthCalledWith(2, "weixin:acct:user1");
  expect(reserveFinal).toHaveBeenCalledWith("weixin:acct:user1");
});

test("executeScheduledTurn drops intermediate replies when mid quota is exhausted", async () => {
  const sent: string[] = [];
  const reserveMidSegment = mock(() => sent.length === 0);
  const logger = createLogger();
  const agent: Agent = {
    chat: async (request) => {
      await request.reply?.("progress after quota");
      return {};
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      accountId: "acct",
      replyContextToken: "ctx",
      noticeText: "notice",
      promptText: "prompt",
    },
    {
      agent,
      listAccountIds: () => ["acct"],
      resolveAccount: () => ({ accountId: "acct", baseUrl: "https://example.test", token: "token" }),
      getContextToken: () => "ctx",
      reserveMidSegment,
      reserveFinal: mock(() => true),
      sendMessage: mock(async ({ text }) => {
        sent.push(text);
        return { messageId: `msg-${sent.length}` };
      }),
      logger,
    },
  );

  expect(sent).toEqual(["notice"]);
  expect(logger.info).toHaveBeenCalledWith(
    "scheduled.mid_dropped",
    "scheduled turn intermediate response dropped due to quota",
    { chatKey: "weixin:acct:user1", reason: "quota_exhausted" },
  );
});
