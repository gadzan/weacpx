import type { AppConfig } from "../config/types";

export function renderHelpText(): string {
  return [
    "可用命令：",
    "/agents",
    "/agent add <codex|claude>",
    "/agent rm <name>",
    "/workspaces",
    "/workspace 或 /ws",
    "/ws new <name> -d <path>",
    "/workspace rm <name>",
    "/sessions",
    "/session 或 /ss",
    "/ss <agent> -d <path>",
    "/ss new <agent> -d <path>",
    "/ss new <alias> -a <name> --ws <name>",
    "/ss attach <alias> -a <name> --ws <name> --name <transport-session>",
    "/pm 或 /permission",
    "/pm set <allow|read|deny>",
    "/pm auto [allow|deny|fail]",
    "/use <alias>",
    "/status",
    "/cancel 或 /stop",
    "/session reset 或 /clear",
  ].join("\n");
}

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
