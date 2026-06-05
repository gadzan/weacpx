import type {
  AppConfig,
  LoggingLevel,
  NonInteractivePermissions,
  PermissionMode,
  ReplyMode,
} from "../../config/types";
import { isLocale } from "../../i18n/resolve-locale";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";
import { cloneAppConfig } from "../config-clone";
import { t } from "../../i18n";

const SUPPORTED_CONFIG_PATHS = [
  "language",
  "transport.type",
  "transport.command",
  "transport.sessionInitTimeoutMs",
  "transport.permissionMode",
  "transport.nonInteractivePermissions",
  "transport.permissionPolicy",
  "logging.level",
  "logging.maxSizeBytes",
  "logging.maxFiles",
  "logging.retentionDays",
  "channel.replyMode",
  "channels.<id>.replyMode",
  "agents.<name>.driver",
  "agents.<name>.command",
  "workspaces.<name>.cwd",
  "workspaces.<name>.description",
] as const;

function getLegacyConfigPaths(): string[] {
  const c = t().config;
  return [c.legacyWechatReplyMode, c.legacyChannelType, c.legacyChannels];
}

export function configHelp(): HelpTopicMetadata {
  const c = t().config;
  return {
    topic: "config",
    aliases: [],
    summary: c.helpSummary,
    commands: [
      { usage: c.helpCmdShow, description: c.helpCmdShowDesc },
      { usage: c.helpCmdSet, description: c.helpCmdSetDesc },
    ],
    examples: ["/config set channel.replyMode final", "/config set logging.level debug"],
  };
}

export function handleConfigShow(context: CommandRouterContext): RouterResponse {
  const c = t().config;
  const lines = [c.showSupportedHeader, ...SUPPORTED_CONFIG_PATHS.map((path) => `- ${path}`)];

  lines.push("", c.showLegacyHeader, ...getLegacyConfigPaths().map((path) => `- ${path}`));

  if (context.config) {
    lines.push("", c.showExamplesHeader, "- /config set channel.replyMode final", "- /config set logging.level debug");
  }

  return { text: lines.join("\n") };
}

export async function handleConfigSet(
  context: CommandRouterContext,
  path: string,
  rawValue: string,
): Promise<RouterResponse> {
  const c = t().config;
  if (!context.config || !context.configStore) {
    return { text: c.noWritableConfig };
  }

  const previous = cloneAppConfig(context.config);
  const updated = cloneAppConfig(context.config);
  const result = applySupportedConfigUpdate(updated, path, rawValue);
  if ("error" in result) {
    return { text: result.error };
  }

  await context.configStore.save(updated);
  if (path === "transport.permissionMode" || path === "transport.nonInteractivePermissions" || path === "transport.permissionPolicy") {
    try {
      await context.transport.updatePermissionPolicy?.(updated.transport);
    } catch (error) {
      await context.configStore.save(previous);
      context.replaceConfig(previous);
      throw error;
    }
  }
  context.replaceConfig(updated);
  return { text: c.updated(path, result.renderedValue) };
}

