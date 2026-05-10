import type { YuanbaoChatType, YuanbaoInboundMessage, YuanbaoMsgBodyElement } from "./types.js";

export interface YuanbaoExtractedContent {
  text: string;
  isAtBot: boolean;
  mentions: Array<{ text: string; userId?: string }>;
  placeholders: string[];
}

export interface ParsedYuanbaoChatKey {
  accountId: string;
  chatType: YuanbaoChatType;
  target: string;
}

export function buildYuanbaoChatKey(accountId: string, chatType: YuanbaoChatType, target: string): string {
  return `yuanbao:${accountId}:${chatType}:${target}`;
}

export function parseYuanbaoChatKey(chatKey: string): ParsedYuanbaoChatKey | null {
  const parts = chatKey.split(":");
  if (parts.length < 4 || parts[0] !== "yuanbao") return null;
  const accountId = parts[1];
  const chatType = parts[2];
  const target = parts.slice(3).join(":");
  if (!accountId || (chatType !== "direct" && chatType !== "group") || !target) return null;
  return { accountId, chatType, target };
}

function parseCustomMention(elem: YuanbaoMsgBodyElement): { text: string; userId?: string } | null {
  const data = elem.msg_content?.data;
  if (typeof data !== "string" || !data.trim()) return null;
  try {
    const parsed = JSON.parse(data) as { elem_type?: number; text?: unknown; user_id?: unknown };
    if (parsed.elem_type !== 1002) return null;
    const text = typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.trim() : undefined;
    const userId = typeof parsed.user_id === "string" && parsed.user_id.trim() ? parsed.user_id.trim() : undefined;
    if (!text && !userId) return null;
    return { text: text ?? `@${userId}`, userId };
  } catch {
    return null;
  }
}

function bestImageUrl(elem: YuanbaoMsgBodyElement): string | undefined {
  const images = elem.msg_content?.image_info_array;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  return [...images].reverse().find((item) => typeof item.url === "string" && item.url.trim())?.url;
}

export function extractYuanbaoContent(msgBody: YuanbaoMsgBodyElement[] | undefined, botId?: string): YuanbaoExtractedContent {
  const textParts: string[] = [];
  const mentions: Array<{ text: string; userId?: string }> = [];
  const placeholders: string[] = [];
  let isAtBot = false;

  for (const elem of msgBody ?? []) {
    switch (elem.msg_type) {
      case "TIMTextElem": {
        const text = elem.msg_content?.text;
        if (typeof text === "string" && text.trim()) textParts.push(text.trim());
        break;
      }
      case "TIMCustomElem": {
        const mention = parseCustomMention(elem);
        if (mention) {
          mentions.push(mention);
          if (botId && mention.userId === botId) isAtBot = true;
        }
        break;
      }
      case "TIMImageElem": {
        const url = bestImageUrl(elem);
        placeholders.push(url ? `[image: ${url}]` : "[image]");
        break;
      }
      case "TIMFileElem": {
        const name = elem.msg_content?.file_name;
        const url = elem.msg_content?.url;
        placeholders.push(`[file${typeof name === "string" ? `: ${name}` : ""}${typeof url === "string" ? ` ${url}` : ""}]`);
        break;
      }
      case "TIMSoundElem":
        placeholders.push("[audio]");
        break;
      case "TIMVideoFileElem":
        placeholders.push("[video]");
        break;
      case "TIMFaceElem":
        placeholders.push("[emoji]");
        break;
      default:
        break;
    }
  }

  return {
    text: [...textParts, ...placeholders].join("\n").trim(),
    isAtBot,
    mentions,
    placeholders,
  };
}

export function inferYuanbaoChatType(raw: YuanbaoInboundMessage): YuanbaoChatType {
  return raw.group_code ? "group" : "direct";
}
