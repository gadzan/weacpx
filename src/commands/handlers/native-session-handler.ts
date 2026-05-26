import { resolveAgentCommand } from "../../config/resolve-agent-command";
import { getChannelIdFromChatKey, toDisplaySessionAlias } from "../../channels/channel-scope";
import type { AgentSession, AgentSessionListQuery, AgentSessionListResult, ResolvedSession } from "../../transport/types";
import { allocateWorkspaceName, sanitizeWorkspaceName } from "../workspace-name";
import { basenameForWorkspacePath, normalizeWorkspacePath, pathExists, sameWorkspacePath } from "../workspace-path";
import type { CommandRouterContext, RouterResponse, SessionLifecycleOps } from "../router-types";

export interface NativeSessionListCommand {
  agent?: string;
  cwd?: string;
  workspace?: string;
  all?: boolean;
  cursor?: string;
}

interface NativeTarget {
  agent: string;
  agentDisplayName: string;
  agentCommand?: string;
  workspace: string;
  workspaceLabel: string;
  cwd: string;
  source: "workspace" | "cwd";
}

interface CachedNativeSessionList {
  agent: string;
  workspace?: string;
  cwd: string;
  sessions: AgentSession[];
  nextCursor?: string | null;
}

interface NativeCandidateEntry {
  session: AgentSession;
  attached?: {
    alias: string;
    displayAlias: string;
    isCurrent: boolean;
  };
}

const NATIVE_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

export async function handleNativeSessionList(
  context: CommandRouterContext & { lifecycle: SessionLifecycleOps },
  chatKey: string,
  input: NativeSessionListCommand,
): Promise<RouterResponse> {
  const target = await resolveNativeTarget(context, chatKey, input);
  if (isRouterResponse(target)) {
    return target;
  }

  const listAgentSessions = context.transport.listAgentSessions?.bind(context.transport);
  if (!listAgentSessions) {
    return { text: "当前 transport 不支持列出本地会话，请继续使用 /ss。\n说明：/help ssn" };
  }

  const query: AgentSessionListQuery = {
    agent: target.agent,
    agentCommand: target.agentCommand,
    cwd: target.cwd,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.all ? {} : { filterCwd: target.cwd }),
  };

  let result: AgentSessionListResult | undefined;
  try {
    result = await listAgentSessions(query);
  } catch (error) {
    return { text: renderNativeListError(target, error) };
  }
  if (!result) {
    return { text: "当前 transport 不支持列出本地会话，请继续使用 /ss。\n说明：/help ssn" };
  }

  await context.sessions.cacheNativeSessionList(chatKey, {
    agent: target.agent,
    workspace: target.workspace,
    cwd: target.cwd,
    sessions: result.sessions,
    ...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
  });

  if (result.sessions.length === 0) {
    return {
      text: [
        `没有找到本地 ${target.agentDisplayName} 会话（${target.workspaceLabel}）。`,
        `你可以稍后再试，或先通过 /ss 保持当前逻辑会话。`,
      ].join("\n"),
    };
  }

  const explicitAttachTarget = Boolean(input.workspace || input.cwd);
  if (explicitAttachTarget && !input.all && !input.cursor && result.sessions.length === 1) {
    return await attachNativeSession(context, chatKey, target, result.sessions[0]!, undefined);
  }

  const attachedEntries = await buildAttachedEntries(context, chatKey, target.agent, result.sessions);
  const nativeSessionListOptions = { format: getChannelIdFromChatKey(chatKey) === "weixin" ? "cards" : "table" } as const;
  return {
    text: renderNativeSessionList(target, result, attachedEntries, Boolean(input.all), nativeSessionListOptions),
  };
}

export async function handleNativeSessionSelect(
  context: CommandRouterContext & { lifecycle: SessionLifecycleOps },
  chatKey: string,
  identifier: string,
  alias?: string,
): Promise<RouterResponse> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { text: "请选择要切换的 native 会话编号或 sessionId。\n说明：/help ssn" };
  }

  if (/^[0-9]+$/.test(trimmed)) {
    const cached = await context.sessions.getNativeSessionList(chatKey, NATIVE_SESSION_CACHE_TTL_MS);
    if (!cached || cached.sessions.length === 0) {
      return { text: "当前没有可用的 native 会话列表，请先执行 /ssn 再选择。\n说明：/help ssn" };
    }

    const index = Number(trimmed) - 1;
    const session = cached.sessions[index];
    if (!session) {
      return { text: "编号超出范围，请先执行 /ssn 重新获取列表。" };
    }

    const target = await resolveTargetFromCachedSession(context, chatKey, cached, session);
    if (isRouterResponse(target)) {
      return target;
    }

    return await attachNativeSession(context, chatKey, target, session, alias);
  }

  const target = await resolveNativeTarget(context, chatKey, {});
  if (isRouterResponse(target)) {
    return target;
  }
  return await attachNativeSession(context, chatKey, target, { sessionId: trimmed }, alias);
}

