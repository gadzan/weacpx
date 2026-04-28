import { expect, test } from "bun:test";

import { resolveOrchestrationNoticeAccountIds } from "../../../src/weixin/messaging/orchestration-notice-accounts";

test("prefers delivery account, then original account, then remaining available accounts", () => {
  expect(
    resolveOrchestrationNoticeAccountIds(
      {
        deliveryAccountId: "acc-delivery",
        accountId: "acc-origin",
      },
      ["acc-origin", "acc-current", "acc-delivery"],
    ),
  ).toEqual(["acc-delivery", "acc-origin", "acc-current"]);
});

test("falls back to available accounts when no saved delivery account exists", () => {
  expect(
    resolveOrchestrationNoticeAccountIds(
      {
        accountId: "acc-origin",
      },
      ["acc-current"],
    ),
  ).toEqual(["acc-origin", "acc-current"]);
});
