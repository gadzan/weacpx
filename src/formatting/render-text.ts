import type { AppConfig } from "../config/types";

export function renderHelpText(): string {
  return [
    "可用命令：",
    "",
    "先看这 3 个：",
    "/ss new <agent> -d <path> - 新建会话",
    "/use <alias> - 切会话",
    "/status - 看状态",
    "",
    "Agent：",
    "/agents - 看 Agent",
    "/agent add <codex|claude> - 加 Agent",
    "/agent rm <name> - 删 Agent",
    "",
    "工作区：",
    "/workspaces - 看工作区",
    "/workspace 或 /ws - 工作区命令",
    "/ws new <name> -d <path> - 加工作区",
    "/workspace rm <name> - 删工作区",
    "",
    "会话：",
    "/sessions - 看会话",
    "/session 或 /ss - 会话命令",
    "/ss <agent> -d <path> - 快速新建",
    "/ss new <agent> -d <path> - 新建会话",
    "/ss new <alias> -a <name> --ws <name> - 指定配置新建",
    "/ss attach <alias> -a <name> --ws <name> --name <transport-session> - 挂已有会话",
    "/use <alias> - 切会话",
    "/session reset 或 /clear - 清上下文",
    "",
    "权限：",
    "/pm 或 /permission - 权限设置",
    "/pm set <allow|read|deny> - 设审批级别",
    "/pm auto [allow|deny|fail] - 设自动处理",
    "",
    "常用：",
    "/status - 看状态",
    "/cancel 或 /stop - 停当前任务",
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
