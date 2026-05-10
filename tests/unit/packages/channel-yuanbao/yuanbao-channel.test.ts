import { beforeAll, expect, test } from "bun:test";

import yuanbaoPlugin, { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import { createMessageChannel, hasChannelFactory } from "../../../../src/channels/create-channel";
import { registerChannelPlugin } from "../../../../src/channels/plugin";
import { hasChannelCliProvider } from "../../../../src/channels/cli/registry";
import { buildYuanbaoChatKey, extractYuanbaoContent, parseYuanbaoChatKey } from "../../../../packages/channel-yuanbao/src/inbound";
import type { ChatAgent } from "../../../../src/channels/types";
import type { YuanbaoGateway, YuanbaoGatewayStartInput } from "../../../../packages/channel-yuanbao/src/types";
import { resetYuanbaoChatQueueForTests } from "../../../../packages/channel-yuanbao/src/chat-queue";

function ensureYuanbaoPluginRegisteredForTest(): void {
  const factoryRegistered = hasChannelFactory("yuanbao");
  const cliProviderRegistered = hasChannelCliProvider("yuanbao");
  if (factoryRegistered !== cliProviderRegistered) {
    throw new Error("inconsistent yuanbao test registration state");
  }
  if (!factoryRegistered) registerChannelPlugin(yuanbaoPlugin.channels![0]!);
}

beforeAll(() => {
  ensureYuanbaoPluginRegisteredForTest();
});

function createNoopQuota() {
  return {
    onInbound() {},
    reserveMidSegment: () => true,
    reserveFinal: () => true,
    finalRemaining: () => 4,
    hasPendingFinal: () => false,
    drainPendingFinalUpToBudget: () => [],
    prependPendingFinal() {},
    enqueuePendingFinal() {},
    clearPendingFinal() {},
  };
}

function createNoopLogger() {
  return {
    info: async () => {},
    error: async () => {},
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  } as never;
}

const defaultYuanbaoConfig = {
  appKey: "yb_key",
  appSecret: "yb_secret",
  botId: "bot_001",
  requireMention: true,
};

test("createMessageChannel('yuanbao') returns a yuanbao channel", () => {
  const channel = createMessageChannel("yuanbao", { options: defaultYuanbaoConfig });

  expect(channel.id).toBe("yuanbao");
  expect(channel.constructor.name).toBe("YuanbaoChannel");
});

test("yuanbao chat keys parse and build", () => {
  const chatKey = buildYuanbaoChatKey("default", "group", "group_123");
  expect(chatKey).toBe("yuanbao:default:group:group_123");
  expect(parseYuanbaoChatKey(chatKey)).toEqual({ accountId: "default", chatType: "group", target: "group_123" });
  expect(parseYuanbaoChatKey("feishu:default:oc_chat")).toBeNull();
});

test("extractYuanbaoContent extracts text, mention, and media placeholders", () => {
  const content = extractYuanbaoContent([
    { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
    { msg_type: "TIMTextElem", msg_content: { text: "hello" } },
    { msg_type: "TIMImageElem", msg_content: { image_info_array: [{ type: 1, url: "https://example.com/a.png" }] } },
  ], "bot_001");

  expect(content.isAtBot).toBe(true);
  expect(content.text).toContain("hello");
  expect(content.text).toContain("[image: https://example.com/a.png]");
});

test("YuanbaoChannel.start routes inbound text to agent and replies", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: unknown[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push(request);
      return { text: `echo:${request.text}` };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      callback_command: "Group.CallbackAfterSendMsg",
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "msg_001",
      msg_body: [
        { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
        { msg_type: "TIMTextElem", msg_content: { text: "hello" } },
      ],
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accountId: "default",
    conversationId: "yuanbao:default:group:group_001",
    text: "hello",
    replyContextToken: "msg_001",
    metadata: {
      channel: "yuanbao",
      chatType: "group",
      senderId: "user_001",
      groupId: "group_001",
      isOwner: false,
    },
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    chatType: "group",
    target: "group_001",
    text: "echo:hello",
    replyContextToken: "msg_001",
  });
});

test("YuanbaoChannel keeps slash commands clean after bot mention", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: { isKnownCommand: text => text.trim().startsWith("/status"), async chat(request) { requests.push(request); return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "msg_slash",
      msg_body: [
        { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
        { msg_type: "TIMTextElem", msg_content: { text: "/status" } },
      ],
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ text: "/status" });
});

test("YuanbaoChannel skips unmentioned group messages when requireMention is true", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => { throw new Error("should not send"); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: { isKnownCommand: text => text.trim().startsWith("/status"), async chat(request) { requests.push(request); return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "hello" } }],
    },
  });

  expect(requests).toHaveLength(0);
});

test("YuanbaoChannel lets known slash commands bypass group mention gating", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: { isKnownCommand: text => text.trim().startsWith("/status"), async chat(request) { requests.push(request); return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "cmd_001",
      msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "/status" } }],
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    text: "/status",
    metadata: { channel: "yuanbao", chatType: "group", senderId: "user_001", groupId: "group_001", isOwner: false },
  });
});

test("YuanbaoChannel skips unknown unmentioned slash commands in groups", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: { async chat(request) { requests.push(request); return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "cmd_unknown",
      msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "/unknown" } }],
    },
  });

  expect(requests).toHaveLength(0);
});

