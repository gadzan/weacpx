import { expect, test } from "bun:test";

import {
  GroupHistoryStore,
  formatGroupHistoryContext,
} from "../../../../packages/channel-yuanbao/src/group-history";

test("record stores entries in order; consume drains and clears the bucket", () => {
  const store = new GroupHistoryStore();
  store.record("acct", "g1", { senderId: "u1", text: "first", timestamp: 1 });
  store.record("acct", "g1", { senderId: "u2", text: "second", timestamp: 2 });
  const drained = store.consume("acct", "g1");
  expect(drained.map((e) => e.text)).toEqual(["first", "second"]);
  expect(store.consume("acct", "g1")).toEqual([]);
});

test("record evicts oldest entries past perGroupLimit", () => {
  const store = new GroupHistoryStore({ perGroupLimit: 2 });
  store.record("acct", "g1", { senderId: "u", text: "a", timestamp: 1 });
  store.record("acct", "g1", { senderId: "u", text: "b", timestamp: 2 });
  store.record("acct", "g1", { senderId: "u", text: "c", timestamp: 3 });
  expect(store.peekForTests("acct", "g1").map((e) => e.text)).toEqual(["b", "c"]);
});

test("perGroupLimit=0 disables recording", () => {
  const store = new GroupHistoryStore({ perGroupLimit: 0 });
  expect(store.isEnabled()).toBe(false);
  store.record("acct", "g1", { senderId: "u", text: "ignored", timestamp: 1 });
  expect(store.peekForTests("acct", "g1")).toEqual([]);
});

test("record skips empty / whitespace-only text", () => {
  const store = new GroupHistoryStore();
  store.record("acct", "g1", { senderId: "u", text: "", timestamp: 1 });
  store.record("acct", "g1", { senderId: "u", text: "   ", timestamp: 2 });
  expect(store.peekForTests("acct", "g1")).toEqual([]);
});

test("record scopes buckets by accountId + groupCode", () => {
  const store = new GroupHistoryStore();
  store.record("a", "g1", { senderId: "u", text: "from-a", timestamp: 1 });
  store.record("b", "g1", { senderId: "u", text: "from-b", timestamp: 2 });
  expect(store.consume("a", "g1").map((e) => e.text)).toEqual(["from-a"]);
  expect(store.consume("b", "g1").map((e) => e.text)).toEqual(["from-b"]);
});

test("evicts oldest group when maxGroups exceeded", () => {
  const store = new GroupHistoryStore({ maxGroups: 2 });
  store.record("acct", "g1", { senderId: "u", text: "1", timestamp: 1 });
  store.record("acct", "g2", { senderId: "u", text: "2", timestamp: 2 });
  store.record("acct", "g3", { senderId: "u", text: "3", timestamp: 3 });
  expect(store.sizeForTests()).toBeLessThanOrEqual(2);
  expect(store.peekForTests("acct", "g1")).toEqual([]);
});

test("clearAccount removes only the targeted account's groups", () => {
  const store = new GroupHistoryStore();
  store.record("a", "g1", { senderId: "u", text: "x", timestamp: 1 });
  store.record("b", "g1", { senderId: "u", text: "y", timestamp: 1 });
  store.clearAccount("a");
  expect(store.peekForTests("a", "g1")).toEqual([]);
  expect(store.peekForTests("b", "g1").map((e) => e.text)).toEqual(["y"]);
});

test("formatGroupHistoryContext renders entries with sender + clock", () => {
  const ts = new Date("2026-05-13T10:32:00").getTime();
  const formatted = formatGroupHistoryContext([
    { senderId: "u1", senderName: "Alice", text: "hi", timestamp: ts },
    { senderId: "u2", text: "yo\nbro", timestamp: ts + 60_000 },
  ]);
  expect(formatted.startsWith("[group history]")).toBe(true);
  expect(formatted).toContain("@Alice");
  expect(formatted).toContain("@u2");
  expect(formatted).toContain("yo bro");
});

test("formatGroupHistoryContext returns empty string for empty list", () => {
  expect(formatGroupHistoryContext([])).toBe("");
});
