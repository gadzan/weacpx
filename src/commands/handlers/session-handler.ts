import type {
  CommandRouterContext,
  RouterResponse,
  SessionInteractionOps,
  SessionLifecycleOps,
  SessionRenderRecoveryOps,
} from "../router-types";
import type { HelpTopicMetadata } from "../help/help-types";

export interface SessionHandlerContext extends CommandRouterContext {
  lifecycle: SessionLifecycleOps;
  interaction: SessionInteractionOps;
  recovery: SessionRenderRecoveryOps;
}

const NO_CURRENT_SESSION_TEXT = "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。";

export const sessionHelp: HelpTopicMetadata = {
  topic: "session",
  aliases: ["ss", "sessions"],
  summary: "创建、恢复、切换和重置逻辑会话。",
  commands: [
    { usage: "/sessions", description: "查看当前会话列表" },
    { usage: "/session 或 /ss", description: "查看会话列表" },
    { usage: "/ss <agent> (-d <path> | --ws <name>)", description: "快速新建或复用一个会话" },
    { usage: "/ss new <agent> (-d <path> | --ws <name>)", description: "强制新建会话" },
    { usage: "/ss new <alias> -a <name> --ws <name>", description: "按指定配置新建会话" },
    { usage: "/ss attach <alias> -a <name> --ws <name> --name <transport-session>", description: "绑定已有会话" },
    { usage: "/use <alias>", description: "切换当前会话" },
    { usage: "/session reset 或 /clear", description: "重置当前会话上下文" },
  ],
  examples: ["/ss codex -d /absolute/path/to/repo", "/use backend-fix", "/session reset"],
};

export const modeHelp: HelpTopicMetadata = {
  topic: "mode",
  aliases: [],
  summary: "查看或设置当前会话 mode。",
  commands: [
    { usage: "/mode", description: "查看当前会话已保存的 mode" },
    { usage: "/mode <id>", description: "设置当前会话 mode" },
  ],
  examples: ["/mode", "/mode plan"],
};

export const replyModeHelp: HelpTopicMetadata = {
  topic: "replymode",
  aliases: [],
  summary: "查看或设置当前逻辑会话的回复输出模式。",
  commands: [
    { usage: "/replymode", description: "查看全局默认、当前覆盖和实际生效值" },
    { usage: "/replymode stream", description: "当前会话使用流式回复" },
    { usage: "/replymode final", description: "当前会话只发送最终文本" },
    { usage: "/replymode reset", description: "清除当前会话覆盖并回退到全局默认" },
  ],
  examples: ["/replymode", "/replymode final"],
};

export const statusHelp: HelpTopicMetadata = {
  topic: "status",
  aliases: [],
  summary: "查看当前选中会话的状态。",
  commands: [{ usage: "/status", description: "查看当前会话状态" }],
  examples: ["/status"],
};

export const cancelHelp: HelpTopicMetadata = {
  topic: "cancel",
  aliases: ["stop"],
  summary: "取消当前会话里正在执行的任务。",
  commands: [
    { usage: "/cancel", description: "取消当前任务" },
    { usage: "/stop", description: "取消当前任务（/cancel 别名）" },
  ],
  examples: ["/cancel"],
};

export async function handleSessions(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const sessions = await context.sessions.listSessions(chatKey);
  if (sessions.length === 0) {
    return { text: "还没有会话。请先执行 /session new <alias> --agent <name> --ws <name>。" };
  }

  return {
    text: [
      "会话列表：",
      ...sessions.map((session) =>
        `- ${session.alias} (${session.agent} @ ${session.workspace})${session.isCurrent ? " [当前]" : ""}`,
      ),
    ].join("\n"),
  };
}

export async function handleSessionNew(
  context: SessionHandlerContext,
  chatKey: string,
  alias: string,
  agent: string,
  workspace: string,
): Promise<RouterResponse> {
  const session = context.lifecycle.resolveSession(alias, agent, workspace, `${workspace}:${alias}`);
  try {
    await context.lifecycle.ensureTransportSession(session);
    const exists = await context.lifecycle.checkTransportSession(session);
    if (!exists) {
      return context.recovery.renderSessionCreationVerificationError(session);
    }
  } catch (error) {
    return context.recovery.renderSessionCreationError(session, error);
  }

  await context.sessions.attachSession(alias, agent, workspace, session.transportSession);
  await context.lifecycle.refreshSessionTransportAgentCommand(alias);
  await context.sessions.useSession(chatKey, alias);
  await context.logger.info("session.created", "created and selected logical session", {
    alias,
    agent,
    workspace,
  });
  return { text: `会话「${alias}」已创建并切换` };
}