function applySupportedConfigUpdate(
  config: AppConfig,
  path: string,
  rawValue: string,
): { renderedValue: string } | { error: string } {
  const c = t().config;
  switch (path) {
    case "language": {
      if (!isLocale(rawValue)) return { error: c.languageInvalid };
      config.language = rawValue;
      return { renderedValue: rawValue };
    }
    case "transport.type": {
      const parsed = parseEnum(rawValue, ["acpx-cli", "acpx-bridge"]);
      if (!parsed) return { error: c.transportTypeInvalid };
      config.transport.type = parsed;
      return { renderedValue: parsed };
    }
    case "transport.command":
      if (!rawValue.trim()) return { error: c.transportCommandEmpty };
      config.transport.command = rawValue;
      return { renderedValue: rawValue };
    case "transport.sessionInitTimeoutMs": {
      const parsed = parsePositiveNumber(rawValue, "transport.sessionInitTimeoutMs");
      if ("error" in parsed) return parsed;
      config.transport.sessionInitTimeoutMs = parsed.value;
      return { renderedValue: String(parsed.value) };
    }
    case "transport.permissionMode": {
      const parsed = parseEnum<PermissionMode>(rawValue, ["approve-all", "approve-reads", "deny-all"]);
      if (!parsed) return { error: c.transportPermissionModeInvalid };
      config.transport.permissionMode = parsed;
      return { renderedValue: parsed };
    }
    case "transport.nonInteractivePermissions": {
      const parsed = parseEnum<NonInteractivePermissions>(rawValue, ["deny", "fail"]);
      if (!parsed) return { error: c.transportNonInteractiveInvalid };
      config.transport.nonInteractivePermissions = parsed;
      return { renderedValue: parsed };
    }
    case "transport.permissionPolicy":
      if (!rawValue.trim()) return { error: c.transportPermissionPolicyEmpty };
      config.transport.permissionPolicy = rawValue;
      return { renderedValue: rawValue };
    case "logging.level": {
      const parsed = parseEnum<LoggingLevel>(rawValue, ["error", "info", "debug"]);
      if (!parsed) return { error: c.loggingLevelInvalid };
      config.logging.level = parsed;
      return { renderedValue: parsed };
    }
    case "logging.maxSizeBytes": {
      const parsed = parsePositiveNumber(rawValue, "logging.maxSizeBytes");
      if ("error" in parsed) return parsed;
      config.logging.maxSizeBytes = parsed.value;
      return { renderedValue: String(parsed.value) };
    }
    case "logging.maxFiles": {
      const parsed = parsePositiveNumber(rawValue, "logging.maxFiles");
      if ("error" in parsed) return parsed;
      config.logging.maxFiles = parsed.value;
      return { renderedValue: String(parsed.value) };
    }
    case "logging.retentionDays": {
      const parsed = parsePositiveNumber(rawValue, "logging.retentionDays");
      if ("error" in parsed) return parsed;
      config.logging.retentionDays = parsed.value;
      return { renderedValue: String(parsed.value) };
    }
    case "channel.type":
      return { error: c.channelTypeDisabled };
    case "channel.replyMode": {
      const parsed = parseEnum<ReplyMode>(rawValue, ["stream", "final", "verbose"]);
      if (!parsed) return { error: c.channelReplyModeInvalid };
      config.channel.replyMode = parsed;
      return { renderedValue: parsed };
    }
    case "wechat.replyMode": {
      const parsed = parseEnum<ReplyMode>(rawValue, ["stream", "final", "verbose"]);
      if (!parsed) return { error: c.wechatReplyModeInvalid };
      config.channel.replyMode = parsed;
      return {
        renderedValue: c.wechatReplyModeMapped(parsed),
      };
    }
  }

  const agentMatch = path.match(/^agents\.([^.]+)\.(driver|command)$/);
  if (agentMatch) {
    const [, name, field] = agentMatch;
    if (!name || !field) {
      return { error: c.pathNotSupported(path) };
    }
    const agent = config.agents[name];
    if (!agent) {
      return { error: c.agentNotFound(name) };
    }
    if (!rawValue.trim()) {
      return { error: c.fieldEmpty(path) };
    }
    if (field === "driver") {
      agent.driver = rawValue;
    } else {
      agent.command = rawValue;
    }
    return { renderedValue: rawValue };
  }

  const workspaceMatch = path.match(/^workspaces\.([^.]+)\.(cwd|description)$/);
  if (workspaceMatch) {
    const [, name, field] = workspaceMatch;
    if (!name || !field) {
      return { error: c.pathNotSupported(path) };
    }
    const workspace = config.workspaces[name];
    if (!workspace) {
      return { error: c.workspaceNotFound(name) };
    }
    if (!rawValue.trim()) {
      return { error: c.fieldEmpty(path) };
    }
    if (field === "cwd") {
      workspace.cwd = rawValue;
    } else {
      workspace.description = rawValue;
    }
    return { renderedValue: rawValue };
  }

  const channelMatch = path.match(/^channels\.([^.]+)\.replyMode$/);
  if (channelMatch) {
    const [, id] = channelMatch;
    if (!id) {
      return { error: c.pathNotSupported(path) };
    }
    const channel = config.channels.find((entry) => entry.id === id);
    if (!channel) {
      return { error: c.channelRuntimeNotFound(id) };
    }
    const parsed = parseEnum<ReplyMode>(rawValue, ["stream", "final", "verbose"]);
    if (!parsed) {
      return { error: c.channelRuntimeReplyModeInvalid(id) };
    }
    channel.replyMode = parsed;
    return { renderedValue: parsed };
  }

  return { error: c.pathNotSupported(path) };
}

function parseEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function parsePositiveNumber(
  rawValue: string,
  path: string,
): { value: number } | { error: string } {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: t().config.mustBePositiveNumber(path) };
  }
  return { value };
}
