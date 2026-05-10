import type { FeishuMessageEvent } from "./types.js";
import type { FeishuResolvedAccountConfig } from "./config.js";

export function parseFeishuText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as { text?: unknown }).text === "string") {
      return (parsed as { text: string }).text;
    }
  } catch {
    // fall through
  }
  return raw;
}

export function buildFeishuConversationId(accountId: string, chatId: string, threadId?: string): string {
  return threadId ? `feishu:${accountId}:${chatId}:thread:${threadId}` : `feishu:${accountId}:${chatId}`;
}

export function parseFeishuConversationId(chatKey: string): { accountId: string; chatId: string; threadId?: string } | null {
  const parts = chatKey.split(":");
  if (parts[0] !== "feishu" || !parts[1] || !parts[2]) return null;
  if (parts[3] === "thread" && parts[4]) {
    return { accountId: parts[1], chatId: parts[2], threadId: parts.slice(4).join(":") };
  }
  return { accountId: parts[1], chatId: parts[2] };
}

export function shouldHandleFeishuMessage(input: {
  event: FeishuMessageEvent;
  botOpenId?: string;
  requireMention: boolean;
  parsedText?: string;
  allowMediaOnly?: boolean;
}): { handle: true; text: string } | { handle: false; reason: "no_mention" | "unsupported_type" } {
  const text = input.parsedText ?? parseFeishuText(input.event.message.content);
  if (input.event.message.message_type !== "text" && !input.allowMediaOnly && text.trim().length === 0) {
    return { handle: false, reason: "unsupported_type" };
  }

  // Group chats require mention (existing logic)
  if (input.event.message.chat_type !== "group" || !input.requireMention) {
    return { handle: true, text };
  }

  const botMention = input.event.message.mentions?.find((mention) => {
    return Boolean(input.botOpenId && mention.id.open_id === input.botOpenId);
  });
  if (!botMention) {
    return { handle: false, reason: "no_mention" };
  }

  const cleaned = text.replace(botMention.key, "").trim();
  return { handle: true, text: cleaned };
}

export type FeishuPolicyDecision =
  | { allow: true }
  | { allow: false; reason: "dm_disabled" | "group_disabled" | "sender_not_allowlisted" | "missing_sender_id" };

export function evaluateFeishuAccessPolicy(input: {
  event: FeishuMessageEvent;
  account: Pick<FeishuResolvedAccountConfig, "dmPolicy" | "groupPolicy" | "allowFrom">;
}): FeishuPolicyDecision {
  const senderOpenId = input.event.sender?.sender_id?.open_id;
  const isGroup = input.event.message.chat_type === "group";
  const policy = isGroup ? input.account.groupPolicy : input.account.dmPolicy;

  if (policy === "disabled") {
    return { allow: false, reason: isGroup ? "group_disabled" : "dm_disabled" };
  }
  if (policy === "open") {
    return { allow: true };
  }
  // allowlist
  if (!senderOpenId) return { allow: false, reason: "missing_sender_id" };
  if (input.account.allowFrom.includes("*")) return { allow: true };
  if (input.account.allowFrom.includes(senderOpenId)) return { allow: true };
  return { allow: false, reason: "sender_not_allowlisted" };
}
