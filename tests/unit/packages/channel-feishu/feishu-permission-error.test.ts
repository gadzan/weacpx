import { expect, test } from "bun:test";

import {
  PERMISSION_NOTIFY_COOLDOWN_MS,
  PermissionNotifier,
  extractPermissionError,
  extractPermissionGrantUrl,
  extractPermissionScopes,
  formatPermissionNotice,
} from "../../../../packages/channel-feishu/src/permission-error";

test("extractPermissionGrantUrl picks first /app/ URL and rewrites q to highest-priority scope", () => {
  const msg =
    "Permission missing: app scope [im:message:send_as_bot,im:message] grant: https://open.feishu.cn/app/cli_xxx/auth?q=im:message:send_as_bot,im:message:readonly";
  const url = extractPermissionGrantUrl(msg);
  expect(url.startsWith("https://open.feishu.cn/app/cli_xxx/auth")).toBe(true);
  expect(url.includes("q=im%3Amessage%3Areadonly")).toBe(true);
});

test("extractPermissionGrantUrl returns empty when URL missing", () => {
  expect(extractPermissionGrantUrl("no url here")).toBe("");
});

test("extractPermissionGrantUrl strips trailing punctuation glued to the URL", () => {
  const msg = "scope missing: grant: https://open.feishu.cn/app/cli_a/auth?q=im:message).";
  const url = extractPermissionGrantUrl(msg);
  expect(url.endsWith(")")).toBe(false);
  expect(url.endsWith(".")).toBe(false);
  expect(url).toContain("open.feishu.cn/app/cli_a/auth");
});

test("extractPermissionGrantUrl rejects non-allowlisted hostnames", () => {
  const msg = "grant: https://attacker.example/app/cli_a/auth?q=im:message";
  expect(extractPermissionGrantUrl(msg)).toBe("");
});

test("extractPermissionGrantUrl drops query params other than q/app_id", () => {
  const msg = "grant: https://open.feishu.cn/app/cli_a/auth?q=im:message&token=secret&trace=abc";
  const url = extractPermissionGrantUrl(msg);
  expect(url).not.toContain("token=secret");
  expect(url).not.toContain("trace=abc");
  expect(url).toContain("q=im%3Amessage");
});

test("extractPermissionScopes pulls the [scope1,scope2] list", () => {
  expect(extractPermissionScopes("[im:message:send,im:message]")).toBe("im:message:send,im:message");
  expect(extractPermissionScopes("no brackets")).toBe("");
});

test("extractPermissionError detects code 99991672 with grant url", () => {
  const err = {
    code: 99991672,
    msg: "Application has no scope [im:message] grant: https://open.feishu.cn/app/cli_a/auth?q=im:message",
  };
  const result = extractPermissionError(err);
  expect(result).not.toBeNull();
  expect(result!.code).toBe(99991672);
  expect(result!.grantUrl.includes("open.feishu.cn/app/cli_a/auth")).toBe(true);
});

test("extractPermissionError returns null for non-permission codes", () => {
  expect(extractPermissionError({ code: 230011, msg: "recalled" })).toBeNull();
  expect(extractPermissionError(null)).toBeNull();
  expect(extractPermissionError({ code: 99991672, msg: "no url" })).toBeNull();
});

test("extractPermissionError reads nested response.data shape", () => {
  const err = {
    response: {
      data: {
        code: 99991672,
        msg: "scope [im:message] grant: https://open.feishu.cn/app/cli_b/auth?q=im:message",
      },
    },
  };
  expect(extractPermissionError(err)?.code).toBe(99991672);
});

test("PermissionNotifier enforces cooldown per key", () => {
  const notifier = new PermissionNotifier();
  const t0 = 1_000;
  expect(notifier.shouldNotify("k1", t0)).toBe(true);
  expect(notifier.shouldNotify("k1", t0 + 1_000)).toBe(false);
  expect(notifier.shouldNotify("k1", t0 + PERMISSION_NOTIFY_COOLDOWN_MS + 1)).toBe(true);
  expect(notifier.shouldNotify("k2", t0)).toBe(true);
});

test("PermissionNotifier rollback frees the slot so next attempt can send", () => {
  const notifier = new PermissionNotifier();
  const t0 = 1_000;
  // First attempt reserves a slot.
  expect(notifier.tryReserve("k1", t0)).toBe(true);
  // Concurrent attempt while held: denied.
  expect(notifier.tryReserve("k1", t0 + 1)).toBe(false);
  // Send failed → rollback releases the slot without burning the cooldown.
  notifier.rollback("k1");
  // Immediately retry-able.
  expect(notifier.tryReserve("k1", t0 + 2)).toBe(true);
  // Commit advances the cooldown.
  notifier.commit("k1", t0 + 2);
  expect(notifier.tryReserve("k1", t0 + 100)).toBe(false);
});

test("formatPermissionNotice includes scopes and grant URL", () => {
  const notice = formatPermissionNotice({
    code: 99991672,
    message: "scope [im:message] grant: https://x.y/app/cli/auth?q=im:message",
    grantUrl: "https://x.y/app/cli/auth?q=im:message",
  });
  expect(notice).toContain("im:message");
  expect(notice).toContain("https://x.y/app/cli/auth?q=im:message");
});
