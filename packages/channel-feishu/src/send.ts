import path from "node:path";
import type { FeishuSendResult } from "./types.js";
import type { OutboundChannelMedia } from "./media-types.js";
import { createReadStreamForFeishu, inferFeishuFileType, withFeishuTransientRetry, type FeishuMediaClient } from "./media.js";

export interface FeishuMessageClient {
  im: {
    message: {
      reply(input: {
        path: { message_id: string };
        data: { msg_type: "text"; content: string };
      }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
      create(input: {
        params: { receive_id_type: "chat_id" | "open_id" | "user_id" };
        data: { receive_id: string; msg_type: "text"; content: string };
      }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
    };
  };
}

export function normalizeFeishuTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("chat:")) return trimmed.slice("chat:".length);
  if (trimmed.startsWith("user:")) return trimmed.slice("user:".length);
  if (trimmed.startsWith("open_id:")) return trimmed.slice("open_id:".length);
  if (trimmed.startsWith("feishu:")) return trimmed.slice("feishu:".length);
  return trimmed;
}

export function resolveFeishuReceiveIdType(target: string): "chat_id" | "open_id" | "user_id" {
  const normalized = normalizeFeishuTarget(target);
  if (normalized.startsWith("oc_")) return "chat_id";
  if (normalized.startsWith("ou_")) return "open_id";
  return "open_id";
}

/**
 * Normalize common Feishu/Lark mention tag variants into the canonical text
 * message form. This is intentionally a pure, best-effort pass: it does not
 * resolve plain `@Name` because weacpx does not keep a per-chat member cache.
 */
export function normalizeFeishuOutboundMentionTags(text: string): string {
  let out = text;
  out = out.replace(
    /<at\s+(?:id|user_id|open_id)\s*=\s*["']?all["']?\s*>\s*<\/at>/gi,
    '<at user_id="all">Everyone</at>',
  );
  out = out.replace(
    /<at\s+(?:id|open_id|user_id)\s*=\s*["']?(ou_[A-Za-z0-9_-]+)["']?\s*>/gi,
    '<at user_id="$1">',
  );
  out = out.replace(/@(<at\s+user_id="ou_[A-Za-z0-9_-]+">[^<]*<\/at>)/g, "$1");
  return out;
}

export async function sendTextFeishu(input: {
  client: FeishuMessageClient;
  to: string;
  text: string;
  replyToMessageId?: string;
}): Promise<FeishuSendResult> {
  const content = JSON.stringify({ text: normalizeFeishuOutboundMentionTags(input.text) });

  if (input.replyToMessageId) {
    const response = await withFeishuTransientRetry(
      () => input.client.im.message.reply({
        path: { message_id: input.replyToMessageId },
        data: { msg_type: "text", content },
      }),
      "feishu.message.reply(text)",
    );
    return {
      messageId: response.data?.message_id ?? "",
      chatId: response.data?.chat_id ?? "",
    };
  }

  const target = normalizeFeishuTarget(input.to);
  const response = await withFeishuTransientRetry(
    () => input.client.im.message.create({
      params: { receive_id_type: resolveFeishuReceiveIdType(target) },
      data: { receive_id: target, msg_type: "text", content },
    }),
    "feishu.message.create(text)",
  );
  return {
    messageId: response.data?.message_id ?? "",
    chatId: response.data?.chat_id ?? "",
  };
}

export async function sendMediaFeishu(input: {
  client: FeishuMediaClient;
  to: string;
  media: OutboundChannelMedia;
  replyToMessageId?: string;
}): Promise<FeishuSendResult> {
  if (input.media.kind === "image") {
    const upload = await withFeishuTransientRetry(
      () => input.client.im.image!.create({
        data: { image_type: "message", image: createReadStreamForFeishu(input.media.filePath) },
      }),
      "feishu.image.create",
    );
    const imageKey = extractKey(upload, "image_key");
    if (!imageKey) throw new Error("Feishu image upload returned no image_key");
    return await sendRawMediaMessage(input.client, input.to, "image", JSON.stringify({ image_key: imageKey }), input.replyToMessageId);
  }

  const fileName = input.media.fileName ?? path.basename(input.media.filePath);
  const upload = await withFeishuTransientRetry(
    () => input.client.im.file!.create({
      data: {
        file_type: inferFeishuFileType(fileName),
        file_name: fileName,
        file: createReadStreamForFeishu(input.media.filePath),
      },
    }),
    "feishu.file.create",
  );
  const fileKey = extractKey(upload, "file_key");
  if (!fileKey) throw new Error("Feishu file upload returned no file_key");
  const msgType = input.media.kind === "audio" ? "audio" : input.media.kind === "video" ? "media" : "file";
  return await sendRawMediaMessage(input.client, input.to, msgType, JSON.stringify({ file_key: fileKey }), input.replyToMessageId);
}

async function sendRawMediaMessage(
  client: FeishuMediaClient,
  to: string,
  msgType: "image" | "file" | "audio" | "media",
  content: string,
  replyToMessageId?: string,
): Promise<FeishuSendResult> {
  if (replyToMessageId) {
    const response = await withFeishuTransientRetry(
      () => client.im.message!.reply({ path: { message_id: replyToMessageId }, data: { msg_type: msgType, content } }),
      `feishu.message.reply(${msgType})`,
    );
    return { messageId: response.data?.message_id ?? "", chatId: response.data?.chat_id ?? "" };
  }
  const target = normalizeFeishuTarget(to);
  const response = await withFeishuTransientRetry(
    () => client.im.message!.create({
      params: { receive_id_type: resolveFeishuReceiveIdType(target) },
      data: { receive_id: target, msg_type: msgType, content },
    }),
    `feishu.message.create(${msgType})`,
  );
  return { messageId: response.data?.message_id ?? "", chatId: response.data?.chat_id ?? "" };
}

function extractKey(upload: unknown, field: "image_key" | "file_key"): string | undefined {
  const rec = upload as Record<string, unknown> | null | undefined;
  if (!rec) return undefined;
  if (typeof rec[field] === "string") return rec[field];
  const data = rec.data as Record<string, unknown> | undefined;
  if (data && typeof data[field] === "string") return data[field];
  return undefined;
}
