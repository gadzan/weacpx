import { expect, test } from "bun:test";

import { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import type { ChatAgent } from "../../../../src/channels/types";
import type { YuanbaoGateway, YuanbaoGatewayStartInput } from "../../../../packages/channel-yuanbao/src/types";

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

test("agent.chat receives the channel's abortSignal", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => {},
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const controller = new AbortController();
  let observed: AbortSignal | undefined;
  const agent: ChatAgent = {
    async chat(request) {
      observed = request.abortSignal;
      return { text: "ok" };
    },
  };

  await channel.start({ agent, abortSignal: controller.signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "msg_a",
      msg_body: [
        { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
        { msg_type: "TIMTextElem", msg_content: { text: "hi" } },
      ],
    },
  });

  expect(observed).toBe(controller.signal);
});

test("inbound short-circuits before calling agent.chat when already aborted", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async () => { throw new Error("should not send after abort"); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const controller = new AbortController();
  let chatCalled = 0;
  const agent: ChatAgent = {
    async chat() {
      chatCalled += 1;
      return { text: "should not run" };
    },
  };

  await channel.start({ agent, abortSignal: controller.signal, quota: createNoopQuota(), logger: createNoopLogger() });
  controller.abort();

  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "msg_b",
      msg_body: [
        { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
        { msg_type: "TIMTextElem", msg_content: { text: "hello" } },
      ],
    },
  });

  expect(chatCalled).toBe(0);
});

test("reply callback skips sending after abort fires mid-turn", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  // immediate strategy so each reply() sends right away — lets us assert
  // that "first" goes out but "second" does not after abort fires.
  const channel = new YuanbaoChannel(
    { ...defaultYuanbaoConfig, outboundQueueStrategy: "immediate" },
    { createGateway: () => gateway },
  );
  const controller = new AbortController();
  const agent: ChatAgent = {
    async chat(request) {
      await request.reply!("first");
      controller.abort();
      await request.reply!("second-should-be-suppressed");
      return { text: "final-should-be-suppressed" };
    },
  };

  await channel.start({ agent, abortSignal: controller.signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "user_001",
      group_code: "group_001",
      msg_id: "msg_c",
      msg_body: [
        { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
        { msg_type: "TIMTextElem", msg_content: { text: "hello" } },
      ],
    },
  });

  expect(sent).toEqual(["first"]);
});

test("notifyTaskCompletion / sendCoordinatorMessage skip delivery when aborted", async () => {
  let startInput: YuanbaoGatewayStartInput | null = null;
  const sent: string[] = [];
  const gateway: YuanbaoGateway = {
    start: async (input) => { startInput = input; },
    sendText: async (input) => { sent.push(input.text); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const controller = new AbortController();

  await channel.start({
    agent: { async chat() { return { text: "" }; } },
    abortSignal: controller.signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });
  controller.abort();

  // Avoid unused gateway warning
  expect(startInput).not.toBeNull();

  await channel.notifyTaskCompletion({
    taskId: "t1",
    chatKey: "yuanbao:default:group:group_001",
    resultText: "done",
    summary: "",
    accountId: "default",
    replyContextToken: undefined,
  } as never);
  await channel.notifyTaskProgress(
    {
      taskId: "t1",
      chatKey: "yuanbao:default:group:group_001",
      accountId: "default",
      replyContextToken: undefined,
    } as never,
    "progress",
  );
  await channel.sendCoordinatorMessage({
    coordinatorSession: "s",
    chatKey: "yuanbao:default:group:group_001",
    text: "hey",
  });

  expect(sent).toEqual([]);
});
