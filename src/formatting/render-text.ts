import type { AppConfig } from "../config/types";

export function renderAgents(config: AppConfig): string {
  const names = Object.keys(config.agents);
  if (names.length === 0) {
    return "还没有注册任何 Agent。";
  }
  return ["已注册的 Agent：", ...names.map((name) => `- ${name}`)].join("\n");
}

export function renderWorkspaces(config: AppConfig): string {
  const names = Object.entries(config.workspaces);
  if (names.length === 0) {
    return "还没有注册任何工作区。";
  }
  return ["已注册的工作区：", ...names.map(([name, workspace]) => `- ${name}: ${workspace.cwd}`)].join("\n");
}
