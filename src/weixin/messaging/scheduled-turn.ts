import type { AppLogger } from "../../logging/app-logger";
import type { ScheduledChannelMessageInput } from "../../channels/types";
import type { Agent } from "../agent/interface";
import { executeChatTurn } from "./execute-chat-turn";
import { markdownToPlainText, sendMessageWeixin } from "./send";
import { normalizeWeixinUserIdFromChatKey, getContextToken } from "./inbound";
import { describeWeixinSendError } from "./send-errors";

export interface ScheduledTurnDeps {
  agent: Agent;
  listAccountIds: () => string[];
  resolveAccount: (accountId: string) => { accountId: string; baseUrl: string; token?: string };
  getContextToken: (accountId: string, userId: string) => string | undefined;
  reserveMidSegment: (chatKey: string) => boolean;
  reserveFinal: (chatKey: string) => boolean;
  sendMessage?: typeof sendMessageWeixin;
  logger: AppLogger;
}

export async function executeScheduledTurn(
  input: ScheduledChannelMessageInput,
  deps: ScheduledTurnDeps,
): Promise<void> {
  const userId = normalizeWeixinUserIdFromChatKey(input.chatKey);
  const sendMessage = deps.sendMessage ?? sendMessageWeixin;

  // 1. Send notice text
  const candidateAccountIds = input.accountId ? [input.accountId] : deps.listAccountIds();
  if (candidateAccountIds.length === 0) {
    throw new Error(`no weixin account is available for scheduled message on chatKey: ${input.chatKey}`);
  }

  let noticeSent = false;
  let lastNoticeError: unknown;

  for (const candidateAccountId of candidateAccountIds) {
    const contextToken =
      deps.getContextToken(candidateAccountId, userId) ??
      (candidateAccountId === input.accountId ? input.replyContextToken : undefined);
    if (!contextToken) continue;

    const account = deps.resolveAccount(candidateAccountId);
    if (!account.token) continue;

    try {
      if (!deps.reserveMidSegment(input.chatKey)) {
        throw new Error("mid segment quota exhausted");
      }
      await sendMessage({
        to: userId,
        text: input.noticeText,
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
      });
      noticeSent = true;
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

  // 2. Execute agent chat turn
  // Use the first successfully resolved account for the agent turn
  const resolvedAccountId = input.accountId ?? candidateAccountIds[0]!;
  const turn = await executeChatTurn({
    agent: deps.agent,
    request: {
      accountId: resolvedAccountId,
      conversationId: input.chatKey,
      text: input.promptText,
    },
  });

  // 3. Send final response through quota
  if (turn.text) {
    const finalText = markdownToPlainText(turn.text).trim();
    if (finalText.length > 0) {
      if (!deps.reserveFinal(input.chatKey)) {
        await deps.logger.info(
          "scheduled.final_dropped",
          "scheduled turn final response dropped due to quota",
          { chatKey: input.chatKey, reason: "quota_exhausted" },
        );
        return;
      }

      // Find context token for sending
      for (const candidateAccountId of candidateAccountIds) {
        const contextToken =
          deps.getContextToken(candidateAccountId, userId) ??
          (candidateAccountId === input.accountId ? input.replyContextToken : undefined);
        if (!contextToken) continue;

        const account = deps.resolveAccount(candidateAccountId);
        if (!account.token) continue;

        try {
          await sendMessage({
            to: userId,
            text: finalText,
            opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
          });
          return;
        } catch (error) {
          await deps.logger.error(
            "scheduled.final_send_failed",
            "failed to send scheduled final response",
            { chatKey: input.chatKey, accountId: candidateAccountId, error: String(error) },
          );
        }
      }
    }
  }
}
