import type { ChannelMediaAttachment, OutboundChannelMedia } from "../../channels/media-types.js";

/**
 * Agent interface — any AI backend that can handle a chat message.
 *
 * Implement this interface to connect WeChat to your own AI service.
 * The WeChat bridge calls `chat()` for each inbound message and sends
 * the returned response back to the user.
 */

export interface Agent {
  /** Process a single message and return a reply. */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Return true when the text begins with a command prefix handled by this agent. */
  isKnownCommand?(text: string): boolean;
  /** Clear/reset the session for a given conversation. */
  clearSession?(conversationId: string): void | Promise<void>;
}

export interface ChatRequest {
  /** Inbound Weixin account id that received this message. */
  accountId: string;
  /** Conversation / user identifier. Use this to maintain per-user context. */
  conversationId: string;
  /** Text content of the message. */
  text: string;
  /** Attached media file(s) (image, audio, video, or generic file). */
  media?: ChannelMediaAttachment | ChannelMediaAttachment[];
  /**
   * Optional callback for streaming text out during long-running agent
   * processing. When the channel delivers any non-empty reply segment,
   * callers may treat it as the text output channel for that turn and
   * suppress `ChatResponse.text`.
   */
  reply?: (text: string) => Promise<void>;
  /** Latest inbound Weixin context token for follow-up replies in the same chat. */
  replyContextToken?: string;
  /** Channel-provided facts for command authorization and routing policy. */
  metadata?: ChatRequestMetadata;
}

export interface ChatRequestMetadata {
  channel?: string;
  chatType?: "direct" | "group";
  senderId?: string;
  senderName?: string;
  groupId?: string;
  isOwner?: boolean;
}

export interface ChatResponse {
  /**
   * Final reply text when no streamed `reply()` output was delivered for
   * the same turn. May contain markdown and will be normalized before send.
   */
  text?: string;
  /** Reply media file(s). */
  media?: OutboundChannelMedia | OutboundChannelMedia[];
}