async function attachNativeSession(
  context: CommandRouterContext & { lifecycle: SessionLifecycleOps },
  chatKey: string,
  target: NativeTarget,
  session: AgentSession,
  alias?: string,
): Promise<RouterResponse> {
  if (!context.transport.resumeAgentSession) {
    return { text: "当前 transport 不支持接入本地会话，请继续使用 /ss。" };
  }

  const nativeTarget = target as NativeTarget;
  const existing = await context.sessions.findAttachedNativeSession(chatKey, nativeTarget.agent, session.sessionId);
  if (existing) {
    await context.sessions.useSession(chatKey, existing.alias);
    const displayAlias = toDisplaySessionAlias(existing.alias);
    return {
      text: `已切换到已接入的本地会话：${nativeTarget.agentDisplayName} · ${displayAlias}`,
    };
  }

  const requestedAlias = alias?.trim() || buildDefaultNativeAlias(nativeTarget.agent, session.sessionId);
  const displayAlias = await allocateUniqueNativeAlias(context, chatKey, requestedAlias);
  const internalAlias = scopeAliasForChannel(chatKey, displayAlias);
  const transportSession = context.sessions.buildDefaultTransportSessionForChat(chatKey, displayAlias);
  const resolvedSession = context.lifecycle.resolveSession(internalAlias, nativeTarget.agent, nativeTarget.workspace, transportSession);
  const releaseReservation = await context.lifecycle.reserveTransportSession(resolvedSession.transportSession);

  try {
    try {
      await context.transport.resumeAgentSession(resolvedSession, session.sessionId);
    } catch (error) {
      return { text: renderNativeResumeError(target, error) };
    }
    const verified = await context.lifecycle.checkTransportSession(resolvedSession);
    if (!verified) {
      return { text: `本地 ${target.agentDisplayName} 会话接入失败：未检测到已恢复的后端会话。` };
    }

    await context.sessions.attachNativeSession({
      alias: internalAlias,
      agent: nativeTarget.agent,
      workspace: nativeTarget.workspace,
      transportSession,
      ...(target.agentCommand ? { transportAgentCommand: target.agentCommand } : {}),
      agentSessionId: session.sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
    });
    await context.sessions.useSession(chatKey, internalAlias);
    await refreshAgentCommandBestEffort(context, internalAlias);

    return {
      text: `已接入本地 ${target.agentDisplayName} 会话并切换：${toDisplaySessionAlias(internalAlias)}`,
    };
  } finally {
    await releaseReservation();
  }
}

async function resolveNativeTarget(
  context: CommandRouterContext,
  chatKey: string,
  input: NativeSessionListCommand,
): Promise<NativeTarget | RouterResponse> {
  const currentSession = await context.sessions.getCurrentSession(chatKey);
  const agent = input.agent?.trim() || currentSession?.agent || "";
  if (!agent) {
    return {
      text: "请先选择上下文，例如：\n/ssn codex --ws project\n/ssn codex -d /Users/me/project\n说明：/help ssn",
    };
  }

  const agentConfig = context.config?.agents[agent];
  if (!agentConfig) {
    return { text: `Agent「${agent}」未注册。` };
  }

  const workspaceResolution = await resolveNativeWorkspace(context, input, currentSession);
  if (isRouterResponse(workspaceResolution)) {
    return workspaceResolution;
  }

  return {
    agent,
    agentDisplayName: displayAgentName(agent),
    agentCommand: resolveAgentCommand(agentConfig.driver, agentConfig.command),
    workspace: workspaceResolution.workspace,
    workspaceLabel: workspaceResolution.workspaceLabel,
    cwd: workspaceResolution.cwd,
    source: workspaceResolution.source,
  };
}

async function resolveTargetFromCachedSession(
  context: CommandRouterContext,
  chatKey: string,
  cached: CachedNativeSessionList,
  session: AgentSession,
): Promise<NativeTarget | RouterResponse> {
  if (session.cwd && !sameWorkspacePath(session.cwd, cached.cwd)) {
    return await resolveNativeTarget(context, chatKey, {
      agent: cached.agent,
      cwd: session.cwd,
    });
  }

  return await resolveNativeTarget(context, chatKey, {
    agent: cached.agent,
    ...(cached.workspace ? { workspace: cached.workspace } : { cwd: cached.cwd }),
  });
}

