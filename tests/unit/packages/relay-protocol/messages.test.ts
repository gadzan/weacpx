import { expect, test } from "bun:test";

import {
  MSG,
  errorPayload,
  isErrorPayload,
} from "../../../../packages/relay-protocol/src/messages";

test("message type constants are namespaced and unique", () => {
  const values = Object.values(MSG);
  expect(new Set(values).size).toBe(values.length);
  for (const value of values) {
    expect(value).toMatch(/^(instance|control)\.[a-z.]+$/);
  }
});

test("errorPayload/isErrorPayload roundtrip", () => {
  const payload = errorPayload("instance-offline", "instance i-1 is not connected");
  expect(isErrorPayload(payload)).toBe(true);
  expect(payload.error.code).toBe("instance-offline");
  expect(isErrorPayload({ ok: true })).toBe(false);
  expect(isErrorPayload(null)).toBe(false);
  expect(isErrorPayload({ error: { code: 1, message: "x" } })).toBe(false);
  expect(isErrorPayload({ error: "not-an-object" })).toBe(false);
  expect(isErrorPayload({ error: { code: "ok", message: 42 } })).toBe(false);
});
