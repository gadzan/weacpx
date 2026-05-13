import type { YuanbaoChatType, YuanbaoInboundMessage, YuanbaoMsgBodyElement } from "./types.js";

export type YuanbaoInboundMediaKind = "image" | "file";

export interface YuanbaoInboundMediaCandidate {
  kind: YuanbaoInboundMediaKind;
  url: string;
  fileName?: string;
  /** Reported file size, if the IM payload included one. Use as a fast-path cap. */
  sizeHint?: number;
  /** Stable id we can use as `RuntimeMediaStore.sourceResourceId`. */
  sourceId?: string;
}

export interface YuanbaoExtractedContent {
  text: string;
  isAtBot: boolean;
  mentions: Array<{ text: string; userId?: string }>;
  placeholders: string[];
  mediaCandidates: YuanbaoInboundMediaCandidate[];
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

function bestImageEntry(elem: YuanbaoMsgBodyElement): { url: string; size?: number } | undefined {
  const images = elem.msg_content?.image_info_array;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const original = [...images].reverse().find((item) => typeof item.url === "string" && item.url.trim());
  if (!original?.url) return undefined;
  return { url: original.url, ...(typeof original.size === "number" ? { size: original.size } : {}) };
}

function bestImageUrl(elem: YuanbaoMsgBodyElement): string | undefined {
  return bestImageEntry(elem)?.url;
}

export function extractYuanbaoContent(msgBody: YuanbaoMsgBodyElement[] | undefined, botId?: string): YuanbaoExtractedContent {
  const textParts: string[] = [];
  const mentions: Array<{ text: string; userId?: string }> = [];
  const placeholders: string[] = [];
  const mediaCandidates: YuanbaoInboundMediaCandidate[] = [];
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
        const image = bestImageEntry(elem);
        if (image?.url) {
          const uuid = elem.msg_content?.uuid;
          const candidate: YuanbaoInboundMediaCandidate = { kind: "image", url: image.url };
          if (typeof image.size === "number" && Number.isFinite(image.size) && image.size > 0) candidate.sizeHint = image.size;
          if (typeof uuid === "string" && uuid.trim()) candidate.sourceId = uuid.trim();
          mediaCandidates.push(candidate);
        } else {
          placeholders.push("[image]");
        }
        break;
      }
      case "TIMFileElem": {
        const url = elem.msg_content?.url;
        const name = elem.msg_content?.file_name;
        if (typeof url === "string" && url.trim()) {
          const candidate: YuanbaoInboundMediaCandidate = { kind: "file", url: url.trim() };
          if (typeof name === "string" && name.trim()) candidate.fileName = name.trim();
          const size = elem.msg_content?.file_size;
          if (typeof size === "number" && Number.isFinite(size) && size > 0) candidate.sizeHint = size;
          const uuid = elem.msg_content?.uuid;
          if (typeof uuid === "string" && uuid.trim()) candidate.sourceId = uuid.trim();
          mediaCandidates.push(candidate);
        } else {
          placeholders.push(`[file${typeof name === "string" ? `: ${name}` : ""}]`);
        }
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
    mediaCandidates,
  };
}

export function inferYuanbaoChatType(raw: YuanbaoInboundMessage): YuanbaoChatType {
  return raw.group_code ? "group" : "direct";
}
