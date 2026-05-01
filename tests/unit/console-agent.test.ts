import { expect, test } from "bun:test";

import { ConsoleAgent } from "../../src/console-agent";

test("passes the conversation id and text into the command router", async () => {
  const events: string[] = [];
  const agent = new ConsoleAgent({
    handle: async (conversationId, text) => ({
      text: `${conversationId}:${text}`,
    }),
  }, {
    info: async (event, _message, context) => {
      events.push(`${event}:${context?.chatKey}:${context?.kind}`);
    },
    debug: async () => {},
    error: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  });

  const response = await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "/help",
  });

  expect(response.text).toBe("wx:user:/help");
  expect(events).toEqual(["chat.received:wx:user:command"]);
});

test("passes replyContextToken through to the command router", async () => {
  const calls: unknown[][] = [];
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "ok" };
    },
  }, {
    info: async () => {},
    debug: async () => {},
    error: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  });

  await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "/dg claude 回复我 ok",
    replyContextToken: "ctx-123",
  });

  expect(calls[0]).toEqual(["wx:user", "/dg claude 回复我 ok", undefined, "ctx-123", "acc-1"]);
});

test("treats media-only messages as non-empty and passes media to the command router", async () => {
  const calls: unknown[][] = [];
  const media = {
    type: "image" as const,
    filePath: "/tmp/weacpx/inbound/image.bin",
    mimeType: "image/*",
  };
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "ok" };
    },
  }, {
    info: async () => {},
    debug: async () => {},
    error: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  });

  const response = await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "",
    media,
  });

  expect(response.text).toBe("ok");
  expect(calls[0]).toEqual(["wx:user", "", undefined, undefined, "acc-1", media]);
});

test("returns an explicit unsupported message for non-image media without text", async () => {
  const calls: unknown[][] = [];
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "router reached" };
    },
  });

  const response = await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "",
    media: {
      type: "audio",
      filePath: "/tmp/weacpx/inbound/audio.wav",
      mimeType: "audio/wav",
    },
  });

  expect(response.text).toBe("暂不支持处理该类型消息，请发送文字或图片。");
  expect(calls).toEqual([]);
});

test("returns an explicit unsupported message for non-image media even when text is present", async () => {
  const calls: unknown[][] = [];
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "router reached" };
    },
  });

  const response = await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "请处理附件",
    media: {
      type: "file",
      filePath: "/tmp/weacpx/inbound/doc.pdf",
      mimeType: "application/pdf",
    },
  });

  expect(response.text).toBe("暂不支持处理该类型附件；请发送文字或图片。");
  expect(calls).toEqual([]);
});

test("delegates clearSession to the command router", async () => {
  const calls: string[] = [];
  let resolved = false;
  const agent = new ConsoleAgent(
    {
      handle: async () => ({ text: "ok" }),
      clearSession: async (conversationId) => {
        calls.push(conversationId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        resolved = true;
      },
    },
    {
      info: async () => {},
      debug: async () => {},
      error: async () => {},
      cleanup: async () => {},
      flush: async () => {},
    },
  );

  const pending = agent.clearSession?.("wx:user");

  expect(resolved).toBe(false);
  await pending;
  expect(calls).toEqual(["wx:user"]);
  expect(resolved).toBe(true);
});
