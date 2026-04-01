import type { ResolvedSession } from "../../transport/types";
import type { RouterResponse, SessionRecoveryOps } from "../router-types";
import { isPartialPromptOutputError, summarizeTransportError } from "../transport-diagnostics";


export function renderTransportError(session: ResolvedSession, error: unknown): RouterResponse {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("No acpx session found")) {
    return {
      text: [
        `当前会话「${session.alias}」暂时不可用。`,
        `请先在微信里重新执行：/session new ${session.alias} --agent ${session.agent} --ws ${session.workspace}`,
        `如果你要绑定一个已有会话，再执行：/session attach ${session.alias} --agent ${session.agent} --ws ${session.workspace} --name <会话名>`,
      ].join("\n"),
    };
  }

  if (!isPartialPromptOutputError(message)) {
    throw error;
  }

  return {
    text: [
      `当前会话「${session.alias}」执行中断，未收到最终回复。`,
      "请直接重试；如果长时间无响应，可先发送 /cancel 后再重试。",
      `错误信息：${summarizeTransportError(message)}`,
    ].join("\n"),
  };
}

export function renderSessionCreationError(session: ResolvedSession, error: unknown): RouterResponse {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("timed out") && message.includes("sessions new")) {
    return renderSessionCreationVerificationError(session);
  }

  throw error;
}

export function renderSessionCreationVerificationError(session: ResolvedSession): RouterResponse {
  return {
    text: [
      "当前还不能直接在微信里创建新会话。",
      `请先准备好一个已有会话，然后在微信里执行：/session attach ${session.alias} --agent ${session.agent} --ws ${session.workspace} --name <会话名>`,
    ].join("\n"),
  };
}

export async function tryRecoverMissingSession(
  ops: SessionRecoveryOps,
  session: ResolvedSession,
  error: unknown,
): Promise<ResolvedSession | null> {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("No acpx session found")) {
    return null;
  }

  const transportAgentCommand = await ops.resolveSessionAgentCommand(session);
  if (!transportAgentCommand || transportAgentCommand === session.agentCommand) {
    return null;
  }

  await ops.setSessionTransportAgentCommand(session.alias, transportAgentCommand);
  return await ops.getSession(session.alias);
}
