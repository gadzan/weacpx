import crypto from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Agent, ChatRequest } from "../agent/interface.js";
import { sendTyping } from "../api/api.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType, TypingStatus } from "../api/types.js";
import { downloadRemoteImageToTemp } from "../cdn/upload.js";
import { downloadMediaFromItem } from "../media/media-download.js";
import { getExtensionFromMime } from "../media/mime.js";

import { setContextToken, bodyFromItemList, isMediaItem } from "./inbound.js";
import { sendWeixinErrorNotice } from "./error-notice.js";
import { sendWeixinMediaFile } from "./send-media.js";
import { markdownToPlainText, sendMessageWeixin } from "./send.js";
import { handleSlashCommand } from "./slash-commands.js";

export function resolveMediaTempDir(customRoot?: string): string {
  return customRoot ?? path.join(tmpdir(), "weacpx", "media");
}

function createSaveMediaBuffer(mediaTempDir?: string) {
  return async function saveMediaBuffer(
    buffer: Buffer,
    contentType?: string,
    subdir?: string,
    _maxBytes?: number,
    originalFilename?: string,
  ): Promise<{ path: string }> {
    const dir = path.join(resolveMediaTempDir(mediaTempDir), subdir ?? "");
    await fs.mkdir(dir, { recursive: true });
    let ext = ".bin";
    if (originalFilename) {
      ext = path.extname(originalFilename) || ".bin";
    } else if (contentType) {
      ext = getExtensionFromMime(contentType);
    }
    const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, buffer);
    return { path: filePath };
  };
}

export type ProcessMessageDeps = {
  accountId: string;
  agent: Agent;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  typingTicket?: string;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
  mediaTempDir?: string;
};

function extractTextBody(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

const hasDownloadableMedia = (media?: { encrypt_query_param?: string; full_url?: string }) =>
  media?.encrypt_query_param || media?.full_url;

function findMediaItem(itemList?: MessageItem[]): MessageItem | undefined {
  if (!itemList?.length) return undefined;

  const direct =
    itemList.find((item) => item.type === MessageItemType.IMAGE && hasDownloadableMedia(item.image_item?.media)) ??
    itemList.find((item) => item.type === MessageItemType.VIDEO && hasDownloadableMedia(item.video_item?.media)) ??
    itemList.find((item) => item.type === MessageItemType.FILE && hasDownloadableMedia(item.file_item?.media)) ??
    itemList.find(
      (item) =>
        item.type === MessageItemType.VOICE &&
        hasDownloadableMedia(item.voice_item?.media) &&
        !item.voice_item?.text,
    );
  if (direct) return direct;

  const refItem = itemList.find(
    (item) =>
      item.type === MessageItemType.TEXT &&
      item.ref_msg?.message_item &&
      isMediaItem(item.ref_msg.message_item),
  );
  return refItem?.ref_msg?.message_item ?? undefined;
}

export async function processOneMessage(
  full: WeixinMessage,
  deps: ProcessMessageDeps,
): Promise<void> {
  const receivedAt = Date.now();
  const textBody = extractTextBody(full.item_list);

  if (textBody.startsWith("/")) {
    const conversationId = full.from_user_id ?? "";
    const slashResult = await handleSlashCommand(
      textBody,
      {
        to: conversationId,
        contextToken: full.context_token,
        baseUrl: deps.baseUrl,
        token: deps.token,
        accountId: deps.accountId,
        log: deps.log,
        errLog: deps.errLog,
        onClear: () => deps.agent.clearSession?.(conversationId),
      },
      receivedAt,
      full.create_time_ms,
    );
    if (slashResult.handled) return;
  }

  const contextToken = full.context_token;
  if (contextToken) {
    setContextToken(deps.accountId, full.from_user_id ?? "", contextToken);
  }

  let media: ChatRequest["media"];
  const mediaItem = findMediaItem(full.item_list);
  if (mediaItem) {
    try {
      const downloaded = await downloadMediaFromItem(mediaItem, {
        cdnBaseUrl: deps.cdnBaseUrl,
        saveMedia: createSaveMediaBuffer(deps.mediaTempDir),
        log: deps.log,
        errLog: deps.errLog,
        label: "inbound",
      });
      if (downloaded.decryptedPicPath) {
        media = { type: "image", filePath: downloaded.decryptedPicPath, mimeType: "image/*" };
      } else if (downloaded.decryptedVideoPath) {
        media = { type: "video", filePath: downloaded.decryptedVideoPath, mimeType: "video/mp4" };
      } else if (downloaded.decryptedFilePath) {
        media = {
          type: "file",
          filePath: downloaded.decryptedFilePath,
          mimeType: downloaded.fileMediaType ?? "application/octet-stream",
        };
      } else if (downloaded.decryptedVoicePath) {
        media = {
          type: "audio",
          filePath: downloaded.decryptedVoicePath,
          mimeType: downloaded.voiceMediaType ?? "audio/wav",
        };
      }
    } catch (err) {
      deps.errLog(`media download failed: ${String(err)}`);
    }
  }

  const to = full.from_user_id ?? "";
  const reply = async (text: string): Promise<void> => {
    try {
      await sendMessageWeixin({
        to,
        text: markdownToPlainText(text),
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
      });
    } catch (err) {
      deps.errLog(`intermediate reply failed: ${String(err)}`);
    }
  };

  const request: ChatRequest = {
    conversationId: full.from_user_id ?? "",
    text: bodyFromItemList(full.item_list),
    media,
    reply,
  };

  let typingTimer: ReturnType<typeof setInterval> | undefined;
  const startTyping = () => {
    if (!deps.typingTicket) return;
    sendTyping({
      baseUrl: deps.baseUrl,
      token: deps.token,
      body: {
        ilink_user_id: to,
        typing_ticket: deps.typingTicket,
        status: TypingStatus.TYPING,
      },
    }).catch(() => {});
  };
  if (deps.typingTicket) {
    startTyping();
    typingTimer = setInterval(startTyping, 10_000);
  }

  try {
    const response = await deps.agent.chat(request);

    if (response.media) {
      let filePath: string;
      const mediaUrl = response.media.url;
      if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
        filePath = await downloadRemoteImageToTemp(
          mediaUrl,
          path.join(resolveMediaTempDir(deps.mediaTempDir), "outbound"),
        );
      } else {
        filePath = path.isAbsolute(mediaUrl) ? mediaUrl : path.resolve(mediaUrl);
      }
      await sendWeixinMediaFile({
        filePath,
        to,
        text: response.text ? markdownToPlainText(response.text) : "",
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
        cdnBaseUrl: deps.cdnBaseUrl,
      });
    } else if (response.text) {
      await sendMessageWeixin({
        to,
        text: markdownToPlainText(response.text),
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
      });
    }
  } catch (err) {
    const errorText = err instanceof Error ? err.stack ?? err.message : JSON.stringify(err);
    deps.errLog(`processOneMessage: agent or send failed: ${errorText}`);
    void sendWeixinErrorNotice({
      to,
      contextToken,
      message: `⚠️ 过程失败：${err instanceof Error ? err.message : JSON.stringify(err)}`,
      baseUrl: deps.baseUrl,
      token: deps.token,
      errLog: deps.errLog,
    });
  } finally {
    if (typingTimer) clearInterval(typingTimer);
    if (deps.typingTicket) {
      sendTyping({
        baseUrl: deps.baseUrl,
        token: deps.token,
        body: {
          ilink_user_id: to,
          typing_ticket: deps.typingTicket,
          status: TypingStatus.CANCEL,
        },
      }).catch(() => {});
    }
  }
}
