import { expect, test } from "bun:test";

import type { Agent, ChatResponse } from "../../../src/weixin/agent/interface";
import { executeChatTurn } from "../../../src/weixin/messaging/execute-chat-turn";

test("returns final text when the agent never uses reply", async () => {
  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      return { text: "final reply" };
    },
  };

  const segments: string[] = [];
  const result = await executeChatTurn({
    agent,
    request: {
      conversationId: "user-1",
      text: "hello",
    },
    onReplySegment: async (text) => {
      segments.push(text);
      return true;
    },
  });

  expect(segments).toEqual([]);
  expect(result).toEqual({
    text: "final reply",
    media: undefined,
    usedReply: false,
  });
});

test("suppresses final text once a non-empty reply segment has been delivered", async () => {
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      await request.reply?.("streamed reply");
      return { text: "final reply" };
    },
  };

  const segments: string[] = [];
  const result = await executeChatTurn({
    agent,
    request: {
      conversationId: "user-1",
      text: "hello",
    },
    onReplySegment: async (text) => {
      segments.push(text);
      return true;
    },
  });

  expect(segments).toEqual(["streamed reply"]);
  expect(result).toEqual({
    text: undefined,
    media: undefined,
    usedReply: true,
  });
});

test("does not suppress final text when reply callback declines to deliver a segment", async () => {
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      await request.reply?.("   ");
      return { text: "final reply" };
    },
  };

  const result = await executeChatTurn({
    agent,
    request: {
      conversationId: "user-1",
      text: "hello",
    },
    onReplySegment: async () => false,
  });

  expect(result).toEqual({
    text: "final reply",
    media: undefined,
    usedReply: false,
  });
});

test("keeps media delivery even when reply streaming already happened", async () => {
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      await request.reply?.("streamed reply");
      return {
        text: "caption",
        media: {
          type: "image",
          url: "/tmp/out.png",
        },
      };
    },
  };

  const result = await executeChatTurn({
    agent,
    request: {
      conversationId: "user-1",
      text: "hello",
    },
    onReplySegment: async () => true,
  });

  expect(result).toEqual({
    text: undefined,
    media: {
      type: "image",
      url: "/tmp/out.png",
    },
    usedReply: true,
  });
});