export async function handleSessionShortcut(
  context: SessionHandlerContext,
  chatKey: string,
  agent: string,
  target: { cwd?: string; workspace?: string },
  createNew: boolean,
): Promise<RouterResponse> {
  return await context.lifecycle.handleSessionShortcut(chatKey, agent, target, createNew);
}

export async function handleSessionAttach(
  context: SessionHandlerContext,
  chatKey: string,
  alias: string,
  agent: string,
  workspace: string,
  transportSession: string,
): Promise<RouterResponse> {
  const attached = context.lifecycle.resolveSession(alias, agent, workspace, transportSession);
  const exists = await context.lifecycle.checkTransportSession(attached);
  if (!exists) {
    return {
      text: [
        "没有找到可绑定的已有会话。",
        `请确认会话名是否正确，然后重新执行：/session attach ${alias} --agent ${agent} --ws ${workspace} --name <会话名>`,
      ].join("\n"),
    };
  }

  await context.sessions.attachSession(alias, agent, workspace, transportSession);
  await context.lifecycle.refreshSessionTransportAgentCommand(alias);
  await context.sessions.useSession(chatKey, alias);
  await context.logger.info("session.attached", "attached existing transport session", {
    alias,
    agent,
    workspace,
    transportSession,
  });
  return { text: `会话「${alias}」已绑定并切换` };
}

export async function handleSessionUse(
  context: SessionHandlerContext,
  chatKey: string,
  alias: string,
): Promise<RouterResponse> {
  await context.sessions.useSession(chatKey, alias);
  await context.logger.info("session.selected", "selected logical session", {
    alias,
    chatKey,
  });
  return { text: `已切换到会话「${alias}」` };
}

export async function handleModeShow(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  return {
    text: [
      "当前 mode：",
      `- 会话：${session.alias}`,
      `- mode：${session.modeId ?? "未设置"}`,
    ].join("\n"),
  };
}

export async function handleModeSet(
  context: SessionHandlerContext,
  chatKey: string,
  modeId: string,
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  await context.interaction.setModeTransportSession(session, modeId);
  await context.sessions.setCurrentSessionMode(chatKey, modeId);
  return { text: `已设置当前会话 mode：${modeId}` };
}

export async function handleReplyModeShow(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const globalDefault = context.config?.wechat.replyMode ?? "stream";
  const sessionOverride = session.replyMode;
  const effective = sessionOverride ?? globalDefault;

  return {
    text: [
      "当前 reply mode：",
      `- 会话：${session.alias}`,
      `- 全局默认：${globalDefault}`,
      `- 当前会话覆盖：${sessionOverride ?? "未设置"}`,
      `- 当前生效：${effective}`,
    ].join("\n"),
  };
}

export async function handleReplyModeSet(
  context: SessionHandlerContext,
  chatKey: string,
  replyMode: "stream" | "final",
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  await context.sessions.setCurrentSessionReplyMode(chatKey, replyMode);
  return { text: `已设置当前会话 reply mode：${replyMode}` };
}

export async function handleReplyModeReset(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  await context.sessions.setCurrentSessionReplyMode(chatKey, undefined);
  const globalDefault = context.config?.wechat.replyMode ?? "stream";
  return { text: `已重置当前会话 reply mode，当前回退到全局默认：${globalDefault}` };
}

export async function handleStatus(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  return {
    text: [
      "当前会话：",
      `- 名称：${session.alias}`,
      `- Agent：${session.agent}`,
      `- 工作区：${session.workspace}`,
    ].join("\n"),
  };
}

export async function handleCancel(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  try {
    const result = await context.interaction.cancelTransportSession(session);
    return { text: result.message || "cancelled" };
  } catch (error) {
    return context.recovery.renderTransportError(session, error);
  }
}

export async function handleSessionReset(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  return await context.lifecycle.resetCurrentSession(chatKey);
}

export async function handlePrompt(
  context: SessionHandlerContext,
  chatKey: string,
  text: string,
  reply?: (text: string) => Promise<void>,
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  try {
    const effectiveReplyMode = session.replyMode ?? context.config?.wechat.replyMode ?? "stream";
    const transportReply = effectiveReplyMode === "stream" ? reply : undefined;
    const result = await context.interaction.promptTransportSession(session, text, transportReply);
    return { text: result.text };
  } catch (error) {
    const recovered = await context.recovery.tryRecoverMissingSession(session, error);
    if (recovered) {
      const effectiveReplyMode = recovered.replyMode ?? context.config?.wechat.replyMode ?? "stream";
      const transportReply = effectiveReplyMode === "stream" ? reply : undefined;
      const result = await context.interaction.promptTransportSession(recovered, text, transportReply);
      return { text: result.text };
    }
    return context.recovery.renderTransportError(session, error);
  }
}
