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

  expect(calls[0]).toEqual(["wx:user", "/dg claude 回复我 ok", undefined, "ctx-123", "acc-1", undefined, undefined]);
});

test("treats media-only messages as non-empty and passes media array to the command router", async () => {
  const calls: unknown[][] = [];
  const media = {
    kind: "image" as const,
    filePath: "/tmp/weacpx/inbound/image.bin",
    mimeType: "image/*",
    sizeBytes: 100,
    source: { channelId: "weixin" as const, accountId: "default", chatKey: "wx:user", messageId: "msg_1" },
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
  expect(calls[0]?.[5]).toEqual([{ type: "image", filePath: "/tmp/weacpx/inbound/image.bin", mimeType: "image/*" }]);
});

test("passes non-image media arrays to the command router", async () => {
  const calls: unknown[][] = [];
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "ok" };
    },
  });

  const media = [
    { kind: "file" as const, filePath: "/tmp/report.pdf", mimeType: "application/pdf", fileName: "report.pdf", sizeBytes: 100, source: { channelId: "weixin" as const, accountId: "default", chatKey: "wx:user", messageId: "msg_1" } },
    { kind: "audio" as const, filePath: "/tmp/voice.opus", mimeType: "audio/opus", fileName: "voice.opus", sizeBytes: 50, source: { channelId: "weixin" as const, accountId: "default", chatKey: "wx:user", messageId: "msg_2" } },
  ];

  const result = await agent.chat({
    accountId: "acc-1",
    conversationId: "wx:user",
    text: "",
    media,
  });

  expect(result).toEqual({ text: "ok" });
  expect(calls[0]?.[5]).toEqual([
    { type: "file", filePath: "/tmp/report.pdf", mimeType: "application/pdf", fileName: "report.pdf" },
    { type: "audio", filePath: "/tmp/voice.opus", mimeType: "audio/opus", fileName: "voice.opus" },
  ]);
});

test("passes request metadata to the command router", async () => {
  const calls: unknown[][] = [];
  const agent = new ConsoleAgent({
    handle: async (...args: unknown[]) => {
      calls.push(args);
      return { text: "ok" };
    },
  });

  await agent.chat({
    accountId: "acc-1",
    conversationId: "yuanbao:default:group:g1",
    text: "/status",
    metadata: { channel: "yuanbao", chatType: "group", senderId: "u1", groupId: "g1", isOwner: false },
  });

  expect(calls[0]?.[6]).toEqual({ channel: "yuanbao", chatType: "group", senderId: "u1", groupId: "g1", isOwner: false });
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

test("reports known weacpx command prefixes", () => {
  const agent = new ConsoleAgent({ handle: async () => ({ text: "ok" }) });

  expect(agent.isKnownCommand("/status")).toBe(true);
  expect(agent.isKnownCommand("/ss codex --ws backend")).toBe(true);
  expect(agent.isKnownCommand("/unknown")).toBe(false);
});

test("emits agent.dispatched mark via request.perfSpan before calling router", async () => {
  const events: string[] = [];
  let routerSawPerfSpan = false;
  const spySpan = {
    traceId: "t",
    mark: (event: string) => events.push(event),
    setOutcome: () => {},
  };
  const agent = new ConsoleAgent({
    handle: async (
      _chatKey: string,
      _input: string,
      _reply?: any,
      _replyContextToken?: any,
      _accountId?: any,
      _media?: any,
      _metadata?: any,
      _abortSignal?: any,
      _onToolEvent?: any,
      _onThought?: any,
      perfSpan?: any,
    ) => {
      routerSawPerfSpan = perfSpan === spySpan;
      return { text: "ok" };
    },
  });

  await agent.chat({
    accountId: "a",
    conversationId: "k",
    text: "hello",
    perfSpan: spySpan as any,
  });

  expect(events).toContain("agent.dispatched");
  expect(routerSawPerfSpan).toBe(true);
});

test("passes request.onThought through to the command router", async () => {
  let routerSawOnThought = false;
  const myOnThought = (_chunk: string) => {};
  const agent = new ConsoleAgent({
    handle: async (
      _chatKey: string,
      _input: string,
      _reply?: any,
      _replyContextToken?: any,
      _accountId?: any,
      _media?: any,
      _metadata?: any,
      _abortSignal?: any,
      _onToolEvent?: any,
      onThought?: any,
      _perfSpan?: any,
    ) => {
      routerSawOnThought = onThought === myOnThought;
      return { text: "ok" };
    },
  });

  await agent.chat({
    accountId: "a",
    conversationId: "k",
    text: "hello",
    onThought: myOnThought,
  });

  expect(routerSawOnThought).toBe(true);
});
