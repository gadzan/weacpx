import { expect, test } from "bun:test";

import { buildFeishuCompletionNotice } from "../../../../packages/channel-feishu/src/completion-notice";

test("done notice names the session, no /use guidance (card already in timeline)", () => {
  expect(buildFeishuCompletionNotice("backend", "done")).toBe("✅ backend 已完成");
});

test("error notice", () => {
  expect(buildFeishuCompletionNotice("backend", "error")).toBe("⚠️ backend 失败");
});
