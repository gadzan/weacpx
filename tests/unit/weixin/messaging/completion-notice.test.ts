import { expect, test } from "bun:test";
import { buildBackgroundCompletionNotice } from "../../../../src/weixin/messaging/completion-notice";

test("done notice names the session and points to /use", () => {
  const msg = buildBackgroundCompletionNotice("backend", "done");
  expect(msg).toContain("backend");
  expect(msg).toContain("/use backend");
  expect(msg.startsWith("✅")).toBe(true);
});

test("error notice names the session and points to /use", () => {
  const msg = buildBackgroundCompletionNotice("backend", "error");
  expect(msg).toContain("backend");
  expect(msg).toContain("/use backend");
  expect(msg.startsWith("⚠️")).toBe(true);
});
