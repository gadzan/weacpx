import { afterAll, beforeAll, expect, test } from "bun:test";
import { setChannelLocale, t } from "../../../../packages/channel-feishu/src/i18n/index";

import { buildFeishuCompletionNotice } from "../../../../packages/channel-feishu/src/completion-notice";

beforeAll(() => {
  setChannelLocale("zh");
});

afterAll(() => {
  setChannelLocale("en");
});

test("done notice names the session, no /use guidance (card already in timeline)", () => {
  expect(buildFeishuCompletionNotice("backend", "done")).toBe(t().completionDone("backend"));
});

test("error notice", () => {
  expect(buildFeishuCompletionNotice("backend", "error")).toBe(t().completionError("backend"));
});
