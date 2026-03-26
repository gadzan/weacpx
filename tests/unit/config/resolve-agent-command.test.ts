import { expect, test } from "bun:test";

import { resolveAgentCommand } from "../../../src/config/resolve-agent-command";

test("drops the legacy codex shim command so acpx can use the built-in codex alias", () => {
  expect(resolveAgentCommand("codex", "./node_modules/.bin/codex-acp")).toBeUndefined();
});

test("drops the windows codex executable shim command", () => {
  expect(resolveAgentCommand("codex", ".\\node_modules\\.bin\\codex-acp.exe")).toBeUndefined();
});

test("drops a legacy absolute codex node script command", () => {
  expect(
    resolveAgentCommand(
      "codex",
      "node E:/projects/weacpx/node_modules/@zed-industries/codex-acp/bin/codex-acp.js",
    ),
  ).toBeUndefined();
});

test("keeps unrelated commands unchanged", () => {
  expect(resolveAgentCommand("claude", "custom-agent")).toBe("custom-agent");
});
