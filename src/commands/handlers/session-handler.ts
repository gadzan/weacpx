import type {
  CommandRouterContext,
  RouterResponse,
  SessionInteractionOps,
  SessionLifecycleOps,
  SessionRenderRecoveryOps,
} from "../router-types";

export interface SessionHandlerContext extends CommandRouterContext {
  lifecycle: SessionLifecycleOps;
  interaction: SessionInteractionOps;
  recovery: SessionRenderRecoveryOps;
}

const NO_CURRENT_SESSION_TEXT = "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。";

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
  cwdInput: string,
  createNew: boolean,
): Promise<RouterResponse> {
  return await context.lifecycle.handleSessionShortcut(chatKey, agent, cwdInput, createNew);
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
    const result = await context.interaction.promptTransportSession(session, text, reply);
    return { text: result.text };
  } catch (error) {
    const recovered = await context.recovery.tryRecoverMissingSession(session, error);
    if (recovered) {
      const result = await context.interaction.promptTransportSession(recovered, text, reply);
      return { text: result.text };
    }
    return context.recovery.renderTransportError(session, error);
  }
}
