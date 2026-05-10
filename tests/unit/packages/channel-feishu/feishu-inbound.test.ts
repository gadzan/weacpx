import { expect, test } from "bun:test";

import { buildFeishuConversationId, evaluateFeishuAccessPolicy, parseFeishuText, shouldHandleFeishuMessage } from "../../../../packages/channel-feishu/src/inbound";
import { MessageDedup, isMessageExpired } from "../../../../packages/channel-feishu/src/message-dedup";
import { enqueueFeishuChatTask, resetFeishuChatQueueForTests } from "../../../../packages/channel-feishu/src/chat-queue";
import type { FeishuMessageEvent } from "../../../../packages/channel-feishu/src/types";

function event(overrides: Partial<FeishuMessageEvent["message"]> = {}): FeishuMessageEvent {
  return {
    sender: { sender_id: { open_id: "ou_sender" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_chat",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
      create_time: String(Date.now()),
      ...overrides,
    },
  };
}

test("parseFeishuText extracts JSON text content", () => {
  expect(parseFeishuText(JSON.stringify({ text: "hello" }))).toBe("hello");
});

test("parseFeishuText falls back to raw content", () => {
  expect(parseFeishuText("not json")).toBe("not json");
});

test("buildFeishuConversationId includes thread when present", () => {
  expect(buildFeishuConversationId("default", "oc_chat")).toBe("feishu:default:oc_chat");
  expect(buildFeishuConversationId("default", "oc_chat", "om_root")).toBe("feishu:default:oc_chat:thread:om_root");
});

test("shouldHandleFeishuMessage accepts direct messages", () => {
  const decision = shouldHandleFeishuMessage({ event: event(), botOpenId: "ou_bot", requireMention: true });
  expect(decision.handle).toBe(true);
});

test("shouldHandleFeishuMessage rejects non-text messages when no media and empty text", () => {
  const decision = shouldHandleFeishuMessage({
    event: event({ message_type: "image", content: "" }),
    botOpenId: "ou_bot",
    requireMention: false,
  });
  expect(decision).toEqual({ handle: false, reason: "unsupported_type" });
});

test("shouldHandleFeishuMessage accepts non-text messages when allowMediaOnly is true", () => {
  const decision = shouldHandleFeishuMessage({
    event: event({ message_type: "image", content: JSON.stringify({}) }),
    botOpenId: "ou_bot",
    requireMention: false,
    parsedText: "![image](img_key)",
    allowMediaOnly: true,
  });
  expect(decision).toEqual({ handle: true, text: "![image](img_key)" });
});

test("shouldHandleFeishuMessage uses parsedText when provided", () => {
  const decision = shouldHandleFeishuMessage({
    event: event(),
    botOpenId: "ou_bot",
    requireMention: false,
    parsedText: "custom parsed text",
  });
  expect(decision).toEqual({ handle: true, text: "custom parsed text" });
});

test("shouldHandleFeishuMessage rejects unmentioned group messages by default", () => {
  const decision = shouldHandleFeishuMessage({
    event: event({ chat_type: "group", mentions: [] }),
    botOpenId: "ou_bot",
    requireMention: true,
  });
  expect(decision).toEqual({ handle: false, reason: "no_mention" });
});

test("shouldHandleFeishuMessage accepts mentioned group messages and returns cleaned text", () => {
  const decision = shouldHandleFeishuMessage({
    event: event({
      chat_type: "group",
      content: JSON.stringify({ text: "@Bot hello" }),
      mentions: [{ key: "@Bot", id: { open_id: "ou_bot" }, name: "Bot" }],
    }),
    botOpenId: "ou_bot",
    requireMention: true,
  });
  expect(decision).toEqual({ handle: true, text: "hello" });
});

test("evaluateFeishuAccessPolicy: open dm + open group accept anyone", () => {
  const decision = evaluateFeishuAccessPolicy({
    event: event(),
    account: { dmPolicy: "open", groupPolicy: "open", allowFrom: [] },
  });
  expect(decision).toEqual({ allow: true });
  const decisionGroup = evaluateFeishuAccessPolicy({
    event: event({ chat_type: "group" }),
    account: { dmPolicy: "open", groupPolicy: "open", allowFrom: [] },
  });
  expect(decisionGroup).toEqual({ allow: true });
});

test("evaluateFeishuAccessPolicy: dm disabled blocks DMs but not groups", () => {
  const dm = evaluateFeishuAccessPolicy({
    event: event(),
    account: { dmPolicy: "disabled", groupPolicy: "open", allowFrom: [] },
  });
  expect(dm).toEqual({ allow: false, reason: "dm_disabled" });
  const group = evaluateFeishuAccessPolicy({
    event: event({ chat_type: "group" }),
    account: { dmPolicy: "disabled", groupPolicy: "open", allowFrom: [] },
  });
  expect(group).toEqual({ allow: true });
});

test("evaluateFeishuAccessPolicy: group disabled blocks groups but not DMs", () => {
  const group = evaluateFeishuAccessPolicy({
    event: event({ chat_type: "group" }),
    account: { dmPolicy: "open", groupPolicy: "disabled", allowFrom: [] },
  });
  expect(group).toEqual({ allow: false, reason: "group_disabled" });
});

test("evaluateFeishuAccessPolicy: allowlist accepts matching open_id", () => {
  const decision = evaluateFeishuAccessPolicy({
    event: event(),
    account: { dmPolicy: "allowlist", groupPolicy: "open", allowFrom: ["ou_sender", "ou_other"] },
  });
  expect(decision).toEqual({ allow: true });
});

test("evaluateFeishuAccessPolicy: allowlist rejects non-matching open_id", () => {
  const decision = evaluateFeishuAccessPolicy({
    event: event(),
    account: { dmPolicy: "allowlist", groupPolicy: "open", allowFrom: ["ou_other"] },
  });
  expect(decision).toEqual({ allow: false, reason: "sender_not_allowlisted" });
});

test("evaluateFeishuAccessPolicy: allowlist with wildcard accepts anyone with open_id", () => {
  const decision = evaluateFeishuAccessPolicy({
    event: event(),
    account: { dmPolicy: "allowlist", groupPolicy: "open", allowFrom: ["*"] },
  });
  expect(decision).toEqual({ allow: true });
});

test("evaluateFeishuAccessPolicy: allowlist denies events without sender open_id", () => {
  const e = event();
  e.sender = { sender_id: {} };
  const decision = evaluateFeishuAccessPolicy({
    event: e,
    account: { dmPolicy: "allowlist", groupPolicy: "open", allowFrom: ["*"] },
  });
  expect(decision).toEqual({ allow: false, reason: "missing_sender_id" });
});

test("evaluateFeishuAccessPolicy: group allowlist independent of dm policy", () => {
  const decision = evaluateFeishuAccessPolicy({
    event: event({ chat_type: "group" }),
    account: { dmPolicy: "open", groupPolicy: "allowlist", allowFrom: ["ou_sender"] },
  });
  expect(decision).toEqual({ allow: true });
  const denied = evaluateFeishuAccessPolicy({
    event: event({ chat_type: "group" }),
    account: { dmPolicy: "open", groupPolicy: "allowlist", allowFrom: ["ou_other"] },
  });
  expect(denied).toEqual({ allow: false, reason: "sender_not_allowlisted" });
});

test("MessageDedup records first event and rejects duplicate", () => {
  const dedup = new MessageDedup({ ttlMs: 60_000, maxEntries: 10 });
  try {
    expect(dedup.tryRecord("om_1", "default")).toBe(true);
    expect(dedup.tryRecord("om_1", "default")).toBe(false);
  } finally {
    dedup.dispose();
  }
});

test("isMessageExpired returns true for old create_time", () => {
  expect(isMessageExpired(String(Date.now() - 31 * 60 * 1000), 30 * 60 * 1000)).toBe(true);
});

import { convertFeishuMessageContent } from "../../../../packages/channel-feishu/src/content-converters";

test("converts image message into text and resource descriptor", async () => {
  const result = await convertFeishuMessageContent({
    messageType: "image",
    content: JSON.stringify({ image_key: "img_v2" }),
    messageId: "om_1",
    mentions: [],
    botOpenId: "ou_bot",
    stripBotMentions: true,
  });
  expect(result.text).toBe("![image](img_v2)");
  expect(result.resources).toEqual([{ kind: "image", fileKey: "img_v2" }]);
});

test("converts file, audio, and video descriptors", async () => {
  expect((await convertFeishuMessageContent({ messageType: "file", content: JSON.stringify({ file_key: "f1", file_name: "a.pdf" }), messageId: "om", mentions: [] })).resources)
    .toEqual([{ kind: "file", fileKey: "f1", fileName: "a.pdf" }]);
  expect((await convertFeishuMessageContent({ messageType: "audio", content: JSON.stringify({ file_key: "a1", duration: 1000 }), messageId: "om", mentions: [] })).resources)
    .toEqual([{ kind: "audio", fileKey: "a1" }]);
  expect((await convertFeishuMessageContent({ messageType: "video", content: JSON.stringify({ file_key: "v1" }), messageId: "om", mentions: [] })).resources)
    .toEqual([{ kind: "video", fileKey: "v1" }]);
});

test("converts post text and embedded media", async () => {
  const result = await convertFeishuMessageContent({
    messageType: "post",
    messageId: "om_1",
    mentions: [],
    content: JSON.stringify({
      zh_cn: {
        title: "标题",
        content: [[
          { tag: "text", text: "看图 " },
          { tag: "img", image_key: "img_post" },
          { tag: "media", file_key: "file_post" },
        ]],
      },
    }),
  });
  expect(result.text).toContain("标题");
  expect(result.text).toContain("![image](img_post)");
  expect(result.resources).toEqual([
    { kind: "image", fileKey: "img_post" },
    { kind: "file", fileKey: "file_post" },
  ]);
});

test("enqueueFeishuChatTask serializes same chat", async () => {
  resetFeishuChatQueueForTests();
  const order: string[] = [];

  const first = enqueueFeishuChatTask({
    accountId: "default",
    chatId: "oc_chat",
    task: async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first-end");
    },
  });
  const second = enqueueFeishuChatTask({
    accountId: "default",
    chatId: "oc_chat",
    task: async () => {
      order.push("second");
    },
  });

  await Promise.all([first.promise, second.promise]);
  expect(order).toEqual(["first-start", "first-end", "second"]);
});
