import type {
  CommandRouterContext,
  RouterResponse,
  SessionInteractionOps,
  SessionLifecycleOps,
  SessionRenderRecoveryOps,
} from "../router-types";
import type { PromptMedia, ResolvedSession } from "../../transport/types";
import type { WechatReplyMode } from "../../config/types";
import type { HelpTopicMetadata } from "../help/help-types";
import { buildCoordinatorPrompt } from "../../orchestration/build-coordinator-prompt";

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
    { usage: "/session rm <alias>", description: "删除逻辑会话" },
    { usage: "/use <alias>", description: "切换当前会话" },
    { usage: "/session reset 或 /clear", description: "重置当前会话上下文" },
  ],
  examples: ["/ss codex -d /absolute/path/to/repo", "/use backend-fix", "/session rm old-session", "/session reset"],
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
    { usage: "/replymode verbose", description: "当前会话流式回复并显示工具调用" },
    { usage: "/replymode final", description: "当前会话只发送最终文本" },
    { usage: "/replymode reset", description: "清除当前会话覆盖并回退到全局默认" },
  ],
  examples: ["/replymode", "/replymode final", "/replymode verbose"],
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
  const releaseTransportReservation = await context.lifecycle.reserveTransportSession(session.transportSession);
  try {
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
  } finally {
    await releaseTransportReservation();
  }
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
  const releaseTransportReservation = await context.lifecycle.reserveTransportSession(attached.transportSession);
  try {
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
  } finally {
    await releaseTransportReservation();
  }
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

  const globalDefault = context.config?.wechat.replyMode ?? "verbose";
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
  replyMode: "stream" | "final" | "verbose",
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
  const globalDefault = context.config?.wechat.replyMode ?? "verbose";
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
    const recovered = await context.recovery.tryRecoverMissingSession(session, error);
    if (recovered) {
      const result = await context.interaction.cancelTransportSession(recovered);
      return { text: result.message || "cancelled" };
    }
    return context.recovery.renderTransportError(session, error);
  }
}

export async function handleSessionReset(context: SessionHandlerContext, chatKey: string): Promise<RouterResponse> {
  return await context.lifecycle.resetCurrentSession(chatKey);
}

