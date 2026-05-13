import { expect, test } from "bun:test";

import {
  createYuanbaoLog,
  sanitizeLogContext,
  type LogSink,
} from "../../../../packages/channel-yuanbao/src/access/logger";

test("sanitizeLogContext masks top-level sensitive keys", () => {
  const out = sanitizeLogContext({
    token: "abcdefghij",
    appKey: "yb_application_key",
    appSecret: "yb_application_secret",
    something: "fine",
  });
  expect(out).toEqual({
    token: "abc****hij",
    appKey: "yb_****key",
    appSecret: "yb_****ret",
    something: "fine",
  });
});

test("sanitizeLogContext recursively masks nested objects (WsClient.connection.auth.token)", () => {
  const out = sanitizeLogContext({
    connection: {
      gatewayUrl: "wss://example",
      auth: {
        bizId: "biz",
        uid: "uid",
        token: "0123456789abcdef",
        signature: "0123456789abcdef",
      },
    },
    config: { maxReconnectAttempts: 3 },
  });

  const connection = (out!.connection as { auth: Record<string, unknown> });
  expect(connection.auth.token).toBe("012****def");
  expect(connection.auth.signature).toBe("012****def");
  expect(connection.auth.bizId).toBe("biz");
  expect(out!.config).toEqual({ maxReconnectAttempts: 3 });
});

test("sanitizeLogContext masks short secrets as '***'", () => {
  const out = sanitizeLogContext({ token: "abc" });
  expect(out).toEqual({ token: "***" });
});

test("sanitizeLogContext masks non-string sensitive values as '***'", () => {
  const out = sanitizeLogContext({ token: { nested: "x" } });
  expect(out).toEqual({ token: "***" });
});

test("sanitizeLogContext walks arrays of objects", () => {
  const out = sanitizeLogContext({
    accounts: [
      { name: "a", token: "abcdefghij" },
      { name: "b", appSecret: "abcdefghij" },
    ],
  });
  expect(out).toEqual({
    accounts: [
      { name: "a", token: "abc****hij" },
      { name: "b", appSecret: "abc****hij" },
    ],
  });
});

test("sanitizeLogContext returns undefined for undefined input", () => {
  expect(sanitizeLogContext(undefined)).toBeUndefined();
});

test("createYuanbaoLog passes sanitized context to LogSink", () => {
  const calls: Array<{ level: string; msg: string; context?: Record<string, unknown> }> = [];
  const sink: LogSink = {
    info: (msg, context) => calls.push({ level: "info", msg, context }),
    warn: (msg, context) => calls.push({ level: "warn", msg, context }),
    error: (msg, context) => calls.push({ level: "error", msg, context }),
    debug: (msg, context) => calls.push({ level: "debug", msg, context }),
  };
  const log = createYuanbaoLog("ws", sink);
  log.info("hello", { token: "abcdefghij", note: "ok" });
  log.debug("dbg", { appSecret: "abcdefghij" });
  expect(calls).toEqual([
    { level: "info", msg: "hello", context: { token: "abc****hij", note: "ok" } },
    { level: "debug", msg: "dbg", context: { appSecret: "abc****hij" } },
  ]);
});

test("createYuanbaoLog folds sanitized context into LogSink.error message string", () => {
  const messages: string[] = [];
  const sink: LogSink = {
    error: (msg) => { messages.push(msg); },
  };
  const log = createYuanbaoLog("ws", sink);
  log.error("oops", { token: "abcdefghij" });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("abc****hij");
  expect(messages[0]).not.toContain("abcdefghij");
});
