import type { AppLogger } from "../../logging/app-logger";
import type { ScheduledChannelMessageInput } from "../../channels/types";
import type { Agent } from "../agent/interface";
import { executeChatTurn } from "./execute-chat-turn";
import { chunkFinalText } from "./handle-weixin-message-turn";
import { buildFinalHeadsUp } from "./final-heads-up";
import type { PendingFinalChunk } from "./quota-manager";
import { markdownToPlainText, sendMessageWeixin } from "./send";
import { normalizeWeixinUserIdFromChatKey } from "./inbound";

export interface ScheduledTurnDeps {
  agent: Agent;
  listAccountIds: () => string[];
  resolveAccount: (accountId: string) => { accountId: string; baseUrl: string; token?: string };
  getContextToken: (accountId: string, userId: string) => string | undefined;
  reserveMidSegment: (chatKey: string) => boolean;
  reserveFinal: (chatKey: string) => boolean;
  finalRemaining?: (chatKey: string) => number;
  enqueuePendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
  sendMessage?: typeof sendMessageWeixin;
  logger: AppLogger;
}

export async function executeScheduledTurn(
  input: ScheduledChannelMessageInput,
  deps: ScheduledTurnDeps,
): Promise<void> {
  const userId = normalizeWeixinUserIdFromChatKey(input.chatKey);
  const quotaKey = userId;
  const sendMessage = deps.sendMessage ?? sendMessageWeixin;

  // 1. Send notice text
  const candidateAccountIds = input.accountId ? [input.accountId] : deps.listAccountIds();
  if (candidateAccountIds.length === 0) {
    throw new Error(`no weixin account is available for scheduled message on chatKey: ${input.chatKey}`);
  }

  let noticeSent = false;
  let lastNoticeError: unknown;
  let deliveryAccountId: string | undefined;
  let deliveryContextToken: string | undefined;

  const resolveContextToken = (candidateAccountId: string): string | undefined =>
    deps.getContextToken(candidateAccountId, userId) ??
    (candidateAccountId === input.accountId ? input.replyContextToken : undefined);

  for (const candidateAccountId of candidateAccountIds) {
    const contextToken = resolveContextToken(candidateAccountId);
    if (!contextToken) continue;

    const account = deps.resolveAccount(candidateAccountId);
    if (!account.token) continue;

    try {
      if (!deps.reserveMidSegment(quotaKey)) {
        throw new Error("mid segment quota exhausted");
      }
      await sendMessage({
        to: userId,
        text: input.noticeText,
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
      });
      noticeSent = true;
      deliveryAccountId = candidateAccountId;
      deliveryContextToken = contextToken;
      break;
    } catch (error) {
      lastNoticeError = error;
      await deps.logger.error(
        "scheduled.notice_send_failed",
        "failed to send scheduled notice",
        { chatKey: input.chatKey, accountId: candidateAccountId, error: String(error) },
      );
    }
  }

  if (!noticeSent) {
    const message = lastNoticeError instanceof Error
      ? lastNoticeError.message
      : `failed to send scheduled notice for chatKey: ${input.chatKey}`;
    throw new Error(message);
  }

  const sendReplySegment = async (text: string): Promise<boolean> => {
    const plainText = markdownToPlainText(text).trim();
    if (plainText.length === 0) return false;

    // Normal prompt streaming already goes through QuotaGatedReplySink before
    // it invokes this reply callback. Do not reserve mid quota again here.
    return await sendTextViaAvailableAccount(plainText, "scheduled.mid_send_failed");
  };

  const sendReservedMidText = async (text: string): Promise<boolean> => {
    const plainText = markdownToPlainText(text).trim();
    if (plainText.length === 0) return false;

    if (!deps.reserveMidSegment(quotaKey)) {
      await deps.logger.info(
        "scheduled.mid_dropped",
        "scheduled turn intermediate response dropped due to quota",
        { chatKey: input.chatKey, reason: "quota_exhausted" },
      );
      return false;
    }

    return await sendTextViaAvailableAccount(plainText, "scheduled.mid_send_failed");
  };

  // 2. Execute agent chat turn
  // Use the account/context that delivered the trigger notice for the agent turn.
  const resolvedAccountId = deliveryAccountId ?? input.accountId ?? candidateAccountIds[0]!;
  let turn: Awaited<ReturnType<typeof executeChatTurn>>;
  try {
    turn = await executeChatTurn({
      agent: deps.agent,
      request: {
        accountId: resolvedAccountId,
        conversationId: input.chatKey,
        text: input.promptText,
        ...(deliveryContextToken ? { replyContextToken: deliveryContextToken } : {}),
        metadata: { channel: "weixin", scheduledSessionAlias: input.sessionAlias },
      },
      onReplySegment: sendReplySegment,
    });
  } catch (error) {
    await sendReservedMidText(`定时任务执行失败：${error instanceof Error ? error.message : String(error)}`).catch(() => false);
    throw error;
  }

  // 3. Send final response through the same final quota/chunking model as
  // normal Weixin turns. Scheduled tasks do not have a fresh inbound message,
  // so this uses the context token that already delivered the trigger notice.
  if (turn.text) {
    const finalText = markdownToPlainText(turn.text).trim();
    if (finalText.length > 0) {
      await sendFinalText(finalText);
    }
  }

  async function sendFinalText(finalText: string): Promise<void> {
    const rawChunks = chunkFinalText(finalText, 1800);
    if (rawChunks.length === 0) return;

    const total = rawChunks.length;
    const chunks = total === 1
      ? rawChunks
      : rawChunks.map((body, index) => `(${index + 1}/${total}) ${body}`);
    const available = total === 1 ? 1 : Math.max(Math.min(deps.finalRemaining?.(quotaKey) ?? total, total), 0);
    const wave = chunks.slice(0, available);
    if (wave.length > 0 && wave.length < total) {
      wave[wave.length - 1] = `${wave[wave.length - 1]!}\n\n${buildFinalHeadsUp({
        total,
        sentSoFar: wave.length,
      })}`;
    }

    let sent = 0;
    for (let index = 0; index < wave.length; index += 1) {
      if (!deps.reserveFinal(quotaKey)) {
        await deps.logger.info(
          "scheduled.final_dropped",
          "scheduled turn final response dropped due to quota",
          { chatKey: input.chatKey, reason: "quota_exhausted", chunk: index + 1, total },
        );
        break;
      }

      const delivered = await sendTextViaAvailableAccount(wave[index]!, "scheduled.final_send_failed");
      if (!delivered) break;
      sent += 1;
    }

    const restToPark = chunks.slice(sent);
    if (total > 1 && restToPark.length > 0 && deps.enqueuePendingFinal) {
      const pending: PendingFinalChunk[] = restToPark.map((text, index) => {
        const entry: PendingFinalChunk = { text, seq: sent + index + 1, total };
        if (deliveryContextToken) entry.contextToken = deliveryContextToken;
        if (deliveryAccountId) entry.accountId = deliveryAccountId;
        return entry;
      });
      deps.enqueuePendingFinal(quotaKey, pending);
    }
  }

  async function sendTextViaAvailableAccount(text: string, errorEvent: string): Promise<boolean> {
    const orderedAccountIds = [
      ...(deliveryAccountId ? [deliveryAccountId] : []),
      ...candidateAccountIds.filter((accountId) => accountId !== deliveryAccountId),
    ];

    for (const candidateAccountId of orderedAccountIds) {
      const contextToken =
        candidateAccountId === deliveryAccountId && deliveryContextToken
          ? deliveryContextToken
          : resolveContextToken(candidateAccountId);
      if (!contextToken) continue;

      const account = deps.resolveAccount(candidateAccountId);
      if (!account.token) continue;

      try {
        await sendMessage({
          to: userId,
          text,
          opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
        });
        return true;
      } catch (error) {
        await deps.logger.error(
          errorEvent,
          "failed to send scheduled response text",
          { chatKey: input.chatKey, accountId: candidateAccountId, error: String(error) },
        );
      }
    }

    return false;
  }
}