export async function handleSessionRemove(
  context: SessionHandlerContext,
  chatKey: string,
  alias: string,
): Promise<RouterResponse> {
  const session = await context.sessions.getSession(alias);
  if (!session) {
    return { text: `会话「${alias}」不存在。` };
  }

  if (context.orchestration) {
    const blocking = await context.orchestration.listSessionBlockingTasks(session.transportSession);
    if (blocking.length > 0) {
      return {
        text: [
          `会话「${alias}」下还有 ${blocking.length} 个未结束的任务，请先取消或等待完成。`,
          `使用 /tasks 查看任务列表，或 /task cancel <id> 取消任务。`,
        ].join("\n"),
      };
    }
  }

  const sharedAliasCount = context.sessions.countAliasesSharingTransport(session.transportSession, alias);
  const { wasActive } = await context.sessions.removeSession(alias);

  let orchestrationPurgeWarning: string | undefined;
  if (context.orchestration) {
    try {
      await context.orchestration.purgeSessionReferences(session.transportSession);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      orchestrationPurgeWarning = message;
      await context.logger.error("session.orchestration_purge_failed", "failed to purge orchestration references after logical remove", {
        alias,
        transportSession: session.transportSession,
        message,
      });
    }
  }

  let transportTeardownWarning: string | undefined;
  const shouldTeardownTransport = sharedAliasCount === 0;
  if (shouldTeardownTransport && context.transport.removeSession) {
    try {
      await context.transport.removeSession(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      transportTeardownWarning = message;
      await context.logger.error("session.transport_teardown_failed", "failed to close acpx session after logical remove", {
        alias,
        transportSession: session.transportSession,
        message,
      });
    }
  }
  await context.logger.info("session.removed", "removed logical session", {
    alias,
    sharedAliasCount,
    transportClosed: shouldTeardownTransport && transportTeardownWarning === undefined,
  });

  const lines = [`已删除会话「${alias}」。`];
  if (wasActive) {
    lines.push("该会话是当前活跃会话，已自动清除相关聊天上下文。");
  }
  if (!shouldTeardownTransport) {
    lines.push(`提示：后端会话「${session.transportSession}」仍被其他 ${sharedAliasCount} 个会话引用，未关闭。`);
  }
  if (orchestrationPurgeWarning) {
    lines.push(`提示：清理任务编排引用失败（${orchestrationPurgeWarning}），请稍后执行 /tasks clean 手动清理。`);
  }
  if (transportTeardownWarning) {
    lines.push(`提示：后端会话未能自动关闭（${transportTeardownWarning}），如有残留请手动执行 acpx sessions close。`);
  }
  return { text: lines.join("\n") };
}

async function promptWithSession(
  context: SessionHandlerContext,
  session: ResolvedSession,
  chatKey: string,
  text: string,
  reply?: (text: string) => Promise<void>,
  replyContextToken?: string,
  accountId?: string,
  media?: PromptMedia,
): Promise<RouterResponse> {
  const effectiveReplyMode = session.replyMode ?? context.config?.wechat.replyMode ?? "verbose";
  const transportReply = effectiveReplyMode !== "final" ? reply : undefined;
  if (context.orchestration) {
    try {
      await context.orchestration.recordCoordinatorRouteContext?.({
        coordinatorSession: session.transportSession,
        chatKey,
        ...(replyContextToken ? { replyContextToken } : {}),
        ...(accountId ? { accountId } : {}),
      });
    } catch (error) {
      await context.logger.error(
        "orchestration.coordinator_route_context.record_failed",
        "failed to record coordinator route context",
        {
          alias: session.alias,
          transportSession: session.transportSession,
          chatKey,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  const { promptText, taskIds, groupIds, claimHumanReply } = await preparePromptWithFallback(
    context,
    session,
    chatKey,
    text,
    replyContextToken,
    accountId,
  );
  try {
    const replyContext = transportReply && context.quota
      ? { chatKey, quota: context.quota }
      : undefined;
    const result = await context.interaction.promptTransportSession(
      session,
      promptText,
      transportReply,
      replyContext,
      media,
    );
    if (claimHumanReply) {
      try {
        await context.orchestration?.claimActiveHumanReply?.(claimHumanReply);
      } catch (error) {
        await context.logger.error(
          "orchestration.coordinator_reply_claim_failed",
          "failed to claim active human reply after prompt delivery",
          {
            alias: session.alias,
            transportSession: session.transportSession,
            chatKey,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    await markCoordinatorResultsInjected(context, taskIds, groupIds);
    // result.text in streaming/verbose mode is `overflow_summary + final
    // agent_message` from the transport — it's the final-tier message that
    // must reach the user via reserveFinal, NOT a duplicate of streamed
    // mid-segments. Returning it lets executeChatTurn surface it as turn.text
    // so handle-weixin-message-turn routes it through the final-message path.
    return { text: result.text };
  } catch (error) {
    await markCoordinatorResultsInjectionFailed(context, taskIds, groupIds, error);
    throw error;
  }
}

export async function handlePrompt(
  context: SessionHandlerContext,
  chatKey: string,
  text: string,
  reply?: (text: string) => Promise<void>,
  replyContextToken?: string,
  accountId?: string,
  media?: PromptMedia,
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  try {
    return await promptWithSession(context, session, chatKey, text, reply, replyContextToken, accountId, media);
  } catch (error) {
    const recovered = await context.recovery.tryRecoverMissingSession(session, error);
    if (recovered) {
      return await promptWithSession(context, recovered, chatKey, text, reply, replyContextToken, accountId, media);
    }
    return context.recovery.renderTransportError(session, error);
  }
}

async function preparePromptWithFallback(
  context: SessionHandlerContext,
  session: ResolvedSession,
  chatKey: string,
  text: string,
  replyContextToken?: string,
  accountId?: string,
): Promise<{
  promptText: string;
  taskIds: string[];
  groupIds: string[];
  claimHumanReply?: {
    coordinatorSession: string;
    chatKey: string;
    packageId: string;
    messageId: string;
    accountId?: string;
    replyContextToken?: string;
  };
}> {
  const orchestration = context.orchestration;
  if (!orchestration) {
    return { promptText: text, taskIds: [], groupIds: [] };
  }

  try {
    return await buildCoordinatorPrompt({
      orchestration,
      coordinatorSession: session.transportSession,
      chatKey,
      userText: text,
      ...(replyContextToken ? { replyContextToken } : {}),
      ...(accountId ? { accountId } : {}),
    });
  } catch (error) {
    await context.logger.error("orchestration.coordinator_results.load_failed", "failed to load coordinator results", {
      alias: session.alias,
      transportSession: session.transportSession,
      error: error instanceof Error ? error.message : String(error),
    });
    return { promptText: text, taskIds: [], groupIds: [] };
  }
}

async function markCoordinatorResultsInjected(
  context: SessionHandlerContext,
  taskIds: string[],
  groupIds: string[],
): Promise<void> {
  if ((taskIds.length === 0 && groupIds.length === 0) || !context.orchestration) {
    return;
  }

  try {
    if (groupIds.length > 0) {
      await context.orchestration.markCoordinatorGroupsInjected?.(groupIds);
    }
    if (taskIds.length > 0) {
      await context.orchestration.markTaskInjectionApplied(taskIds);
    }
  } catch (error) {
    await context.logger.error(
      "orchestration.coordinator_results.mark_failed",
      "failed to mark coordinator results injected",
      {
        taskIds: taskIds.join(","),
        groupIds: groupIds.join(","),
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function markCoordinatorResultsInjectionFailed(
  context: SessionHandlerContext,
  taskIds: string[],
  groupIds: string[],
  error: unknown,
): Promise<void> {
  if ((taskIds.length === 0 && groupIds.length === 0) || !context.orchestration) {
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  try {
    if (groupIds.length > 0) {
      await context.orchestration.markCoordinatorGroupsInjectionFailed?.(groupIds, errorMessage);
    }
    if (taskIds.length > 0) {
      await context.orchestration.markTaskInjectionFailed(taskIds, errorMessage);
    }
  } catch (markError) {
    await context.logger.error(
      "orchestration.coordinator_results.mark_failed",
      "failed to mark coordinator results injection failure",
      {
        taskIds: taskIds.join(","),
        groupIds: groupIds.join(","),
        error: markError instanceof Error ? markError.message : String(markError),
      },
    );
  }
}
