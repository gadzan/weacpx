import { expect, test } from "bun:test";

import {
  extractRawTextFromFeishuEvent,
  isAbortTrigger,
  isLikelyAbortText,
} from "../../../../packages/channel-feishu/src/abort-detect";
import type { FeishuMessageEvent } from "../../../../packages/channel-feishu/src/types";

test("isAbortTrigger matches common stop words case-insensitively", () => {
  expect(isAbortTrigger("stop")).toBe(true);
  expect(isAbortTrigger("STOP")).toBe(true);
  expect(isAbortTrigger("  Abort. ")).toBe(true);
  expect(isAbortTrigger("停止")).toBe(true);
  expect(isAbortTrigger("取消")).toBe(true);
  expect(isAbortTrigger("please stop")).toBe(true);
});

test("isAbortTrigger rejects non-triggers", () => {
  expect(isAbortTrigger("")).toBe(false);
  expect(isAbortTrigger("stop the agent before lunch")).toBe(false);
  expect(isAbortTrigger("hello")).toBe(false);
});

test("isAbortTrigger rejects common English words with non-abort meanings", () => {
  // These words have everyday non-abort meanings — must NOT trigger.
  expect(isAbortTrigger("wait")).toBe(false);
  expect(isAbortTrigger("halt")).toBe(false);
  expect(isAbortTrigger("exit")).toBe(false);
  expect(isAbortTrigger("esc")).toBe(false);
});

test("isLikelyAbortText accepts /stop, /abort, /cancel commands", () => {
  expect(isLikelyAbortText("/stop")).toBe(true);
  expect(isLikelyAbortText("/abort")).toBe(true);
  expect(isLikelyAbortText("/cancel")).toBe(true);
  expect(isLikelyAbortText("/Stop")).toBe(true);
  expect(isLikelyAbortText("/start")).toBe(false);
});

test("extractRawTextFromFeishuEvent strips @_user_N placeholders", () => {
  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_x" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "@_user_1 stop" }),
      create_time: String(Date.now()),
    },
  };

  expect(extractRawTextFromFeishuEvent(event)).toBe("stop");
});

test("extractRawTextFromFeishuEvent returns undefined for non-text messages", () => {
  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_x" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "p2p",
      message_type: "image",
      content: JSON.stringify({ image_key: "img" }),
      create_time: String(Date.now()),
    },
  };

  expect(extractRawTextFromFeishuEvent(event)).toBeUndefined();
});

test("extractRawTextFromFeishuEvent tolerates malformed JSON", () => {
  const event: FeishuMessageEvent = {
    sender: { sender_id: { open_id: "ou_x" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "p2p",
      message_type: "text",
      content: "not json",
      create_time: String(Date.now()),
    },
  };

  expect(extractRawTextFromFeishuEvent(event)).toBeUndefined();
});
