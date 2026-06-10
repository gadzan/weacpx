import type { ChannelConfig, ChannelRuntimeConfig } from "../config/types";
import type { ChatRequestMetadata } from "../weixin/agent/interface";
import type { ParsedCommand } from "./parse-command";
import { t } from "../i18n/index.js";

export type CommandAccessDecision = { allowed: true } | { allowed: false; reason: string };

export type ChannelOwnerConfig = {
  channel?: Pick<ChannelConfig, "type" | "ownerIds">;
  channels?: Array<Pick<ChannelRuntimeConfig, "id" | "type" | "ownerIds">>;
};

/**
 * Collects the configured `ownerIds` for a channel. The built-in `channel`
 * entry matches by type; runtime `channels[]` entries match by type or id
 * (route metadata carries the channel type, but ids are accepted so a custom
 * id like "feishu-main" still resolves).
 */
export function resolveChannelOwnerIds(config: ChannelOwnerConfig | undefined, channel: string | undefined): string[] {
  if (!config || !channel) {
    return [];
  }
  const ids = new Set<string>();
  if (config.channel?.type === channel) {
    for (const id of config.channel.ownerIds ?? []) ids.add(id);
  }
  for (const entry of config.channels ?? []) {
    if (entry.type === channel || entry.id === channel) {
      for (const id of entry.ownerIds ?? []) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Computes the effective owner flag for a channel turn:
 * `isOwner === true` (channel-asserted) OR the sender id appears in the
 * channel's configured `ownerIds`. When ownerIds is configured for the
 * channel, the result is an EXPLICIT boolean so a stale `isOwner` on a
 * previously recorded coordinator route can never linger. When ownerIds is
 * not configured, the metadata passes through unchanged.
 */
export function withEffectiveOwner(
  metadata: ChatRequestMetadata | undefined,
  config: ChannelOwnerConfig | undefined,
): ChatRequestMetadata | undefined {
  if (!metadata?.channel) {
    return metadata;
  }
  const ownerIds = resolveChannelOwnerIds(config, metadata.channel);
  if (ownerIds.length === 0) {
    return metadata;
  }
  const isOwner =
    metadata.isOwner === true ||
    (typeof metadata.senderId === "string" && ownerIds.includes(metadata.senderId));
  return { ...metadata, isOwner };
}

const GROUP_PUBLIC_COMMAND_KINDS = new Set<ParsedCommand["kind"]>([
  "help",
  "agents",
  "workspaces",
  "sessions",
  "session.tail",
  "status",
  "mode.show",
  "replymode.show",
  "config.show",
  "permission.status",
  "permission.auto.status",
  "groups",
  "group.get",
  "tasks",
  "task.get",
  "later.help",
  "invalid",
  "prompt",
]);

export function authorizeCommandForChat(command: ParsedCommand, metadata?: ChatRequestMetadata): CommandAccessDecision {
  // Fail closed for real channel turns that violate the metadata contract:
  // a channel that identifies itself MUST report the chat type. Without it we
  // cannot tell group from direct, so privileged commands are denied. Two
  // kinds of internal callers keep the legacy allow-all behavior: turns with
  // no channel metadata at all (dry-run before it declared chatType, tests),
  // and internal scheduled dispatch turns (channel + scheduledSession* but no
  // chatType) whose authorization happened at task creation.
  const isInternalScheduledTurn = Boolean(
    metadata?.scheduledSessionAlias ?? metadata?.scheduledSessionDescriptor,
  );
  if (
    metadata?.channel &&
    !isInternalScheduledTurn &&
    metadata.chatType !== "direct" &&
    metadata.chatType !== "group"
  ) {
    if (GROUP_PUBLIC_COMMAND_KINDS.has(command.kind)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "chat-type-missing",
    };
  }

  if (metadata?.chatType !== "group") {
    return { allowed: true };
  }

  if (GROUP_PUBLIC_COMMAND_KINDS.has(command.kind)) {
    return { allowed: true };
  }

  if (metadata.isOwner) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "group-owner-required",
  };
}

const COMMAND_KIND_TO_LABEL: Record<string, string> = {
  "session.reset": "/clear",
  "session.rm": "/session rm",
  "session.tail": "/session tail",
  "replymode.set": "/replymode",
  "replymode.reset": "/replymode reset",
  "mode.set": "/mode",
  "permission.mode.set": "/permission",
  "permission.auto.set": "/permission auto",
  "config.set": "/config set",
  "agent.add": "/agent add",
  "agent.rm": "/agent rm",
  "workspace.new": "/workspace new",
  "workspace.rm": "/workspace rm",
  "delegate.request": "/delegate",
  "group.new": "/group new",
  "group.cancel": "/group cancel",
  "group.delegate": "/group",
  "tasks.clean": "/tasks clean",
  "task.approve": "/task approve",
  "task.reject": "/task reject",
  "task.cancel": "/task cancel",
  "session.use": "/use",
  "session.new": "/session new",
  "session.shortcut": "/session",
  "session.shortcut.new": "/session",
  "session.attach": "/session attach",
  "session.native.list": "/ssn",
  "session.native.select": "/ssn",
  "session.native.attach": "/ssn attach",
  "later.create": "/later",
  "later.list": "/later list",
  "later.cancel": "/later cancel",
};

export function renderCommandAccessDenied(command: ParsedCommand, reason?: string): string {
  if (reason === "chat-type-missing") {
    return [
      `⚠️ ${renderCommandLabel(command)}${t().misc.commandAccessDeniedChatTypeMissingSuffix}`,
      t().misc.commandAccessDeniedChatTypeMissingHint,
    ].join("\n");
  }
  return [
    `⚠️ ${renderCommandLabel(command)}${t().misc.commandAccessDeniedSuffix}`,
    t().misc.commandAccessDeniedHint,
  ].join("\n");
}

function renderCommandLabel(command: ParsedCommand): string {
  switch (command.kind) {
    case "prompt":
      return t().misc.commandLabelThisMessage;
    case "invalid":
      return command.recognizedCommand;
    default:
      return COMMAND_KIND_TO_LABEL[command.kind] ?? `/${command.kind.split(".")[0]}`;
  }
}
