import type { ChatRequest, ChatResponse, WechatAgent } from "./wechat-types";
import type { ChatRequestMetadata } from "./weixin/agent/interface";
import type { AppLogger } from "./logging/app-logger";
import { createNoopAppLogger } from "./logging/app-logger";
import { normalizeMediaArray } from "./channels/media-types.js";
import { isKnownWeacpxCommandText } from "./commands/command-list";
import type { ToolUseEvent } from "./channels/types.js";
import type { PerfSpan } from "./perf/perf-tracer";

interface RouterLike {
  handle(
    chatKey: string,
    input: string,
    reply?: (text: string) => Promise<void>,
    replyContextToken?: string,
    accountId?: string,
    media?: unknown,
    metadata?: ChatRequestMetadata,
    abortSignal?: AbortSignal,
    onToolEvent?: (event: ToolUseEvent) => void | Promise<void>,
    onThought?: (chunk: string) => void | Promise<void>,
    perfSpan?: PerfSpan,
  ): Promise<ChatResponse>;
  clearSession?: (chatKey: string) => Promise<void>;
}

export class ConsoleAgent implements WechatAgent {
  private readonly logger: AppLogger;

  constructor(private readonly router: RouterLike, logger?: AppLogger) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const media = normalizeMediaArray(request.media);
    const hasText = request.text.trim().length > 0;
    if (!hasText && media.length === 0) {
      return { text: "消息内容为空。" };
    }

    await this.logger.info("chat.received", "received inbound chat message", {
      chatKey: request.conversationId,
      kind: request.text.trim().startsWith("/") ? "command" : "prompt",
      text: summarizeText(request.text),
    });

    const promptMedia = media.length > 0 ? media.map((m) => ({
      type: (m.kind ?? m.type) as "image" | "audio" | "video" | "file",
      filePath: m.filePath,
      mimeType: m.mimeType,
      ...(m.fileName ? { fileName: m.fileName } : {}),
    })) : undefined;

    request.perfSpan?.mark("agent.dispatched");
    return await this.router.handle(
      request.conversationId,
      request.text,
      request.reply,
      request.replyContextToken,
      request.accountId,
      promptMedia,
      request.metadata,
      request.abortSignal,
      request.onToolEvent,
      request.onThought,
      request.perfSpan,
    );
  }

  isKnownCommand(text: string): boolean {
    return isKnownWeacpxCommandText(text);
  }

  async clearSession(conversationId: string): Promise<void> {
    await this.router.clearSession?.(conversationId);
  }
}

function summarizeText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 120) {
    return trimmed;
  }

  return `${trimmed.slice(0, 117)}...`;
}
