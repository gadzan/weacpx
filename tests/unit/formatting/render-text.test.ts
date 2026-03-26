import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { renderAgents, renderHelpText, renderWorkspaces } from "../../../src/formatting/render-text";

function createConfig(): AppConfig {
  return {
    transport: { type: "acpx-cli", command: "acpx" },
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

test("renders help text in Chinese", () => {
  expect(renderHelpText()).toContain("可用命令");
  expect(renderHelpText()).toContain("/agent add <codex|claude>");
  expect(renderHelpText()).toContain("/agent rm <name>");
  expect(renderHelpText()).toContain("/ws");
  expect(renderHelpText()).toContain("/ws new <name> -d <path>");
  expect(renderHelpText()).toContain("/ss");
  expect(renderHelpText()).toContain("/ss <agent> -d <path>");
  expect(renderHelpText()).toContain("/ss new <agent> -d <path>");
  expect(renderHelpText()).toContain("/ss new <alias> -a <name> --ws <name>");
  expect(renderHelpText()).toContain("/stop");
});

test("renders agents in Chinese", () => {
  expect(renderAgents(createConfig())).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("renders workspaces in Chinese", () => {
  expect(renderWorkspaces(createConfig())).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});
