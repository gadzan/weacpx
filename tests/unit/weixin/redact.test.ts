import { expect, test } from "bun:test";

import { redactBody } from "../../../src/weixin/util/redact";

test("redactBody masks secret JSON fields and message text instead of logging raw values", () => {
  const body = JSON.stringify({
    token: "secret-token-value",
    context_token: "ctx-secret-value",
    replyContextToken: "reply-secret-value",
    text: "用户的完整私密消息",
    nested: {
      Authorization: "Bearer real-token",
      message: "another private message",
      safe: "kept",
    },
  });

  const redacted = redactBody(body, 2_000);

  expect(redacted).not.toContain("secret-token-value");
  expect(redacted).not.toContain("ctx-secret-value");
  expect(redacted).not.toContain("reply-secret-value");
  expect(redacted).not.toContain("Bearer real-token");
  expect(redacted).not.toContain("用户的完整私密消息");
  expect(redacted).not.toContain("another private message");
  expect(redacted).toContain('"safe":"kept"');
  expect(redacted).toContain('"text":"<redacted len=9>"');
});

test("redactBody still truncates non-JSON bodies", () => {
  expect(redactBody("abcdef", 3)).toBe("abc…(truncated, totalLen=6)");
});
