import { expect, test } from "bun:test";

import { parseCoordinatorWorkspace } from "../../../src/mcp/parse-coordinator-workspace";

test("parses coordinator workspace flag before environment", () => {
  expect(
    parseCoordinatorWorkspace(
      ["--workspace", " frontend ", "--workspace", " backend "],
      { WEACPX_COORDINATOR_WORKSPACE: "ops" },
    ),
  ).toBe("backend");
});

test("parses coordinator workspace from environment", () => {
  expect(parseCoordinatorWorkspace([], { WEACPX_COORDINATOR_WORKSPACE: " backend " })).toBe("backend");
});

test("returns null for blank coordinator workspace environment", () => {
  expect(parseCoordinatorWorkspace([], { WEACPX_COORDINATOR_WORKSPACE: "   " })).toBeNull();
});

test("rejects coordinator workspace flags without values", () => {
  expect(() => parseCoordinatorWorkspace(["--workspace"], { WEACPX_COORDINATOR_WORKSPACE: "backend" })).toThrow(
    "--workspace requires a non-empty value",
  );
  expect(() => parseCoordinatorWorkspace(["--workspace", "--source-handle", "worker:1"], {})).toThrow(
    "--workspace requires a non-empty value",
  );
  expect(() => parseCoordinatorWorkspace(["--workspace", "   "], {})).toThrow(
    "--workspace requires a non-empty value",
  );
  expect(() => parseCoordinatorWorkspace(["--workspace", " --source-handle"], {})).toThrow(
    "--workspace requires a non-empty value",
  );
});
