import { expect, test } from "bun:test";
import { shouldDeliverSegment } from "../../../../src/weixin/messaging/foreground-gate";

test("delivers when no gate is configured (legacy)", () => {
  expect(shouldDeliverSegment(undefined)).toBe(true);
});
test("delivers when the turn's session is the live foreground", () => {
  expect(shouldDeliverSegment(() => true)).toBe(true);
});
test("suppresses when the turn's session has been backgrounded", () => {
  expect(shouldDeliverSegment(() => false)).toBe(false);
});
