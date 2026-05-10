import crypto from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Agent, ChatRequest } from "../agent/interface.js";
import { sendTyping } from "../api/api.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType, TypingStatus } from "../api/types.js";
import {
  RuntimeMediaStore,
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE,
} from "../../channels/media-store.js";
import { resolveSafeOutboundMediaPath as resolveSafeMediaPath } from "../../channels/outbound-media-safety.js";
import { downloadMediaFromItem } from "../media/media-download.js";
import { getExtensionFromMime } from "../media/mime.js";

import { executeChatTurn } from "./execute-chat-turn.js";
import { buildFinalHeadsUp } from "./final-heads-up.js";
import { setContextToken, bodyFromItemList, extractWeixinMediaDescriptors } from "./inbound.js";
import { sendWeixinErrorNotice } from "./error-notice.js";
import { sendWeixinMediaFile } from "./send-media.js";
import { markdownToPlainText, sendMessageWeixin } from "./send.js";
import type { PendingFinalChunk } from "./quota-manager.js";
import { handleSlashCommand } from "./slash-commands.js";
import { normalizeMediaArray } from "../../channels/media-types.js";

// Conservative WeChat single-message text upper bound; leaves headroom for
// `(i/N) ` prefixes and the heads-up tail. WeChat's actual limit varies by
// client/version; 1800 bytes (~600 CJK characters) is well within all
// observed thresholds.
const MAX_FINAL_CHUNK_BYTES = 1800;

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// Splits a long final-text payload into <= maxBytes UTF-8 chunks. Tries
// paragraph (\n\n) → line (\n) → codepoint boundary in that order so the
// reading flow stays intact whenever the structure allows it. Each returned
// chunk is the raw payload — the (i/N) pagination prefix is added by the
// sender, not here.
export function chunkFinalText(text: string, maxBytes: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (utf8ByteLength(trimmed) <= maxBytes) return [trimmed];

  // Split into paragraph-units, each unit may itself need further splitting.
  const paragraphUnits: string[] = [];
  for (const para of trimmed.split(/\n{2,}/)) {
    if (para.length === 0) continue;
    if (utf8ByteLength(para) <= maxBytes) {
      paragraphUnits.push(para);
      continue;
    }
    // Paragraph too large: split by line.
    const lineUnits: string[] = [];
    let lineBuf = "";
    for (const line of para.split("\n")) {
      if (utf8ByteLength(line) > maxBytes) {
        if (lineBuf.length > 0) {
          lineUnits.push(lineBuf);
          lineBuf = "";
        }
        // Hard-cut by codepoint.
        for (const piece of hardCutByCodepoint(line, maxBytes)) {
          lineUnits.push(piece);
        }
        continue;
      }
      const candidate = lineBuf.length === 0 ? line : `${lineBuf}\n${line}`;
      if (utf8ByteLength(candidate) > maxBytes) {
        if (lineBuf.length > 0) lineUnits.push(lineBuf);
        lineBuf = line;
      } else {
        lineBuf = candidate;
      }
    }
    if (lineBuf.length > 0) lineUnits.push(lineBuf);
    for (const lu of lineUnits) paragraphUnits.push(lu);
  }

  // Greedily combine paragraph units into chunks ≤ maxBytes.
  const chunks: string[] = [];
  let buf = "";
  for (const unit of paragraphUnits) {
    if (buf.length === 0) {
      buf = unit;
      continue;
    }
    const candidate = `${buf}\n\n${unit}`;
    if (utf8ByteLength(candidate) > maxBytes) {
      chunks.push(buf);
      buf = unit;
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) chunks.push(buf);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

function hardCutByCodepoint(s: string, maxBytes: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const cp of s) {
    const candidate = buf + cp;
    if (utf8ByteLength(candidate) > maxBytes) {
      if (buf.length > 0) {
        out.push(buf);
        buf = cp;
      } else {
        // Single codepoint exceeds maxBytes (unlikely; max codepoint = 4
        // bytes). Emit it anyway to avoid an infinite loop.
        out.push(cp);
        buf = "";
      }
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

export function resolveMediaTempDir(customRoot?: string): string {
  return customRoot ?? path.join(tmpdir(), "weacpx", "media");
}


function createSaveMediaBuffer(mediaTempDir?: string) {
  return async function saveMediaBuffer(
    buffer: Buffer,
    contentType?: string,
    subdir?: string,
    maxBytes?: number,
    originalFilename?: string,
  ): Promise<{ path: string }> {
    if (maxBytes !== undefined && buffer.byteLength > maxBytes) {
      throw new Error(`media exceeds ${maxBytes} bytes`);
    }
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

export type HandleWeixinMessageTurnDeps = {
  accountId: string;
  agent: Agent;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  typingTicket?: string;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
  mediaTempDir?: string;
  onInbound?: (chatKey: string) => void;
  // v1.3: reserveFinal returns false when the per-chat final tier is
  // exhausted (FINAL_BUDGET reached). Callers MUST drop the send and log
  // when this happens; otherwise the WeChat send will be wasted past the
  // 10-message hard cap.
  reserveFinal?: (chatKey: string) => boolean;
  // v1.4: how many final-tier slots remain in the current inbound window.
  // Used to size the first wave of paginated final answers; the remainder is
  // parked via enqueuePendingFinal until the user replies `/jx`.
  finalRemaining?: (chatKey: string) => number;
  // v1.4: park leftover final chunks so the next `/jx` can drain the next
  // wave. Caller (run-console / monitor) wires this to QuotaManager.
  enqueuePendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
  // v1.4: pending-final inspection / drain accessors, plumbed into the slash
  // command context so `/jx` can pull the next wave.
  hasPendingFinal?: (chatKey: string) => boolean;
  drainPendingFinal?: (chatKey: string, available: number) => PendingFinalChunk[];
  prependPendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
  mediaStore?: RuntimeMediaStore;
  downloadMediaFromItemFn?: typeof downloadMediaFromItem;
  allowedMediaRoots?: string[];
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

function isClearSlashCommand(textBody: string): boolean {
  const trimmed = textBody.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  return command === "/clear";
}

export function getWeixinMessageTurnLane(full: WeixinMessage): "normal" | "control" {
  const textBody = extractTextBody(full.item_list).trim().toLowerCase();
  // /jx is the quota-refill ack: monitor's onInbound already reset the window
  // before lane dispatch, so the command itself is a no-op. Putting it on the
  // control lane avoids it sitting behind a long-running prompt on the normal
  // lane (where it would just consume a queue slot for a no-op).
  return textBody === "/cancel" || textBody === "/stop" || textBody === "/jx"
    ? "control"
    : "normal";
}

function buildWeixinChatKey(accountId: string, userId: string): string {
  return `weixin:${accountId}:${userId}`;
}

function defaultWeixinMime(kind: "image" | "file" | "audio" | "video"): string {
  if (kind === "image") return "image/*";
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/wav";
  return "application/octet-stream";
}

function appendAttachmentNotes(text: string, notes: string[]): string {
  if (notes.length === 0) return text;
  return [text, "", "Attachment notes:", ...notes.map((note) => `- ${note}`)].filter(Boolean).join("\n");
}

export async function handleWeixinMessageTurn(
  full: WeixinMessage,
  deps: HandleWeixinMessageTurnDeps,
): Promise<void> {
  const receivedAt = Date.now();
  const textBody = extractTextBody(full.item_list);
  const fromUserId = full.from_user_id ?? "";
  const to = full.from_user_id ?? "";
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  let typingStarted = false;
  const startTypingIndicator = () => {
    if (!deps.typingTicket || typingStarted) return;
    typingStarted = true;
    const sendTypingOnce = () => {
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
    sendTypingOnce();
    typingTimer = setInterval(sendTypingOnce, 10_000);
  };
  const stopTypingIndicator = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = undefined;
    }
    if (!typingStarted || !deps.typingTicket) return;
    typingStarted = false;
    sendTyping({
      baseUrl: deps.baseUrl,
      token: deps.token,
      body: {
        ilink_user_id: to,
        typing_ticket: deps.typingTicket,
        status: TypingStatus.CANCEL,
      },
    }).catch(() => {});
  };
  // Note: onInbound is fired by the SDK monitor before lane queueing so a user
  // reply during a long-running prompt resets the quota window immediately
  // rather than waiting for this turn to drain off the lane. The deps field
  // remains for direct unit testability of this function.

  const contextToken = full.context_token;
  if (contextToken) {
    setContextToken(deps.accountId, full.from_user_id ?? "", contextToken);
  }

  if (textBody.startsWith("/")) {
    const shouldTypeForSlash = isClearSlashCommand(textBody);
    if (shouldTypeForSlash) {
      startTypingIndicator();
    }
    const chatKey = buildWeixinChatKey(deps.accountId, full.from_user_id ?? "");
    try {
      const slashResult = await handleSlashCommand(
        textBody,
        {
          to,
          contextToken: full.context_token,
          baseUrl: deps.baseUrl,
          token: deps.token,
          accountId: deps.accountId,
          log: deps.log,
          errLog: deps.errLog,
          onClear: () => deps.agent.clearSession?.(chatKey),
          ...(deps.hasPendingFinal ? { hasPendingFinal: deps.hasPendingFinal } : {}),
          ...(deps.drainPendingFinal ? { drainPendingFinal: deps.drainPendingFinal } : {}),
          ...(deps.prependPendingFinal ? { prependPendingFinal: deps.prependPendingFinal } : {}),
          ...(deps.reserveFinal ? { reserveFinal: deps.reserveFinal } : {}),
          ...(deps.finalRemaining ? { finalRemaining: deps.finalRemaining } : {}),
        },
        receivedAt,
        full.create_time_ms,
      );
      if (slashResult.handled) return;
    } finally {
      if (shouldTypeForSlash) {
        stopTypingIndicator();
      }
    }
  }

  startTypingIndicator();

  const mediaStore = deps.mediaStore ?? new RuntimeMediaStore({ rootDir: resolveMediaTempDir(deps.mediaTempDir) });
  const media: NonNullable<ChatRequest["media"]> = [];
  const attachmentNotes: string[] = [];
  const descriptors = extractWeixinMediaDescriptors(full.item_list).slice(0, DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE);
  const download = deps.downloadMediaFromItemFn ?? downloadMediaFromItem;
  for (const descriptor of descriptors) {
    try {
      const downloaded = await download(descriptor.item, {
        cdnBaseUrl: deps.cdnBaseUrl,
        saveMedia: createSaveMediaBuffer(deps.mediaTempDir),
        log: deps.log,
        errLog: deps.errLog,
        label: "inbound",
      });
      const filePath = downloaded.decryptedPicPath ?? downloaded.decryptedVideoPath ?? downloaded.decryptedFilePath ?? downloaded.decryptedVoicePath;
      if (!filePath) {
        attachmentNotes.push(`Skipped ${descriptor.kind}: media was unavailable.`);
        continue;
      }
      try {
        const buffer = await fs.readFile(filePath);
        const mimeType = downloaded.fileMediaType ?? downloaded.voiceMediaType ?? defaultWeixinMime(descriptor.kind);
        media.push(await mediaStore.saveMediaBuffer({
          channelId: "weixin",
          accountId: deps.accountId,
          chatKey: buildWeixinChatKey(deps.accountId, full.from_user_id ?? ""),
          messageId: full.message_id ? String(full.message_id) : full.context_token ?? String(full.create_time_ms ?? Date.now()),
          fileName: descriptor.fileName,
          mimeType,
          kind: descriptor.kind,
          buffer,
          maxBytes: descriptor.kind === "image" ? DEFAULT_IMAGE_MAX_BYTES : DEFAULT_ATTACHMENT_MAX_BYTES,
        }));
      } finally {
        await fs.rm(filePath, { force: true }).catch(() => {});
      }
    } catch (err) {
      deps.errLog(`media download failed: ${String(err)}`);
      attachmentNotes.push(`Skipped ${descriptor.kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sendReplySegment = async (text: string): Promise<boolean> => {
    const plainText = markdownToPlainText(text).trim();
    if (plainText.length === 0) {
      return false;
    }

    try {
      await sendMessageWeixin({
        to,
        text: plainText,
        opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
      });
      return true;
    } catch (err) {
      deps.errLog(`intermediate reply failed: ${String(err)}`);
      return false;
    }
  };

  const requestText = appendAttachmentNotes(bodyFromItemList(full.item_list), attachmentNotes);
  const request: Omit<ChatRequest, "reply"> = {
    accountId: deps.accountId,
    conversationId: buildWeixinChatKey(deps.accountId, full.from_user_id ?? ""),
    text: requestText,
    ...(media.length > 0 ? { media } : {}),
    replyContextToken: contextToken,
  };

  try {
    const turn = await executeChatTurn({
      agent: deps.agent,
      request,
      onReplySegment: sendReplySegment,
    });

    // Text is sent first, then media items in sequence.
    const outboundMedia = normalizeMediaArray(turn.media);
    if (turn.text) {
      const finalText = markdownToPlainText(turn.text).trim();
      if (finalText.length > 0) {
        const rawChunks = chunkFinalText(finalText, MAX_FINAL_CHUNK_BYTES);
        if (rawChunks.length > 0) {
          const total = rawChunks.length;
          if (total === 1) {
            const reserved = deps.reserveFinal ? deps.reserveFinal(to) : true;
            if (!reserved) {
              deps.errLog(
                `weixin.final.dropped reason=quota_exhausted kind=text chatKey=${to}`,
              );
            } else {
              await sendMessageWeixin({
                to,
                text: rawChunks[0]!,
                opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
              });
            }
          } else {
            // v1.4: pre-format every chunk with its (k/N) prefix, send the first
            // wave (up to finalRemaining slots), park the rest in pending. If the
            // wave does not finish the answer, append a heads-up tail to the
            // wave's last chunk so the user knows to reply `/jx`.
            const prefixed = rawChunks.map((body, i) => `(${i + 1}/${total}) ${body}`);
            const available = deps.finalRemaining ? deps.finalRemaining(to) : total;
            const waveSize = Math.max(Math.min(available, total), 0);
            const wave = prefixed.slice(0, waveSize);
            const rest = prefixed.slice(waveSize);
            if (wave.length > 0 && rest.length > 0) {
              const sentSoFar = wave.length;
              wave[wave.length - 1] = `${wave[wave.length - 1]!}\n\n${buildFinalHeadsUp({
                total,
                sentSoFar,
              })}`;
            }
            let sent = 0;
            for (let i = 0; i < wave.length; i += 1) {
              const reserved = deps.reserveFinal ? deps.reserveFinal(to) : true;
              if (!reserved) {
                deps.errLog(
                  `weixin.final.dropped reason=quota_exhausted kind=text_paginated chatKey=${to} chunk=${i + 1}/${total}`,
                );
                break;
              }
              try {
                await sendMessageWeixin({
                  to,
                  text: wave[i]!,
                  opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
                });
                sent += 1;
              } catch (sendErr) {
                deps.errLog(
                  `weixin.final.dropped reason=send_failed kind=text_paginated chatKey=${to} chunk=${i + 1}/${total} err=${String(sendErr)}`,
                );
                break;
              }
            }
            const restToPark = prefixed.slice(sent);
            if (restToPark.length > 0 && deps.enqueuePendingFinal) {
              const pending: PendingFinalChunk[] = restToPark.map((text, idx) => {
                const seq = sent + idx + 1;
                const entry: PendingFinalChunk = { text, seq, total };
                if (contextToken !== undefined) entry.contextToken = contextToken;
                if (deps.accountId !== undefined) entry.accountId = deps.accountId;
                return entry;
              });
              deps.enqueuePendingFinal(to, pending);
            }
          }
        }
      }
    }
    for (const mediaItem of outboundMedia) {
      const filePath = await resolveSafeMediaPath(mediaItem.filePath, [mediaStore.rootDir, resolveMediaTempDir(deps.mediaTempDir), ...(deps.allowedMediaRoots ?? [])]);
      if (!filePath) {
        deps.errLog(`outbound media rejected: path=${mediaItem.filePath}`);
        continue;
      }
      const caption = mediaItem.caption ? markdownToPlainText(mediaItem.caption) : "";
      const captionReserve = caption && deps.reserveFinal ? deps.reserveFinal(to) : true;
      if (!captionReserve) {
        deps.errLog(
          `weixin.final.dropped reason=quota_exhausted kind=media_caption chatKey=${to}`,
        );
      }
      const reservedMedia = deps.reserveFinal ? deps.reserveFinal(to) : true;
      if (!reservedMedia) {
        deps.errLog(
          `weixin.final.dropped reason=quota_exhausted kind=media chatKey=${to}`,
        );
        continue;
      }
      try {
        await sendWeixinMediaFile({
          media: mediaItem,
          filePath,
          to,
          text: captionReserve ? caption : "",
          opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
          cdnBaseUrl: deps.cdnBaseUrl,
        });
      } catch (err) {
        deps.errLog(`outbound media send failed: ${String(err)}`);
      }
    }
  } catch (err) {
    const errorText = err instanceof Error ? err.stack ?? err.message : JSON.stringify(err);
    deps.errLog(`handleWeixinMessageTurn: agent or send failed: ${errorText}`);
    const reservedErr = deps.reserveFinal ? deps.reserveFinal(to) : true;
    if (!reservedErr) {
      deps.errLog(
        `weixin.final.dropped reason=quota_exhausted kind=error_notice chatKey=${to}`,
      );
    } else {
      void sendWeixinErrorNotice({
        to,
        contextToken,
        message: `⚠️ 过程失败：${err instanceof Error ? err.message : JSON.stringify(err)}`,
        baseUrl: deps.baseUrl,
        token: deps.token,
        errLog: deps.errLog,
      });
    }
  } finally {
    stopTypingIndicator();
  }
}
