import { renderWorkspaces } from "../../formatting/render-text";
import { allocateWorkspaceName, isWorkspaceNameValid, sanitizeWorkspaceName } from "../workspace-name";
import { normalizeWorkspacePath, pathExists } from "../workspace-path";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";

export const workspaceHelp: HelpTopicMetadata = {
  topic: "workspace",
  aliases: ["ws", "workspaces"],
  summary: "管理已注册的工作区。",
  commands: [
    { usage: "/workspaces", description: "查看当前已注册的工作区" },
    { usage: "/workspace 或 /ws", description: "查看工作区列表" },
    { usage: "/ws new <name> -d <path> [--raw]", description: "添加工作区；含特殊字符的名称会被自动规范化，--raw 保留原名" },
    { usage: "/workspace rm <name>", description: "删除工作区" },
  ],
  examples: ['/ws new backend -d "/tmp/backend"', "/workspace rm backend"],
};

export function handleWorkspaces(context: CommandRouterContext): RouterResponse {
  return { text: context.config ? renderWorkspaces(context.config) : "No config loaded." };
}

export async function handleWorkspaceCreate(
  context: CommandRouterContext,
  workspaceName: string,
  cwd: string,
  options: { raw?: boolean } = {},
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const normalizedCwd = normalizeWorkspacePath(cwd);
  if (!(await pathExists(normalizedCwd))) {
    return { text: `工作区路径不存在：${cwd}` };
  }

  let name = workspaceName;
  let notice: string | undefined;
  if (!options.raw && !isWorkspaceNameValid(workspaceName)) {
    const base = sanitizeWorkspaceName(workspaceName);
    name = allocateWorkspaceName(base, context.config.workspaces);
    notice = `名称 ${JSON.stringify(workspaceName)} 含有特殊字符，已保存为「${name}」。如需保留原名请加 --raw。`;
  }

  const updated = await context.configStore.upsertWorkspace(name, normalizedCwd);
  context.replaceConfig(updated);
  const savedLine = `工作区「${name}」已保存`;
  return { text: notice ? `${notice}\n${savedLine}` : savedLine };
}

export async function handleWorkspaceRemove(
  context: CommandRouterContext,
  workspaceName: string,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const updated = await context.configStore.removeWorkspace(workspaceName);
  context.replaceConfig(updated);
  return { text: `工作区「${workspaceName}」已删除` };
}

