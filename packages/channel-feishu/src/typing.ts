import {
  isMessageUnavailable,
  markIfUnavailableError,
} from "./message-unavailable.js";

export interface FeishuReactionClient {
  im: {
    messageReaction?: {
      create(input: {
        path: { message_id: string };
        data: { reaction_type: { emoji_type: string } };
      }): Promise<{ data?: { reaction_id?: string } }>;
      delete(input: {
        path: { message_id: string; reaction_id: string };
      }): Promise<unknown>;
    };
  };
}

export interface TypingIndicatorState {
  messageId: string;
  reactionId: string | null;
}

const TYPING_EMOJI_TYPE = "Typing";

export async function addTypingIndicator(input: {
  client: FeishuReactionClient;
  messageId: string;
  accountId?: string;
}): Promise<TypingIndicatorState> {
  const state: TypingIndicatorState = { messageId: input.messageId, reactionId: null };
  const api = input.client.im.messageReaction;
  if (!api) return state;
  if (isMessageUnavailable(input.messageId, input.accountId)) return state;
  try {
    const response = await api.create({
      path: { message_id: input.messageId },
      data: { reaction_type: { emoji_type: TYPING_EMOJI_TYPE } },
    });
    state.reactionId = response?.data?.reaction_id ?? null;
  } catch (error) {
    markIfUnavailableError(input.messageId, error, input.accountId);
    // best-effort: a missing typing cue must not block message processing
  }
  return state;
}

export async function removeTypingIndicator(input: {
  client: FeishuReactionClient;
  state: TypingIndicatorState;
  accountId?: string;
}): Promise<void> {
  const api = input.client.im.messageReaction;
  if (!api || !input.state.reactionId) return;
  if (isMessageUnavailable(input.state.messageId, input.accountId)) return;
  try {
    await api.delete({
      path: { message_id: input.state.messageId, reaction_id: input.state.reactionId },
    });
  } catch (error) {
    markIfUnavailableError(input.state.messageId, error, input.accountId);
    // leftover reaction is acceptable; users can remove it manually or it disappears when the message is deleted
  }
}
