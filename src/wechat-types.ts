export interface ChatRequest {
  conversationId: string;
  text: string;
}

export interface ChatResponse {
  text?: string;
}

export interface WechatAgent {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