async function resolveNativeWorkspace(
  context: CommandRouterContext,
  input: NativeSessionListCommand,
  currentSession: ResolvedSession | null,
): Promise<{ workspace: string; workspaceLabel: string; cwd: string; source: "workspace" | "cwd" } | RouterResponse> {
  if (input.workspace) {
    const workspaceConfig = context.config?.workspaces[input.workspace];
    if (!workspaceConfig) {
      return { text: `工作区「${input.workspace}」未注册。` };
    }
    return {
      workspace: input.workspace,
      workspaceLabel: input.workspace,
      cwd: workspaceConfig.cwd,
      source: "workspace",
    };
  }

  if (input.cwd) {
    const cwd = normalizeWorkspacePath(input.cwd);
    const existing = Object.entries(context.config?.workspaces ?? {}).find(([, workspace]) => sameWorkspacePath(workspace.cwd, cwd));
    if (existing) {
      return {
        workspace: existing[0],
        workspaceLabel: existing[0],
        cwd: existing[1].cwd,
        source: "cwd",
      };
    }

    if (!(await pathExists(cwd))) {
      return { text: `工作区路径不存在：${input.cwd}` };
    }

    if (!context.configStore || !context.config) {
      return { text: "当前没有加载可写入的配置，无法根据路径创建工作区。" };
    }

    const workspaceName = allocateWorkspaceName(sanitizeWorkspaceName(basenameForWorkspacePath(cwd)), context.config.workspaces);
    const updated = await context.configStore.upsertWorkspace(workspaceName, cwd);
    context.replaceConfig(updated);
    return {
      workspace: workspaceName,
      workspaceLabel: workspaceName,
      cwd,
      source: "cwd",
    };
  }

  if (currentSession) {
    return {
      workspace: currentSession.workspace,
      workspaceLabel: currentSession.workspace,
      cwd: currentSession.cwd,
      source: "workspace",
    };
  }

  return {
    text: "请先选择上下文，例如：\n/ssn codex --ws project\n/ssn codex -d /Users/me/project\n说明：/help ssn",
  };
}

async function buildAttachedEntries(
  context: CommandRouterContext,
  chatKey: string,
  agent: string,
  sessions: AgentSession[],
): Promise<NativeCandidateEntry[]> {
  const currentSession = await context.sessions.getCurrentSession(chatKey);
  return await Promise.all(
    sessions.map(async (session) => {
      const attached = await context.sessions.findAttachedNativeSession(chatKey, agent, session.sessionId);
      if (!attached) {
        return { session };
      }
      return {
        session,
        attached: {
          alias: attached.alias,
          displayAlias: toDisplaySessionAlias(attached.alias),
          isCurrent: currentSession?.alias === attached.alias,
        },
      };
    }),
  );
}

function renderNativeSessionList(
  target: NativeTarget,
  result: AgentSessionListResult,
  entries: NativeCandidateEntry[],
  includeAll: boolean,
  options: { format?: "cards" | "table" } = {},
): string {
  if (options.format === "cards") {
    return renderNativeSessionCardList(target, result, entries, includeAll);
  }
  return renderNativeSessionTableList(target, result, entries, includeAll);
}

function renderNativeSessionTableList(
  target: NativeTarget,
  result: AgentSessionListResult,
  entries: NativeCandidateEntry[],
  includeAll: boolean,
): string {
  const lines = [`本地 ${target.agentDisplayName} 会话（${target.workspaceLabel}）：`];
  lines.push("| # | 标题 | 更新时间 | ID |");
  lines.push("|---|---|---|---|");
  entries.forEach((entry, index) => {
    const title = escapeMarkdownTableCell(renderNativeSessionTitle(entry.session.title, entry.session.sessionId));
    const updatedAt = entry.session.updatedAt ? formatNativeSessionTime(entry.session.updatedAt) : "-";
    const idParts: string[] = [entry.session.sessionId];
    if (entry.attached) {
      idParts.push(`已接入：${entry.attached.displayAlias}${entry.attached.isCurrent ? " [当前]" : ""}`);
    }
    lines.push(`| ${index + 1} | ${title} | ${escapeMarkdownTableCell(updatedAt)} | ${escapeMarkdownTableCell(idParts.join(" · "))} |`);
  });

  lines.push("");
  lines.push("操作：");
  lines.push("接入：/ssn 1");
  lines.push("指定别名：/ssn attach <sessionId> -a fix-ci");
  lines.push("说明：/help ssn");
  if (result.nextCursor) {
    lines.push(`更多：${renderNextPageCommand(target, result.nextCursor, includeAll)}`);
  }
  return lines.join("\n");
}

