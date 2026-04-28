import { expect, test } from "bun:test";

import { parseCoordinatorSession } from "../../../src/mcp/parse-coordinator-session";

test("prefers the last --coordinator-session flag after trimming", () => {
  expect(
    parseCoordinatorSession(
      ["--coordinator-session", " backend:one ", "--coordinator-session", " backend:two "],
      {},
    ),
  ).toBe("backend:two");
});

test("falls back to WEACPX_COORDINATOR_SESSION when the flag is absent", () => {
  expect(parseCoordinatorSession([], { WEACPX_COORDINATOR_SESSION: " backend:main " })).toBe("backend:main");
});

test("treats empty flag and env values as unset", () => {
  expect(parseCoordinatorSession(["--coordinator-session", "   "], { WEACPX_COORDINATOR_SESSION: "   " })).toBeNull();
});
