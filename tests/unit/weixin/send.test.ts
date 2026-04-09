import { expect, test } from "bun:test";

import { markdownToPlainText } from "../../../src/weixin/messaging/send";

test("preserves underscores in workspace names", () => {
  expect(markdownToPlainText("ec_fenqile_m")).toBe("ec_fenqile_m");
});

test("preserves underscores in Windows-style paths", () => {
  expect(markdownToPlainText(String.raw`E:\projects\ec_fenqile_m`)).toBe(String.raw`E:\projects\ec_fenqile_m`);
});

test("strips backticks while preserving underscored content", () => {
  expect(markdownToPlainText("`ec_fenqile_m`")).toBe("ec_fenqile_m");
});

test("still strips bold markdown markers", () => {
  expect(markdownToPlainText("**hello**")).toBe("hello");
});
