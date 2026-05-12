import { beforeEach, expect, test } from "bun:test";

import {
  clearMessageUnavailableForAccount,
  extractFeishuApiCode,
  isMessageUnavailable,
  isTerminalMessageApiCode,
  markIfUnavailableError,
  markMessageUnavailable,
  resetMessageUnavailableCacheForTests,
} from "../../../../packages/channel-feishu/src/message-unavailable";

beforeEach(() => {
  resetMessageUnavailableCacheForTests();
});

test("isTerminalMessageApiCode recognises 230011 and 231003", () => {
  expect(isTerminalMessageApiCode(230011)).toBe(true);
  expect(isTerminalMessageApiCode(231003)).toBe(true);
  expect(isTerminalMessageApiCode(0)).toBe(false);
  expect(isTerminalMessageApiCode(231001)).toBe(false);
  expect(isTerminalMessageApiCode("230011")).toBe(false);
});

test("markMessageUnavailable then isMessageUnavailable returns true", () => {
  expect(isMessageUnavailable("om_1")).toBe(false);
  markMessageUnavailable("om_1", 230011);
  expect(isMessageUnavailable("om_1")).toBe(true);
});

test("isMessageUnavailable returns false for unknown and empty ids", () => {
  expect(isMessageUnavailable("om_unseen")).toBe(false);
  expect(isMessageUnavailable(undefined)).toBe(false);
  expect(isMessageUnavailable("")).toBe(false);
});

test("extractFeishuApiCode reads top-level code and nested response.data.code", () => {
  expect(extractFeishuApiCode({ code: 230011 })).toBe(230011);
  expect(extractFeishuApiCode({ response: { data: { code: 231003 } } })).toBe(231003);
  expect(extractFeishuApiCode({ code: "230011" })).toBeUndefined();
  expect(extractFeishuApiCode(null)).toBeUndefined();
});

test("markIfUnavailableError marks the message and returns true for terminal codes", () => {
  expect(markIfUnavailableError("om_1", { code: 230011 })).toBe(true);
  expect(isMessageUnavailable("om_1")).toBe(true);
});

test("markIfUnavailableError ignores non-terminal codes", () => {
  expect(markIfUnavailableError("om_1", { code: 99999 })).toBe(false);
  expect(isMessageUnavailable("om_1")).toBe(false);
});

test("cache scopes by accountId — same message id across accounts is independent", () => {
  markMessageUnavailable("om_shared", 230011, "account-a");
  expect(isMessageUnavailable("om_shared", "account-a")).toBe(true);
  expect(isMessageUnavailable("om_shared", "account-b")).toBe(false);
  expect(isMessageUnavailable("om_shared")).toBe(false); // default scope
});

test("markIfUnavailableError respects accountId scoping", () => {
  expect(markIfUnavailableError("om_1", { code: 230011 }, "account-a")).toBe(true);
  expect(isMessageUnavailable("om_1", "account-a")).toBe(true);
  expect(isMessageUnavailable("om_1", "account-b")).toBe(false);
});

test("clearMessageUnavailableForAccount drops only the targeted account's entries", () => {
  markMessageUnavailable("om_1", 230011, "account-a");
  markMessageUnavailable("om_2", 230011, "account-a");
  markMessageUnavailable("om_1", 230011, "account-b");
  clearMessageUnavailableForAccount("account-a");
  expect(isMessageUnavailable("om_1", "account-a")).toBe(false);
  expect(isMessageUnavailable("om_2", "account-a")).toBe(false);
  expect(isMessageUnavailable("om_1", "account-b")).toBe(true);
});
