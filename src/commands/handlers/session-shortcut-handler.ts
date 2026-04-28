import { basenameForWorkspacePath, normalizeWorkspacePath, pathExists, sameWorkspacePath } from "../workspace-path";
import type { CommandRouterContext, RouterResponse, SessionShortcutOps } from "../router-types";
import { AutoInstallFailedError } from "../../recovery/errors";

interface ShortcutWorkspaceResolution {
  name: string;
  cwd: string;
  reused: boolean;
}


export async function handleSessionShortcutCommand(
  context: CommandRouterContext,
  ops: SessionShortcutOps,
  chatKey: string,
  agent: string,
  target: { cwd?: string; workspace?: string },
  createNew: boolean,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  if (!context.config.agents[agent]) {
    const agents = Object.keys(context.config.agents);
    const hint = agents.length > 0
      ? `当前可用：${agents.join("、")}`
      : "当前没有已注册的 Agent，请先执行 /agent add <模板>";
    return { text: `Agent「${agent}」未注册。${hint}` };
  }

  const workspace = await resolveShortcutWorkspace(context, target);
  if ("error" in workspace) {
    return { text: workspace.error };
  }
  await context.logger.info("session.shortcut.workspace", "resolved shortcut workspace", {
    workspace: workspace.name,
    cwd: workspace.cwd,
    reused: workspace.reused,
  });

  const baseAlias = `${workspace.name}:${agent}`;
  const alias = createNew ? await allocateUniqueSessionAlias(context, baseAlias, chatKey) : baseAlias;

  if (!createNew && (await hasLogicalSession(context, alias, chatKey))) {
    await context.sessions.useSession(chatKey, alias);
    await context.logger.info("session.shortcut.reused", "reused existing logical session", {
      alias,
      workspace: workspace.name,
      agent,
    });
    return {
      text: [
        `已切换到会话「${alias}」`,
        `- 复用工作区：${workspace.name}`,
        `- 复用会话：${alias}`,
      ].join("\n"),
    };
  }

  const session = ops.resolveSession(alias, agent, workspace.name, alias);
  try {
    await ops.ensureTransportSession(session);
    const exists = await ops.checkTransportSession(session);
    if (!exists) {
      return renderShortcutSessionCreationError(workspace, alias);
    }
  } catch (err) {
    if (err instanceof AutoInstallFailedError) throw err;
    return renderShortcutSessionCreationError(workspace, alias);
  }

  await context.sessions.attachSession(alias, agent, workspace.name, session.transportSession);
  await ops.refreshSessionTransportAgentCommand(alias);
  await context.sessions.useSession(chatKey, alias);
  await context.logger.info("session.shortcut.created", "created new logical session from shortcut", {
    alias,
    workspace: workspace.name,
    agent,
    workspaceReused: workspace.reused,
  });

  return {
    text: [
      `已创建并切换到会话「${alias}」`,
      workspace.reused ? `- 复用工作区：${workspace.name}` : `- 新增工作区：${workspace.name} -> ${workspace.cwd}`,
      `- 新增会话：${alias}`,
    ].join("\n"),
  };
}

async function resolveShortcutWorkspace(
  context: CommandRouterContext,
  target: { cwd?: string; workspace?: string },
): Promise<ShortcutWorkspaceResolution | { error: string }> {
  if (target.workspace) {
    const workspace = context.config?.workspaces[target.workspace];
    if (!workspace) {
      const workspaces = Object.keys(context.config?.workspaces ?? {});
      const hint = workspaces.length > 0
        ? `当前可用：${workspaces.join("、")}`
        : "当前没有已注册的工作区，请先执行 /ws new <名称> -d <路径>";
      return { error: `工作区「${target.workspace}」未注册。${hint}` };
    }

    return {
      name: target.workspace,
      cwd: workspace.cwd,
      reused: true,
    };
  }

  const cwdInput = target.cwd ?? "";
  const cwd = normalizeWorkspacePath(cwdInput);
  if (!(await pathExists(cwd))) {
    return { error: `工作区路径不存在：${cwdInput}` };
  }

  const existingByPath = Object.entries(context.config?.workspaces ?? {}).find(([, workspace]) =>
    sameWorkspacePath(workspace.cwd, cwd),
  );
  if (existingByPath) {
    return {
      name: existingByPath[0],
      cwd: existingByPath[1].cwd,
      reused: true,
    };
  }

  const workspaceName = allocateWorkspaceName(context, basenameForWorkspacePath(cwd));
  const updated = await context.configStore!.upsertWorkspace(workspaceName, cwd);
  context.replaceConfig(updated);

  return {
    name: workspaceName,
    cwd,
    reused: false,
  };
}

function allocateWorkspaceName(context: CommandRouterContext, baseName: string): string {
  if (!context.config?.workspaces[baseName]) {
    return baseName;
  }

  let suffix = 2;
  while (context.config.workspaces[`${baseName}-${suffix}`]) {
    suffix += 1;
  }

  return `${baseName}-${suffix}`;
}

async function allocateUniqueSessionAlias(
  context: CommandRouterContext,
  baseAlias: string,
  chatKey: string,
): Promise<string> {
  if (!(await hasLogicalSession(context, baseAlias, chatKey))) {
    return baseAlias;
  }

  let suffix = 2;
  while (await hasLogicalSession(context, `${baseAlias}-${suffix}`, chatKey)) {
    suffix += 1;
  }

  return `${baseAlias}-${suffix}`;
}

async function hasLogicalSession(context: CommandRouterContext, alias: string, chatKey: string): Promise<boolean> {
  const sessions = await context.sessions.listSessions(chatKey);
  return sessions.some((session) => session.alias === alias);
}

function renderShortcutSessionCreationError(
  workspace: ShortcutWorkspaceResolution,
  alias: string,
): RouterResponse {
  return {
    text: [
      `会话「${alias}」创建失败。`,
      workspace.reused ? `- 复用工作区：${workspace.name}` : `- 已新增工作区：${workspace.name} -> ${workspace.cwd}`,
      "- 会话未创建，请重试。",
    ].join("\n"),
  };
}

