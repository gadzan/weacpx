import { beforeAll, expect, test } from "bun:test";

import feishuPlugin from "../../../../packages/channel-feishu/src/index";
import { createFeishuLarkClient } from "../../../../packages/channel-feishu/src/lark-client";
import { createMessageChannel, createMessageChannels, createMessageChannelFromRuntimeConfig, hasChannelFactory } from "../../../../src/channels/create-channel";
import { hasChannelCliProvider } from "../../../../src/channels/cli/registry";
import { registerChannelPlugin } from "../../../../src/channels/plugin";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import type { ChatAgent } from "../../../../src/channels/types";
import type { FeishuMessageEvent } from "../../../../packages/channel-feishu/src/types";
import { RuntimeMediaStore } from "../../../../packages/channel-feishu/src/media-store";

function ensureFeishuPluginRegisteredForTest(): void {
  const factoryRegistered = hasChannelFactory("feishu");
  const cliProviderRegistered = hasChannelCliProvider("feishu");
  if (factoryRegistered !== cliProviderRegistered) {
    throw new Error("inconsistent feishu test registration state");
  }
  if (!factoryRegistered) registerChannelPlugin(feishuPlugin.channels![0]!);
}

beforeAll(() => {
  ensureFeishuPluginRegisteredForTest();
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

const defaultFeishuConfig = {
  appId: "cli_test",
  appSecret: "secret_test",
  domain: "feishu",
  requireMention: true,
  textMessageFormat: "text" as const,
  dedupTtlMs: 43_200_000,
  dedupMaxEntries: 5000,
};

test("createFeishuLarkClient uses injected sdk client", () => {
  const sdk = { im: { message: {} } };
  const client = createFeishuLarkClient({
    appId: "cli_test",
    appSecret: "secret_test",
    domain: "feishu",
    injectedSdkClient: sdk,
  });

  expect(client.sdk).toBe(sdk);
});

test("createMessageChannel('feishu') returns a feishu channel", () => {
  const channel = createMessageChannel("feishu", {
    options: defaultFeishuConfig,
  });

  expect(channel.id).toBe("feishu");
});

test("FeishuChannel reports configured credentials as logged in", () => {
  const channel = new FeishuChannel(defaultFeishuConfig);

  expect(channel.isLoggedIn()).toBe(true);
});

test("FeishuChannel.start routes text websocket events to agent and replies", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const sent: unknown[] = [];
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
      }),
    },
  );
  const requests: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push(request);
      return { text: `echo:${request.text}` };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_in",
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
      create_time: String(Date.now()),
    },
  };
  await handlers["im.message.receive_v1"]!(event);

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accountId: "default",
    conversationId: "feishu:default:oc_chat",
    text: "hello",
    replyContextToken: "om_in",
  });
  expect(sent).toEqual([
    {
      path: { message_id: "om_in" },
      data: { msg_type: "text", content: JSON.stringify({ text: "echo:hello" }) },
    },
  ]);
});

test("FeishuChannel sends coordinator messages to feishu chat keys", async () => {
  const sent: unknown[] = [];
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async () => {},
      }),
    },
  );

  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "feishu:default:oc_chat",
    replyContextToken: "om_in",
    text: "wake up",
  });

  expect(sent).toEqual([
    {
      path: { message_id: "om_in" },
      data: { msg_type: "text", content: JSON.stringify({ text: "wake up" }) },
    },
  ]);
});

