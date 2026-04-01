import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { normalize } from "node:path";

import { renderWorkspaces } from "../../formatting/render-text";
import type { CommandRouterContext, RouterResponse } from "../router-types";

export function handleWorkspaces(context: CommandRouterContext): RouterResponse {
  return { text: context.config ? renderWorkspaces(context.config) : "No config loaded." };
}

export async function handleWorkspaceCreate(
  context: CommandRouterContext,
  workspaceName: string,
  cwd: string,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const normalizedCwd = normalizePathForWorkspace(cwd);
  if (!(await pathExists(normalizedCwd))) {
    return { text: `工作区路径不存在：${cwd}` };
  }

  const updated = await context.configStore.upsertWorkspace(workspaceName, normalizedCwd);
  context.replaceConfig(updated);
  return { text: `工作区「${workspaceName}」已保存` };
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizePathForWorkspace(path: string): string {
  const expanded = path.startsWith("~") ? homedir() + path.slice(1) : path;
  return normalize(expanded);
}
