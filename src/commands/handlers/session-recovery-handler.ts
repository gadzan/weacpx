import type { ResolvedSession } from "../../transport/types";
import type { RouterResponse, SessionRecoveryOps } from "../router-types";
import { isPartialPromptOutputError, summarizeTransportError } from "../transport-diagnostics";
import { AutoInstallFailedError } from "../../recovery/errors";


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
  if (error instanceof AutoInstallFailedError) {
    const { original, steps, logPath } = error;
    const allVerifyFailed = steps.length > 0 && steps.every((s) => s.reason === "verify-failed");
    const headline = allVerifyFailed
      ? `⚠️ 自动安装已执行但未能修复会话启动问题`
      : `❌ 自动安装失败`;
    const stepLines = steps
      .map((s) => {
        const perStepPath = s.path ?? (s.scope === "precise" ? original.parentPackagePath : null);
        const label = s.scope === "precise"
          ? `精确${s.manager ? ` / ${s.manager}` : ""}${perStepPath ? ` / ${perStepPath}` : ""}`
          : "全局";
        if (s.reason === "verify-failed") {
          return `安装已执行但验证失败（${label}）：会话仍抛出缺失依赖错误`;
        }
        return `安装错误（${label}）：\n${s.stderrTail}`;
      })
      .join("\n\n");
    return {
      text: [
        headline,
        ``,
        `原始错误：`,
        original.rawMessage,
        ``,
        stepLines,
        ``,
        `请手动执行：npm install -g ${original.package}`,
        `详细日志：${logPath}`,
      ].join("\n"),
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("timed out") && message.includes("sessions new")) {
    return renderSessionCreationFailure(session, message);
  }

  throw error;
}

export function renderSessionCreationVerificationError(session: ResolvedSession): RouterResponse {
  return renderSessionCreationFailure(session, "未检测到可用的后端会话。");
}

function renderSessionCreationFailure(session: ResolvedSession, detail: string): RouterResponse {
  return {
    text: [
      "会话创建失败。",
      `错误信息：${summarizeTransportError(detail)}`,
      `如果你要先绑定一个已有会话，可以执行：/session attach ${session.alias} --agent ${session.agent} --ws ${session.workspace} --name <会话名>`,
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
