import type { ShortcutMessages } from "../../types";

export const shortcut: ShortcutMessages = {
  // handleSessionShortcutCommand — no config
  noConfig: "当前没有加载可写入的配置。",

  // agent not registered
  agentNotRegistered: (agent, hint) => `Agent「${agent}」未注册。${hint}`,
  agentNotRegisteredAvailable: (names) => `当前可用：${names}`,
  agentNotRegisteredNone: "当前没有已注册的 Agent，请先执行 /agent add <模板>",

  // reuse existing logical session
  reuseHeader: (display) => `已切换到会话「${display}」`,
  reuseWorkspace: (name) => `- 复用工作区：${name}`,
  reuseSession: (display) => `- 复用会话：${display}`,

  // new session created
  createdHeader: (display) => `已创建并切换到会话「${display}」`,
  createdNewWorkspace: (name, cwd) => `- 新增工作区：${name} -> ${cwd}`,
  createdReusedWorkspace: (name) => `- 复用工作区：${name}`,
  createdNewSession: (display) => `- 新增会话：${display}`,

  // renderShortcutSessionCreationError
  creationFailed: (alias) => `会话「${alias}」创建失败。`,
  creationFailedNewWorkspace: (name, cwd) => `- 已新增工作区：${name} -> ${cwd}`,
  creationFailedReusedWorkspace: (name) => `- 复用工作区：${name}`,
  creationFailedSession: "- 会话未创建，请重试。",

  // resolveShortcutWorkspace — workspace errors
  workspaceNotRegistered: (workspace, hint) => `工作区「${workspace}」未注册。${hint}`,
  workspaceAvailable: (names) => `当前可用：${names}`,
  workspaceNone: "当前没有已注册的工作区，请先执行 /ws new <名称> -d <路径>",
  workspacePathNotFound: (cwd) => `工作区路径不存在：${cwd}`,
};