test("FeishuChannel routes per-account inbound and outbound across multiple bots", async () => {
  const handlersByAccount: Record<string, Record<string, (data: unknown) => Promise<void> | void>> = {};
  const sentByAccount: Record<string, unknown[]> = { main: [], review: [] };
  const probedAccounts: string[] = [];

  const channel = new FeishuChannel(
    {
      defaultAccount: "main",
      requireMention: false,
      accounts: {
        main: { appId: "main_app", appSecret: "main_secret" },
        review: { appId: "review_app", appSecret: "review_secret" },
      },
    },
    {
      createClient: (account) => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sentByAccount[account.accountId]!.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
          },
        },
        probeBot: async () => {
          probedAccounts.push(account.accountId);
          return { botOpenId: `ou_bot_${account.accountId}` };
        },
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlersByAccount[account.accountId] = input.handlers;
        },
        stop: () => {},
      }),
    },
  );
  const requests: Array<{ accountId: string; conversationId: string; text: string }> = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push({ accountId: request.accountId, conversationId: request.conversationId, text: request.text });
      return { text: `${request.accountId}-echo:${request.text}` };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  expect(probedAccounts.sort()).toEqual(["main", "review"]);

  // inbound on review account
  const reviewEvent: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_user" } },
    message: {
      message_id: "om_review",
      chat_id: "oc_review",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "review please" }),
      create_time: String(Date.now()),
    },
  };
  await handlersByAccount.review!["im.message.receive_v1"]!(reviewEvent);

  expect(requests).toEqual([
    { accountId: "review", conversationId: "feishu:review:oc_review", text: "review please" },
  ]);
  expect(sentByAccount.review).toHaveLength(1);
  expect(sentByAccount.main).toHaveLength(0);

  // outbound coordinator message routed by chatKey accountId
  await channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "feishu:main:oc_main",
    replyContextToken: "om_main",
    text: "hi main",
  });

  expect(sentByAccount.main).toEqual([
    {
      path: { message_id: "om_main" },
      data: { msg_type: "text", content: JSON.stringify({ text: "hi main" }) },
    },
  ]);
});

test("FeishuChannel drops inbound message when access policy denies sender", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const sent: unknown[] = [];
  const channel = new FeishuChannel(
    {
      appId: "cli_test",
      appSecret: "secret_test",
      requireMention: false,
      dmPolicy: "allowlist",
      allowFrom: ["ou_admin"],
    },
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
        stop: () => {},
      }),
    },
  );
  const requests: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push(request);
      return { text: "should not reach" };
    },
  };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_outsider" } },
    message: {
      message_id: "om_blocked",
      chat_id: "oc_dm",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hi" }),
      create_time: String(Date.now()),
    },
  };
  await handlers["im.message.receive_v1"]!(event);

  expect(requests).toHaveLength(0);
  expect(sent).toHaveLength(0);
});

test("FeishuChannel skips disabled accounts and only starts WS for enabled ones", async () => {
  const wsStartedFor: string[] = [];
  const channel = new FeishuChannel(
    {
      defaultAccount: "main",
      requireMention: false,
      accounts: {
        main: { appId: "main_app", appSecret: "main_secret" },
        ops: { appId: "ops_app", appSecret: "ops_secret", enabled: false },
      },
    },
    {
      createClient: (account) => ({
        sdk: { im: { message: { reply: async () => ({}), create: async () => ({}) } } },
        probeBot: async () => ({ botOpenId: `ou_${account.accountId}` }),
        startWS: async () => {
          wsStartedFor.push(account.accountId);
        },
        stop: () => {},
      }),
    },
  );
  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  expect(wsStartedFor).toEqual(["main"]);
  await expect(channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "feishu:ops:oc_chat",
    replyContextToken: "om_x",
    text: "ops",
  })).rejects.toThrow('feishu account "ops" is not started');
});

test("FeishuChannel routes outbound to threaded chatKey on a non-default account", async () => {
  const sentByAccount: Record<string, unknown[]> = { main: [], review: [] };
  const channel = new FeishuChannel(
    {
      defaultAccount: "main",
      requireMention: false,
      accounts: {
        main: { appId: "main_app", appSecret: "main_secret" },
        review: { appId: "review_app", appSecret: "review_secret" },
      },
    },
    {
      createClient: (account) => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sentByAccount[account.accountId]!.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: `ou_${account.accountId}` }),
        startWS: async () => {},
        stop: () => {},
      }),
    },
  );
  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "feishu:review:oc_review:thread:om_root",
    replyContextToken: "om_root",
    text: "thread reply",
  });

  expect(sentByAccount.review).toEqual([
    {
      path: { message_id: "om_root" },
      data: { msg_type: "text", content: JSON.stringify({ text: "thread reply" }) },
    },
  ]);
  expect(sentByAccount.main).toHaveLength(0);
});

test("FeishuChannel sendRouteText fails fast for unknown account ids", async () => {
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: { im: { message: { reply: async () => ({}), create: async () => ({}) } } },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async () => {},
        stop: () => {},
      }),
    },
  );
  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await expect(channel.sendCoordinatorMessage({
    coordinatorSession: "coord",
    chatKey: "feishu:ghost:oc_chat",
    replyContextToken: "om_x",
    text: "nope",
  })).rejects.toThrow('feishu account "ghost" is not started');
});

