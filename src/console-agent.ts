import type { ChatRequest, ChatResponse, WechatAgent } from "./wechat-types";
import type { AppLogger } from "./logging/app-logger";
import { createNoopAppLogger } from "./logging/app-logger";

interface RouterLike {
  handle(
    chatKey: string,
    input: string,
    reply?: (text: string) => Promise<void>,
    replyContextToken?: string,
    accountId?: string,
    media?: ChatRequest["media"],
  ): Promise<ChatResponse>;
  clearSession?: (chatKey: string) => Promise<void>;
}

export class ConsoleAgent implements WechatAgent {
  private readonly logger: AppLogger;

  constructor(private readonly router: RouterLike, logger?: AppLogger) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const hasText = request.text.trim().length > 0;
    if (!hasText && !request.media) {
      return { text: "消息内容为空。" };
    }
    if (request.media && request.media.type !== "image") {
      return {
        text: hasText
          ? "暂不支持处理该类型附件；请发送文字或图片。"
          : "暂不支持处理该类型消息，请发送文字或图片。",
      };
    }
    await this.logger.info("chat.received", "received inbound chat message", {
      chatKey: request.conversationId,
      kind: request.text.trim().startsWith("/") ? "command" : "prompt",
      text: summarizeText(request.text),
    });

    return await this.router.handle(
      request.conversationId,
      request.text,
      request.reply,
      request.replyContextToken,
      request.accountId,
      request.media,
    );
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
