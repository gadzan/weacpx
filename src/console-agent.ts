import type { ChatRequest, ChatResponse, WechatAgent } from "./wechat-types";

interface RouterLike {
  handle(chatKey: string, input: string): Promise<ChatResponse>;
}

export class ConsoleAgent implements WechatAgent {
  constructor(private readonly router: RouterLike) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.text.trim()) {
      return { text: "Empty message." };
    }

    return await this.router.handle(request.conversationId, request.text);
  }
}
