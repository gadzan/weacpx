import { expect, mock, test, beforeEach, afterAll } from "bun:test";

import { executeScheduledTurn } from "../../../src/weixin/messaging/scheduled-turn";
import type { Agent } from "../../../src/weixin/agent/interface";
import { setLocale } from "../../../src/i18n";

beforeEach(() => { setLocale("zh"); });
afterAll(() => { setLocale("en"); });

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
      expect(request.metadata?.scheduledSessionAlias).toBe("weixin:backend-codex");
      await request.reply?.("progress 1");
      return { text: "done" };
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      sessionAlias: "weixin:backend-codex",
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
  expect(reserveMidSegment).toHaveBeenCalledTimes(1);
  expect(reserveMidSegment).toHaveBeenNthCalledWith(1, "user1");
  expect(reserveFinal).toHaveBeenCalledWith("user1");
});

test("executeScheduledTurn does not double-reserve quota for delivered reply segments", async () => {
  const sent: string[] = [];
  const reserveMidSegment = mock(() => true);
  const agent: Agent = {
    chat: async (request) => {
      await request.reply?.("progress after transport quota");
      return {};
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      sessionAlias: "weixin:backend-codex",
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
      logger: createLogger(),
    },
  );

  expect(sent).toEqual(["notice", "progress after transport quota"]);
  expect(reserveMidSegment).toHaveBeenCalledTimes(1);
  expect(reserveMidSegment).toHaveBeenCalledWith("user1");
});

test("executeScheduledTurn sends best-effort failure notice after prompt dispatch fails", async () => {
  const sent: string[] = [];
  const agent: Agent = {
    chat: async () => {
      throw new Error("transport down");
    },
  };

  await expect(
    executeScheduledTurn(
      {
        chatKey: "weixin:acct:user1",
        sessionAlias: "weixin:backend-codex",
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
        reserveMidSegment: mock(() => true),
        reserveFinal: mock(() => true),
        sendMessage: mock(async ({ text }) => {
          sent.push(text);
          return { messageId: `msg-${sent.length}` };
        }),
        logger: createLogger(),
      },
    ),
  ).rejects.toThrow("transport down");

  expect(sent).toEqual(["notice", "定时任务执行失败：transport down"]);
});

test("executeScheduledTurn runs the agent and delivers the final reply even when the trigger notice is dropped by mid quota", async () => {
  const sent: string[] = [];
  let agentRan = false;
  const agent: Agent = {
    chat: async () => {
      agentRan = true;
      return { text: "final answer" };
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      sessionAlias: "weixin:backend-codex",
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
      // Mid-segment quota is exhausted, so the trigger notice cannot be sent.
      reserveMidSegment: mock(() => false),
      reserveFinal: mock(() => true),
      sendMessage: mock(async ({ text }) => {
        sent.push(text);
        return { messageId: `msg-${sent.length}` };
      }),
      logger: createLogger(),
    },
  );

  // The notice was dropped, but the scheduled work still ran and its final
  // result reached the user through the (separate) final tier.
  expect(agentRan).toBe(true);
  expect(sent).toEqual(["final answer"]);
});

test("executeScheduledTurn aborts without running the agent when no usable context token exists", async () => {
  const chat = mock(async () => ({ text: "should not run" }));
  const agent: Agent = { chat };

  await expect(
    executeScheduledTurn(
      {
        chatKey: "weixin:acct:user1",
        sessionAlias: "weixin:backend-codex",
        noticeText: "notice",
        promptText: "prompt",
      },
      {
        agent,
        listAccountIds: () => ["acct"],
        resolveAccount: () => ({ accountId: "acct", baseUrl: "https://example.test", token: "token" }),
        // No context token anywhere and no replyContextToken to fall back to —
        // an outbound message (including the agent result) is undeliverable.
        getContextToken: () => undefined,
        reserveMidSegment: mock(() => true),
        reserveFinal: mock(() => true),
        sendMessage: mock(async () => ({ messageId: "msg" })),
        logger: createLogger(),
      },
    ),
  ).rejects.toThrow();

  expect(chat).not.toHaveBeenCalled();
});

test("executeScheduledTurn paginates long final responses and parks remaining chunks", async () => {
  const sent: string[] = [];
  const parked: Array<{ text: string; seq: number; total: number; accountId?: string; contextToken?: string }> = [];
  const agent: Agent = {
    chat: async () => ({ text: "a".repeat(4000) }),
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:acct:user1",
      sessionAlias: "weixin:backend-codex",
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
      reserveMidSegment: mock(() => true),
      reserveFinal: mock(() => true),
      finalRemaining: mock(() => 1),
      enqueuePendingFinal: mock((chatKey, chunks) => {
        expect(chatKey).toBe("user1");
        parked.push(...chunks);
      }),
      sendMessage: mock(async ({ text }) => {
        sent.push(text);
        return { messageId: `msg-${sent.length}` };
      }),
      logger: createLogger(),
    },
  );

  expect(sent[0]).toBe("notice");
  expect(sent[1]).toStartWith("(1/3) ");
  expect(sent[1]).toContain("回复 /jx 续看");
  expect(parked.map((chunk) => chunk.seq)).toEqual([2, 3]);
  expect(parked.every((chunk) => chunk.total === 3)).toBe(true);
  expect(parked.every((chunk) => chunk.accountId === "acct" && chunk.contextToken === "ctx")).toBe(true);
});
