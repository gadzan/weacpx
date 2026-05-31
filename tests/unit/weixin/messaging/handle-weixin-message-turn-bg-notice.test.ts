import { expect, test } from "bun:test";
import { shouldSendBackgroundNotice } from "../../../../src/weixin/messaging/completion-notice";

test("sends when a final slot is reserved", () => {
  expect(shouldSendBackgroundNotice(() => true)).toBe(true);
});

test("drops when no final slot is available", () => {
  expect(shouldSendBackgroundNotice(() => false)).toBe(false);
});

test("sends when no quota gate is configured (legacy)", () => {
  expect(shouldSendBackgroundNotice(undefined)).toBe(true);
});
