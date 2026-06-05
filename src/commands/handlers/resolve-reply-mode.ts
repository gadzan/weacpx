import { getChannelIdFromChatKey } from "../../channels/channel-scope";
import type { AppConfig, ReplyMode } from "../../config/types";

/**
 * The per-channel default reply mode declared on `channels[].replyMode`, or
 * `undefined` when the channel does not set one (so callers fall through to the
 * global default). The channel is derived from the chatKey the same way the rest
 * of the system scopes sessions.
 */
export function resolveChannelDefaultReplyMode(
  config: AppConfig | undefined,
  chatKey: string,
): ReplyMode | undefined {
  if (!config) return undefined;
  const channelId = getChannelIdFromChatKey(chatKey);
  return config.channels.find((channel) => channel.id === channelId)?.replyMode;
}

/**
 * Effective reply mode precedence:
 *   session override → per-channel default → global channel.replyMode → "verbose".
 */
export function resolveEffectiveReplyMode(
  config: AppConfig | undefined,
  chatKey: string,
  sessionOverride: ReplyMode | undefined,
): ReplyMode {
  return (
    sessionOverride ??
    resolveChannelDefaultReplyMode(config, chatKey) ??
    config?.channel.replyMode ??
    "verbose"
  );
}
