import type { ResolvedSession } from "../../transport/types";
import type { CommandRouterContext, RouterResponse, SessionResetOps } from "../router-types";
import { renderTransportError } from "./session-recovery-handler";


const NO_CURRENT_SESSION_TEXT = "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。";

export async function handleSessionResetCommand(
  context: CommandRouterContext,
  ops: SessionResetOps,
  chatKey: string,
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const resetSession = ops.resolveSession(
    session.alias,
    session.agent,
    session.workspace,
    buildResetTransportSessionName(session, ops.now()),
  );

  try {
    await ops.ensureTransportSession(resetSession);
    const exists = await ops.checkTransportSession(resetSession);
    if (!exists) {
      return {
        text: [
          `会话「${session.alias}」重置失败。`,
          "新的后端会话未创建成功，请稍后重试。",
        ].join("\n"),
      };
    }
  } catch (error) {
    return renderTransportError(resetSession, error);
  }

  await context.sessions.attachSession(
    resetSession.alias,
    resetSession.agent,
    resetSession.workspace,
    resetSession.transportSession,
  );
  await ops.refreshSessionTransportAgentCommand(resetSession.alias);
  await context.sessions.useSession(chatKey, resetSession.alias);
  await context.logger.info("session.reset", "reset current logical session", {
    alias: resetSession.alias,
    agent: resetSession.agent,
    workspace: resetSession.workspace,
    transportSession: resetSession.transportSession,
    chatKey,
  });

  return { text: `会话「${resetSession.alias}」已重置` };
}

function buildResetTransportSessionName(session: ResolvedSession, now: number): string {
  return `${session.workspace}:${session.alias}:reset-${now}`;
}