test("createMessageChannels creates enabled runtime channels", () => {
  const channels = createMessageChannels([
    { id: "weixin", type: "weixin", enabled: true },
    { id: "feishu", type: "feishu", enabled: true, options: defaultFeishuConfig },
    { id: "disabled", type: "weixin", enabled: false },
  ]);

  expect(channels.map((channel) => channel.id)).toEqual(["weixin", "feishu"]);
});

test("createMessageChannelFromRuntimeConfig rejects mismatched id and type", () => {
  expect(() =>
    createMessageChannelFromRuntimeConfig({ id: "feishu-main", type: "feishu", enabled: true, options: defaultFeishuConfig }),
  ).toThrow('channels.feishu-main.id must equal type "feishu"');
});

test("FeishuChannel downloads inbound image and forwards media to agent", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const sent: unknown[] = [];
  const mediaStore = new RuntimeMediaStore({ rootDir: "/tmp/weacpx-test-media-" + Date.now() });
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async () => {
                throw new Error("create should not be called");
              },
            },
            messageResource: {
              get: async () => Buffer.from("fake-image-data"),
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
      }),
      mediaStore,
    },
  );
  const requests: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push(request);
      return { text: "got it" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_img",
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "image",
      content: JSON.stringify({ image_key: "img_v2_test" }),
      create_time: String(Date.now()),
    },
  };
  await handlers["im.message.receive_v1"]!(event);

  expect(requests).toHaveLength(1);
  const request = requests[0] as { text: string; media?: Array<{ kind: string }> };
  expect(request.text).toContain("img_v2_test");
  expect(request.media).toBeDefined();
  expect(request.media!.length).toBe(1);
  expect(request.media![0].kind).toBe("image");
});

test("FeishuChannel rejects outbound remote media URLs before sending", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const sentMedia: unknown[] = [];
  const errorLogs: string[] = [];
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_reply", chat_id: "oc_chat" } }),
              create: async () => ({ data: { message_id: "om_create", chat_id: "oc_chat" } }),
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
      }),
    },
  );
  const agent: ChatAgent = {
    async chat() {
      return {
        text: "done",
        media: [{ kind: "image", filePath: "https://evil.example.com/steal.png" }],
      };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: {
      info: async () => {},
      error: async (_event: string, _msg: string, ctx?: Record<string, unknown>) => {
        errorLogs.push(String(ctx?.filePath ?? ""));
      },
      debug: async () => {},
      cleanup: async () => {},
      flush: async () => {},
    } as never,
  });

  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_txt",
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "send image" }),
      create_time: String(Date.now()),
    },
  };
  await handlers["im.message.receive_v1"]!(event);

  expect(sentMedia).toHaveLength(0);
  expect(errorLogs.some((log) => log.includes("https://evil.example.com/steal.png"))).toBe(true);
});

test("FeishuChannel rejects outbound media pointing to a directory", async () => {
  let handlers: Record<string, (data: unknown) => Promise<void> | void> = {};
  const errorLogs: string[] = [];
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async () => ({ data: { message_id: "om_reply", chat_id: "oc_chat" } }),
              create: async () => ({ data: { message_id: "om_create", chat_id: "oc_chat" } }),
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async (input: { handlers: Record<string, (data: unknown) => Promise<void> | void> }) => {
          handlers = input.handlers;
        },
      }),
    },
  );
  const agent: ChatAgent = {
    async chat() {
      return {
        text: "done",
        media: [{ kind: "file", filePath: process.cwd() }],
      };
    },
  };

  await channel.start({
    agent,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: {
      info: async () => {},
      error: async (_event: string, _msg: string, ctx?: Record<string, unknown>) => {
        errorLogs.push(String(ctx?.filePath ?? ""));
      },
      debug: async () => {},
      cleanup: async () => {},
      flush: async () => {},
    } as never,
  });

  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_txt",
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "send dir" }),
      create_time: String(Date.now()),
    },
  };
  await handlers["im.message.receive_v1"]!(event);

  expect(errorLogs.some((log) => log.includes(process.cwd()))).toBe(true);
});
