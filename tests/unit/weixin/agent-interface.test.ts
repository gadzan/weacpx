import { expect, test } from "bun:test";
import type { ChatRequest } from "../../../src/weixin/agent/interface";

test("ChatRequest accepts optional reply callback", () => {
  const request: ChatRequest = {
    conversationId: "user-1",
    text: "hello",
    reply: async (text: string) => {
      // no-op for test
    },
  };
  expect(request.conversationId).toBe("user-1");
  expect(typeof request.reply).toBe("function");
});

test("ChatRequest works without reply callback (backward compatible)", () => {
  const request: ChatRequest = {
    conversationId: "user-1",
    text: "hello",
  };
  expect(request.reply).toBeUndefined();
});
