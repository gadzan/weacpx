import type { Agent, ChatRequest, ChatResponse } from "../agent/interface.js";

export interface ExecuteChatTurnParams {
  agent: Agent;
  request: Omit<ChatRequest, "reply">;
  onReplySegment?: (text: string) => Promise<boolean | void>;
}

export interface ExecutedChatTurn {
  text?: string;
  media?: ChatResponse["media"];
  usedReply: boolean;
}

export async function executeChatTurn(params: ExecuteChatTurnParams): Promise<ExecutedChatTurn> {
  let usedReply = false;

  const response = await params.agent.chat({
    ...params.request,
    reply: async (text: string) => {
      const delivered = await params.onReplySegment?.(text);
      if (delivered !== false) {
        usedReply = true;
      }
    },
  });

  return {
    text: usedReply ? undefined : response.text,
    media: response.media,
    usedReply,
  };
}
