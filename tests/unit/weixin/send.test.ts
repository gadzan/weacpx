import { expect, test } from "bun:test";

import { markdownToPlainText } from "../../../src/weixin/messaging/send";

test("preserves underscores in workspace names", () => {
  expect(markdownToPlainText("ec_fenqile_m")).toBe("ec_fenqile_m");
});

test("preserves underscores in Windows-style paths", () => {
  expect(markdownToPlainText(String.raw`E:\projects\ec_fenqile_m`)).toBe(String.raw`E:\projects\ec_fenqile_m`);
});

test("preserves inline backticks (StreamingMarkdownFilter keeps code spans verbatim)", () => {
  expect(markdownToPlainText("`ec_fenqile_m`")).toBe("`ec_fenqile_m`");
});

test("preserves ** bold markers verbatim (non-CJK and CJK alike)", () => {
  // StreamingMarkdownFilter only strips CJK around *italic*, ***bold-italic***,
  // _italic_, ___bold-italic___. Regular ** bold is always preserved.
  expect(markdownToPlainText("**hello**")).toBe("**hello**");
});

test("strips italic markers around CJK content", () => {
  expect(markdownToPlainText("*中文*")).toBe("中文");
});
