import { expect, test } from "bun:test";

import {
  formatQuoteContext,
  isQuoteRepliedToBot,
  parseQuoteFromCloudCustomData,
} from "../../../../packages/channel-yuanbao/src/quote";

test("parseQuoteFromCloudCustomData returns undefined for missing / malformed input", () => {
  expect(parseQuoteFromCloudCustomData(undefined)).toBeUndefined();
  expect(parseQuoteFromCloudCustomData("")).toBeUndefined();
  expect(parseQuoteFromCloudCustomData("not json")).toBeUndefined();
  expect(parseQuoteFromCloudCustomData("{}")).toBeUndefined();
  expect(parseQuoteFromCloudCustomData('{"quote": null}')).toBeUndefined();
});

test("parseQuoteFromCloudCustomData extracts text quote with snake_case keys", () => {
  const json = JSON.stringify({ quote: { msg_id: "m1", sender_id: "user_001", sender_nickname: "Alice", type: 1, desc: "previous text" } });
  expect(parseQuoteFromCloudCustomData(json)).toEqual({
    msgId: "m1",
    senderId: "user_001",
    senderNickname: "Alice",
    type: 1,
    desc: "previous text",
  });
});

test("parseQuoteFromCloudCustomData accepts camelCase variants", () => {
  const json = JSON.stringify({ quote: { msgId: "m2", senderId: "user_002", senderNickname: "Bob", type: "1", desc: "from camelCase" } });
  expect(parseQuoteFromCloudCustomData(json)).toEqual({
    msgId: "m2",
    senderId: "user_002",
    senderNickname: "Bob",
    type: 1,
    desc: "from camelCase",
  });
});

test("parseQuoteFromCloudCustomData substitutes [image] when type=2 and desc is blank", () => {
  const json = JSON.stringify({ quote: { sender_id: "u", type: 2, desc: "" } });
  expect(parseQuoteFromCloudCustomData(json)).toEqual({
    senderId: "u",
    type: 2,
    desc: "[image]",
  });
});

test("parseQuoteFromCloudCustomData returns undefined when there's nothing meaningful", () => {
  expect(parseQuoteFromCloudCustomData('{"quote": {}}')).toBeUndefined();
});

test("formatQuoteContext renders nickname-aware header and prefixes desc lines", () => {
  const formatted = formatQuoteContext({ senderNickname: "Alice", desc: "first line\nsecond line" });
  expect(formatted).toBe("> [Quoted message from Alice]:\n> first line\n> second line");
});

test("formatQuoteContext falls back to senderId then anonymous", () => {
  expect(formatQuoteContext({ senderId: "u_42", desc: "hi" })).toContain("> [Quoted message from u_42]:");
  expect(formatQuoteContext({ desc: "anon" })).toContain("> [Quoted message]:");
});

test("formatQuoteContext truncates long desc with a marker", () => {
  const desc = "x".repeat(700);
  const out = formatQuoteContext({ senderNickname: "n", desc });
  expect(out).toContain("...(truncated)");
  expect(out.length).toBeLessThan(desc.length);
});

test("isQuoteRepliedToBot true only when senderId matches botId", () => {
  expect(isQuoteRepliedToBot({ senderId: "bot_001" }, "bot_001")).toBe(true);
  expect(isQuoteRepliedToBot({ senderId: "user_001" }, "bot_001")).toBe(false);
  expect(isQuoteRepliedToBot(undefined, "bot_001")).toBe(false);
  expect(isQuoteRepliedToBot({ senderId: "bot_001" }, undefined)).toBe(false);
});
