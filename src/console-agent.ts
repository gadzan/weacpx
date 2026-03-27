import type { ChatRequest, ChatResponse, WechatAgent } from "./wechat-types";
import type { AppLogger } from "./logging/app-logger";
import { createNoopAppLogger } from "./logging/app-logger";

interface RouterLike {
  handle(chatKey: string, input: string): Promise<ChatResponse>;
}

export class ConsoleAgent implements WechatAgent {
  private readonly logger: AppLogger;

  constructor(private readonly router: RouterLike, logger?: AppLogger) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.text.trim()) {
      return { text: "Empty message." };
    }

    await this.logger.info("chat.received", "received inbound chat message", {
      chatKey: request.conversationId,
      kind: request.text.trim().startsWith("/") ? "command" : "prompt",
      text: summarizeText(request.text),
    });

    return await this.router.handle(request.conversationId, request.text);
  }
}

function summarizeText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 120) {
    return trimmed;
  }

  return `${trimmed.slice(0, 117)}...`;
}
