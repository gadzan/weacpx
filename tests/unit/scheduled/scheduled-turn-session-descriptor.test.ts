import { expect, test } from "bun:test";

import { executeScheduledTurn } from "../../../src/weixin/messaging/scheduled-turn";
import type { ChatRequestMetadata } from "../../../src/weixin/agent/interface";

test("threads sessionDescriptor + origin alias into agent metadata", async () => {
  let captured: ChatRequestMetadata | undefined;
  const agent = {
    chat: async (req: { metadata?: ChatRequestMetadata }) => {
      captured = req.metadata;
      return { text: "" };
    },
  };

  await executeScheduledTurn(
    {
      chatKey: "weixin:user-1",
      taskId: "k8f2",
      sessionAlias: "origin",
      sessionDescriptor: {
        alias: "later-k8f2",
        agent: "codex",
        workspace: "backend",
        transportSession: "backend:later-k8f2",
      },
      noticeText: "执行定时任务 #k8f2",
      promptText: "检查 CI",
      accountId: "acct",
    },
    {
      agent: agent as never,
      listAccountIds: () => ["acct"],
      resolveAccount: (accountId) => ({ accountId, baseUrl: "http://example", token: "tok" }),
      getContextToken: () => "ctx-token",
      reserveMidSegment: () => true,
      reserveFinal: () => true,
      sendMessage: (async () => {}) as never,
      logger: { info: async () => {}, error: async () => {}, debug: async () => {} } as never,
    },
  );

  expect(captured?.scheduledSessionAlias).toBe("origin");
  expect(captured?.scheduledSessionDescriptor).toEqual({
    alias: "later-k8f2",
    agent: "codex",
    workspace: "backend",
    transportSession: "backend:later-k8f2",
  });
});
