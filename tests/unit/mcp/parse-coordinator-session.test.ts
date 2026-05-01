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

test("returns null for empty coordinator session environment", () => {
  expect(parseCoordinatorSession([], { WEACPX_COORDINATOR_SESSION: "   " })).toBeNull();
});

test("rejects coordinator session flags without values", () => {
  expect(() => parseCoordinatorSession(["--coordinator-session"], { WEACPX_COORDINATOR_SESSION: "backend:main" })).toThrow(
    "--coordinator-session requires a non-empty value",
  );
  expect(() => parseCoordinatorSession(["--coordinator-session", "--workspace", "backend"], {})).toThrow(
    "--coordinator-session requires a non-empty value",
  );
  expect(() => parseCoordinatorSession(["--coordinator-session", "   "], {})).toThrow(
    "--coordinator-session requires a non-empty value",
  );
  expect(() => parseCoordinatorSession(["--coordinator-session", " --workspace"], {})).toThrow(
    "--coordinator-session requires a non-empty value",
  );
});
