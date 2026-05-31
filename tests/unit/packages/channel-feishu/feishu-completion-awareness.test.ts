import { expect, test } from "bun:test";

import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

function makeChannel(): FeishuChannel {
  return new FeishuChannel({ appId: "cli_test", appSecret: "secret_test", enabled: false });
}

function createNoopLogger() {
  return {
    info: async () => {},
    error: async () => {},
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  };
}

function createRuntimeStub() {
  return {
    account: { accountId: "acct", replyMode: "static" },
    client: {
      sdk: {
        im: {
          message: {
            reply: async () => ({ data: { message_id: "om_reply", chat_id: "oc_chat" } }),
            create: async () => ({ data: { message_id: "om_created", chat_id: "oc_chat" } }),
          },
        },
      },
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async () => {},
      stop: () => {},
    },
    botOpenId: "ou_bot",
  };
}

function registerTurn(channel: FeishuChannel) {
  return (channel as any).registerActiveTask({
    accountId: "acct",
    chatId: "c",
    messageId: "m",
    queueKey: "acct:c",
    senderOpenId: "ou",
    chatType: "p2p",
    boundAlias: "feishu:acct:c:codex",
  });
}

function runTurnArgs(active: any, abortController: any) {
  return {
    runtime: createRuntimeStub(),
    accountId: "acct",
    chatId: "c",
    chatType: "p2p",
    chatKey: "feishu:acct:c",
    queueKey: "acct:c",
    messageId: "m",
    requestText: "task",
    media: [],
    active,
    abortController,
    boundAlias: "feishu:acct:c:codex",
  };
}

test("a turn that finished while backgrounded records a completion signal and pings", async () => {
  const channel = makeChannel();
  const setCalls: Array<{ ck: string; alias: string; r: any }> = [];
  const inactiveCalls: Array<{ ck: string; alias: string }> = [];
  const sent: string[] = [];

  (channel as any).agent = { chat: async () => ({ text: "done text" }) };
  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "feishu:acct:c:other", // foreground switched away
    setBackgroundResult: async (ck: string, alias: string, r: any) => { setCalls.push({ ck, alias, r }); },
  };
  (channel as any).activeTurns = {
    markActive() {},
    isActive: () => false,
    markInactive: (ck: string, alias: string) => inactiveCalls.push({ ck, alias }),
  };
  (channel as any).logger = createNoopLogger();
  (channel as any).deliverResponse = async () => {};
  (channel as any).sendReplyWithGuard = async ({ text }: { text: string }) => { sent.push(text); };

  const { active, abortController } = registerTurn(channel);
  await (channel as any).runTurn(runTurnArgs(active, abortController));

  expect(setCalls).toHaveLength(1);
  expect(setCalls[0]!.alias).toBe("feishu:acct:c:codex");
  expect(setCalls[0]!.r.status).toBe("done");
  expect(setCalls[0]!.r.text).toBe("");
  expect(inactiveCalls).toEqual([{ ck: "feishu:acct:c", alias: "feishu:acct:c:codex" }]);
  expect(sent.some((t) => t.includes("已完成"))).toBe(true);
});

test("a turn that finished while STILL foreground records nothing and does not ping", async () => {
  const channel = makeChannel();
  const setCalls: unknown[] = [];
  const sent: string[] = [];

  (channel as any).agent = { chat: async () => ({ text: "done" }) };
  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "feishu:acct:c:codex", // still foreground
    setBackgroundResult: async (...a: unknown[]) => { setCalls.push(a); },
  };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).logger = createNoopLogger();
  (channel as any).deliverResponse = async () => {};
  (channel as any).sendReplyWithGuard = async ({ text }: { text: string }) => { sent.push(text); };

  const { active, abortController } = registerTurn(channel);
  await (channel as any).runTurn(runTurnArgs(active, abortController));

  expect(setCalls).toHaveLength(0);
  expect(sent.some((t) => t.includes("已完成"))).toBe(false);
});

test("a backgrounded turn that errored records an error signal and pings failure", async () => {
  const channel = makeChannel();
  const setCalls: Array<{ alias: string; r: any }> = [];
  const sent: string[] = [];

  (channel as any).agent = { chat: async () => { throw new Error("boom"); } };
  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "feishu:acct:c:other",
    setBackgroundResult: async (_ck: string, alias: string, r: any) => { setCalls.push({ alias, r }); },
  };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).logger = createNoopLogger();
  (channel as any).deliverResponse = async () => {};
  (channel as any).sendReplyWithGuard = async ({ text }: { text: string }) => { sent.push(text); };

  const { active, abortController } = registerTurn(channel);
  await expect((channel as any).runTurn(runTurnArgs(active, abortController))).rejects.toThrow("boom");

  expect(setCalls).toHaveLength(1);
  expect(setCalls[0]!.r.status).toBe("error");
  expect(sent.some((t) => t.includes("失败"))).toBe(true);
});
