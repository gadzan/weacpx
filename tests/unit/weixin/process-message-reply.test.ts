import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { processOneMessage, resolveMediaTempDir } from "../../../src/weixin/messaging/process-message";
import type { Agent, ChatResponse } from "../../../src/weixin/agent/interface";
import type { ProcessMessageDeps } from "../../../src/weixin/messaging/process-message";
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

test("processOneMessage passes reply callback to agent.chat", async () => {
  let capturedReply: ((text: string) => Promise<void>) | undefined;
  const agent: Agent = {
    async chat(request): Promise<ChatResponse> {
      capturedReply = request.reply;
      return { text: "done" };
    },
  };

  const deps: ProcessMessageDeps = {
    accountId: "test-account",
    agent,
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "test-token",
    log: () => {},
    errLog: () => {},
  };

  await processOneMessage(makeMessage("hello"), deps);
  expect(typeof capturedReply).toBe("function");
});

test("resolveMediaTempDir uses injected root when provided", () => {
  expect(resolveMediaTempDir("C:/temp/weacpx-test")).toBe("C:/temp/weacpx-test");
});

test("resolveMediaTempDir falls back to the system temp dir", () => {
  expect(resolveMediaTempDir()).toBe(join(tmpdir(), "weacpx", "media"));
});

test("processOneMessage reports agent failures via errLog", async () => {
  const errors: string[] = [];
  const agent: Agent = {
    async chat(): Promise<ChatResponse> {
      throw new Error("agent exploded");
    },
  };

  const deps: ProcessMessageDeps = {
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

  await processOneMessage(makeMessage("hello", undefined), deps);
  expect(errors.some((msg) => msg.includes("agent exploded"))).toBe(true);
});
