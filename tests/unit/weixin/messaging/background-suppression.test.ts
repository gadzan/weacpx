import { expect, test } from "bun:test";
import { resolveFinalDisposition } from "../../../../src/weixin/messaging/foreground-gate";

test("foreground → send normally", () => {
  expect(resolveFinalDisposition(true, true)).toBe("send");
});

test("backgrounded with storage wired → store", () => {
  expect(resolveFinalDisposition(false, true)).toBe("store");
});

test("backgrounded without storage wired → drop (never leak to foreground)", () => {
  expect(resolveFinalDisposition(false, false)).toBe("drop");
});

test("foreground without storage → send normally", () => {
  expect(resolveFinalDisposition(true, false)).toBe("send");
});
