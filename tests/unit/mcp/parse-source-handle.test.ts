import { expect, test } from "bun:test";

import { parseSourceHandle } from "../../../src/mcp/parse-source-handle";

test("prefers the last --source-handle flag after trimming", () => {
  expect(
    parseSourceHandle(
      ["--source-handle", " backend:worker-1 ", "--source-handle", " backend:worker-2 "],
      {},
    ),
  ).toBe("backend:worker-2");
});

test("falls back to WEACPX_SOURCE_HANDLE when the flag is absent", () => {
  expect(parseSourceHandle([], { WEACPX_SOURCE_HANDLE: " backend:worker " })).toBe("backend:worker");
});

test("returns null for empty source handle environment", () => {
  expect(parseSourceHandle([], { WEACPX_SOURCE_HANDLE: "   " })).toBeNull();
});

test("rejects source handle flags without values", () => {
  expect(() => parseSourceHandle(["--source-handle"], { WEACPX_SOURCE_HANDLE: "backend:worker" })).toThrow(
    "--source-handle requires a non-empty value",
  );
  expect(() => parseSourceHandle(["--source-handle", "--workspace", "backend"], {})).toThrow(
    "--source-handle requires a non-empty value",
  );
  expect(() => parseSourceHandle(["--source-handle", "   "], {})).toThrow(
    "--source-handle requires a non-empty value",
  );
  expect(() => parseSourceHandle(["--source-handle", " --workspace"], {})).toThrow(
    "--source-handle requires a non-empty value",
  );
});
