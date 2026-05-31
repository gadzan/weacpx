import { expect, test } from "bun:test";

import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

function makeChannel(): FeishuChannel {
  return new FeishuChannel({ appId: "cli_test", appSecret: "secret_test", enabled: false });
}

test("registerActiveTask records the bound session alias on the task", () => {
  const channel = makeChannel();
  const { active } = (channel as any).registerActiveTask({
    accountId: "a",
    chatId: "c",
    messageId: "m",
    queueKey: "a:c",
    senderOpenId: "ou_1",
    chatType: "p2p",
    boundAlias: "feishu:a:c:codex",
  });
  expect(active.boundAlias).toBe("feishu:a:c:codex");
});

test("registerActiveTask accepts an undefined bound alias (slash commands / no sessions)", () => {
  const channel = makeChannel();
  const { active } = (channel as any).registerActiveTask({
    accountId: "a",
    chatId: "c",
    messageId: "m",
    queueKey: "a:c",
    senderOpenId: "ou_1",
    chatType: "p2p",
    boundAlias: undefined,
  });
  expect(active.boundAlias).toBeUndefined();
});
