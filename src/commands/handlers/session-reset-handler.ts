import type { ResolvedSession } from "../../transport/types";
import type { CommandRouterContext, RouterResponse, SessionResetOps } from "../router-types";
import { renderTransportError } from "./session-recovery-handler";
import { t } from "../../i18n/index.js";

export async function handleSessionResetCommand(
  context: CommandRouterContext,
  ops: SessionResetOps,
  chatKey: string,
): Promise<RouterResponse> {
  const session = await context.sessions.getCurrentSession(chatKey);
  if (!session) {
    return { text: t().misc.sessionResetNoCurrentSession };
  }

  const resetSession = ops.resolveSession(
    session.alias,
    session.agent,
    session.workspace,
    buildResetTransportSessionName(session, ops.now()),
  );

  const releaseTransportReservation = await ops.reserveTransportSession(resetSession.transportSession);
  try {
    try {
      await ops.ensureTransportSession(resetSession);
      const exists = await ops.checkTransportSession(resetSession);
      if (!exists) {
        return { text: t().misc.sessionResetFailed(session.alias) };
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
  } finally {
    await releaseTransportReservation();
  }

  return { text: t().misc.sessionResetSuccess(resetSession.alias) };
}

function buildResetTransportSessionName(session: ResolvedSession, now: number): string {
  return `${session.workspace}:${session.alias}:reset-${now}`;
}