function renderNativeSessionCardList(
  target: NativeTarget,
  result: AgentSessionListResult,
  entries: NativeCandidateEntry[],
  includeAll: boolean,
): string {
  const lines = [
    `本地 ${target.agentDisplayName} 会话（${target.workspaceLabel}）：`,
    "回复编号接入，ID 尾号用于区分。",
  ];

  entries.forEach((entry, index) => {
    const title = renderNativeSessionTitle(entry.session.title, entry.session.sessionId);
    const updatedAt = entry.session.updatedAt ? formatNativeSessionTime(entry.session.updatedAt) : "-";
    lines.push("");
    lines.push(`【${index + 1}】 ${title}`);
    lines.push(`时间：${updatedAt}`);
    lines.push(`ID：${formatSessionIdTail(entry.session.sessionId)}`);
    if (entry.attached) {
      lines.push(`已接入：${entry.attached.displayAlias}${entry.attached.isCurrent ? " [当前]" : ""}`);
    }
  });

  lines.push("");
  lines.push("操作：");
  lines.push("接入：/ssn 1");
  lines.push("指定别名：/ssn attach <sessionId> -a fix-ci");
  lines.push("说明：/help ssn");
  if (result.nextCursor) {
    lines.push(`更多：${renderNextPageCommand(target, result.nextCursor, includeAll)}`);
  }
  return lines.join("\n");
}

function renderNativeSessionTitle(title: string | null | undefined, fallback: string): string {
  const normalized = (title?.trim() || fallback).replace(/\s+/g, " ");
  const maxLength = 60;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function buildDefaultNativeAlias(agent: string, sessionId: string): string {
  return `${agent}-${sessionIdTail(sessionId)}`;
}

function formatSessionIdTail(sessionId: string): string {
  const tail = sessionIdTail(sessionId);
  return tail.length < sessionId.trim().length ? `…${tail}` : tail;
}

function sessionIdTail(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return trimmed.slice(-8);
}

function formatNativeSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderNextPageCommand(target: NativeTarget, nextCursor: string, includeAll: boolean): string {
  const scope = target.source === "workspace" && target.workspace
    ? `--ws ${target.workspace}`
    : `-d ${target.cwd}`;
  const allFlag = includeAll ? " --all" : "";
  return `/ssn ${target.agent} ${scope}${allFlag} --cursor ${nextCursor}`;
}

async function allocateUniqueNativeAlias(
  context: CommandRouterContext,
  chatKey: string,
  baseDisplayAlias: string,
): Promise<string> {
  const visible = await context.sessions.listSessions(chatKey);
  const existing = new Set(visible.map((session) => session.internalAlias));
  const base = baseDisplayAlias.trim() || "native-session";
  const transportFor = (candidate: string) => context.sessions.buildDefaultTransportSessionForChat(chatKey, candidate);
  const isFree = (candidate: string) =>
    !existing.has(scopeAliasForChannel(chatKey, candidate)) &&
    context.sessions.countAliasesSharingTransport(transportFor(candidate)) === 0;

  if (isFree(base)) {
    return base;
  }

  let suffix = 2;
  while (!isFree(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

async function refreshAgentCommandBestEffort(
  context: CommandRouterContext & { lifecycle: SessionLifecycleOps },
  alias: string,
): Promise<void> {
  try {
    await context.lifecycle.refreshSessionTransportAgentCommand(alias);
  } catch (error) {
    await context.logger.error("session.native.agent_command_refresh_failed", "failed to refresh native session agent command", {
      alias,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function renderNativeListError(target: NativeTarget, error: unknown): string {
  return [
    `本地 ${target.agentDisplayName} 会话查询失败：${formatErrorMessage(error)}`,
    "请确认 acpx/Agent 支持 native 会话查询，或继续使用 /ss。",
    "说明：/help ssn",
  ].join("\n");
}

function renderNativeResumeError(target: NativeTarget, error: unknown): string {
  return [
    `本地 ${target.agentDisplayName} 会话接入失败：${formatErrorMessage(error)}`,
    "请确认 acpx/Agent 支持 native 会话恢复，或继续使用 /ss。",
    "说明：/help ssn",
  ].join("\n");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scopeAliasForChannel(chatKey: string, displayAlias: string): string {
  const channelId = getChannelIdFromChatKey(chatKey);
  const normalized = displayAlias.trim();
  return channelId === "weixin" ? normalized : `${channelId}:${normalized}`;
}

function isRouterResponse(value: RouterResponse | NativeTarget | { workspace: string; workspaceLabel: string; cwd: string; source: "workspace" | "cwd" }): value is RouterResponse {
  return typeof (value as RouterResponse).text === "string";
}

function displayAgentName(agent: string): string {
  if (!agent) {
    return agent;
  }
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}
