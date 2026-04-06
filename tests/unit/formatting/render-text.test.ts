import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { renderAgents, renderWorkspaces } from "../../../src/formatting/render-text";

function createConfig(): AppConfig {
  return {
    transport: {
      type: "acpx-cli",
      command: "acpx",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
    logging: {
      level: "info",
      maxSizeBytes: 2 * 1024 * 1024,
      maxFiles: 5,
      retentionDays: 7,
    },
    wechat: {
      replyMode: "stream",
    },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
    },
  };
}

test("renders agents in Chinese", () => {
  expect(renderAgents(createConfig())).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("renders workspaces in Chinese", () => {
  expect(renderWorkspaces(createConfig())).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});
