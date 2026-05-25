import { expect, test } from "bun:test";

import { parseInternalSessionToolsFlag } from "../../../src/mcp/parse-internal-session-tools";

test("enables internal session tools from the hidden flag", () => {
  expect(parseInternalSessionToolsFlag(["--internal-session-tools"], {})).toBe(true);
});

test("keeps internal session tools disabled by default", () => {
  expect(parseInternalSessionToolsFlag([], {})).toBe(false);
});

test("does not enable internal session tools from inherited environment", () => {
  expect(parseInternalSessionToolsFlag([], { WEACPX_INTERNAL_SESSION_TOOLS: "1" })).toBe(false);
  expect(parseInternalSessionToolsFlag([], { WEACPX_INTERNAL_SESSION_TOOLS: "true" })).toBe(false);
});