test("YuanbaoChannel does not send fallback after streamed reply content", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: Array<{ text?: string }> = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push({ text: input.text }); },
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, requireMention: false }, { createGateway: () => gateway });

  await channel.start({
    agent: {
      async chat(request) {
        await request.reply?.("streamed reply");
        return { text: "" };
      },
    },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "direct",
    raw: { from_account: "user_001", msg_id: "stream_001", msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "hello" } }] },
  });

  expect(sent.map((item) => item.text)).toEqual(["streamed reply"]);
});

test("YuanbaoChannel emits running and finish reply heartbeats", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const heartbeats: unknown[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
    sendReplyHeartbeat: async (input) => { heartbeats.push(input); },
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, requireMention: false }, { createGateway: () => gateway });

  await channel.start({
    agent: { async chat() { return { text: "done" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "hb_001",
      msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "hello" } }],
    },
  });

  expect(heartbeats).toEqual([
    expect.objectContaining({ chatType: "group", target: "group_001", originalSenderAccount: "user_001", heartbeat: 1 }),
    expect.objectContaining({ chatType: "group", target: "group_001", originalSenderAccount: "user_001", heartbeat: 2 }),
  ]);
});

test("YuanbaoChannel sends coordinator messages via gateway", async () => {
  const sent: unknown[] = [];
  const gateway: YuanbaoGateway = {
    start: async () => {},
    sendText: async (input) => { sent.push(input); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });

  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "yuanbao:default:direct:user_001",
    text: "wake up",
    replyContextToken: "msg_001",
  });

  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ chatType: "direct", target: "user_001", text: "wake up", replyContextToken: "msg_001" });
});

test("YuanbaoChannel skips self messages and duplicate inbound messages", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, requireMention: false }, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: { async chat(request) { requests.push(request); return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  const raw = {
    from_account: "user_001",
    group_code: "group_001",
    msg_id: "dup_001",
    msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "hello" } }],
  };
  await startInput!.onMessage({ accountId: "default", chatType: "group", isFromSelf: true, raw });
  await startInput!.onMessage({ accountId: "default", chatType: "group", raw });
  await startInput!.onMessage({ accountId: "default", chatType: "group", raw });

  expect(requests).toHaveLength(1);
});

test("YuanbaoChannel serializes messages in the same chat", async () => {
  resetYuanbaoChatQueueForTests();
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, requireMention: false }, { createGateway: () => gateway });
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await channel.start({
    agent: {
      async chat(request) {
        events.push(`start:${request.text}`);
        if (request.text === "one") await firstBlocked;
        events.push(`end:${request.text}`);
        return { text: "" };
      },
    },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  const first = startInput!.onMessage({
    accountId: "default",
    chatType: "direct",
    raw: { from_account: "user_001", msg_id: "q1", msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "one" } }] },
  });
  const second = startInput!.onMessage({
    accountId: "default",
    chatType: "direct",
    raw: { from_account: "user_001", msg_id: "q2", msg_body: [{ msg_type: "TIMTextElem", msg_content: { text: "two" } }] },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual(["start:one"]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(events).toEqual(["start:one", "end:one", "start:two", "end:two"]);
});

test("YuanbaoChannel applies replyToMode and maxChars when sending coordinator messages", async () => {
  const sent: unknown[] = [];
  const gateway: YuanbaoGateway = {
    start: async () => {},
    sendText: async (input) => { sent.push(input); },
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, maxChars: 5, replyToMode: "first" }, { createGateway: () => gateway });

  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "yuanbao:default:direct:user_001",
    text: "abcdefghij",
    replyContextToken: "msg_001",
  });

  expect(sent).toEqual([
    expect.objectContaining({ text: "abcde", replyContextToken: "msg_001" }),
    expect.objectContaining({ text: "fghij", replyContextToken: undefined }),
  ]);
});

test("YuanbaoChannel supports replyToMode off and all", async () => {
  for (const mode of ["off", "all"] as const) {
    const sent: unknown[] = [];
    const gateway: YuanbaoGateway = {
      start: async () => {},
      sendText: async (input) => { sent.push(input); },
    };
    const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, maxChars: 5, replyToMode: mode }, { createGateway: () => gateway });

    await channel.start({
      agent: { async chat() { return { text: "" }; } },
      abortSignal: new AbortController().signal,
      quota: createNoopQuota(),
      logger: createNoopLogger(),
    });

    await channel.sendCoordinatorMessage({
      coordinatorSession: "coord",
      chatKey: "yuanbao:default:direct:user_001",
      text: "abcdefghij",
      replyContextToken: "msg_001",
    });

    expect((sent[0] as { replyContextToken?: string }).replyContextToken).toBe(mode === "all" ? "msg_001" : undefined);
    expect((sent[1] as { replyContextToken?: string }).replyContextToken).toBe(mode === "all" ? "msg_001" : undefined);
  }
});

test("YuanbaoChannel rejects long outbound text when overflowPolicy is stop", async () => {
  const gateway: YuanbaoGateway = {
    start: async () => {},
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, maxChars: 5, overflowPolicy: "stop" }, { createGateway: () => gateway });

  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await expect(channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "yuanbao:default:direct:user_001",
    text: "abcdefghij",
  })).rejects.toThrow("exceeds channel.options.maxChars");
});
