import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { renderAgents, renderHelpText, renderWorkspaces } from "../../../src/formatting/render-text";

function createConfig(): AppConfig {
  return {
    transport: {
      type: "acpx-cli",
      command: "acpx",
      permissionMode: "approve-all",
      nonInteractivePermissions: "fail",
    },
    logging: {
      level: "info",
      maxSizeBytes: 2 * 1024 * 1024,
      maxFiles: 5,
      retentionDays: 7,
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

test("renders grouped help text with beginner shortcuts first", () => {
  const text = renderHelpText();
  const lines = text.split("\n");

  expect(lines.slice(0, 6)).toEqual([
    "可用命令：",
    "",
    "先看这 3 个：",
    "/ss new <agent> -d <path> - 新建会话",
    "/use <alias> - 切会话",
    "/status - 看状态",
  ]);

  expect(text).toContain("Agent：");
  expect(text).toContain("/agents - 看 Agent");
  expect(text).toContain("/agent add <codex|claude> - 加 Agent");
  expect(text).toContain("/agent rm <name> - 删 Agent");
  expect(text).toContain("工作区：");
  expect(text).toContain("会话：");
  expect(text).toContain("权限：");
  expect(text).toContain("常用：");
  expect(text).toContain("/cancel 或 /stop - 停当前任务");
});

test("renders agents in Chinese", () => {
  expect(renderAgents(createConfig())).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("renders workspaces in Chinese", () => {
  expect(renderWorkspaces(createConfig())).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});
