import type {
  AppConfig,
  LoggingLevel,
  NonInteractivePermissions,
  PermissionMode,
  WechatReplyMode,
} from "../../config/types";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";
import { cloneAppConfig } from "../config-clone";

const SUPPORTED_CONFIG_PATHS = [
  "transport.type",
  "transport.command",
  "transport.sessionInitTimeoutMs",
  "transport.permissionMode",
  "transport.nonInteractivePermissions",
  "logging.level",
  "logging.maxSizeBytes",
  "logging.maxFiles",
  "logging.retentionDays",
  "wechat.replyMode",
  "agents.<name>.driver",
  "agents.<name>.command",
  "workspaces.<name>.cwd",
  "workspaces.<name>.description",
] as const;

export const configHelp: HelpTopicMetadata = {
  topic: "config",
  aliases: [],
  summary: "查看和修改受支持的配置字段。",
  commands: [
    { usage: "/config", description: "查看当前支持修改的配置路径" },
    { usage: "/config set <path> <value>", description: "修改一个受支持的配置值" },
  ],
  examples: ["/config set wechat.replyMode final", "/config set logging.level debug"],
};

export function handleConfigShow(context: CommandRouterContext): RouterResponse {
  const lines = ["支持修改的配置字段：", ...SUPPORTED_CONFIG_PATHS.map((path) => `- ${path}`)];

  if (context.config) {
    lines.push("", "示例：", "- /config set wechat.replyMode final", "- /config set logging.level debug");
  }

  return { text: lines.join("\n") };
}

export async function handleConfigSet(
  context: CommandRouterContext,
  path: string,
  rawValue: string,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const previous = cloneAppConfig(context.config);
  const updated = cloneAppConfig(context.config);
  const result = applySupportedConfigUpdate(updated, path, rawValue);
  if ("error" in result) {
    return { text: result.error };
  }

  await context.configStore.save(updated);
  if (path === "transport.permissionMode" || path === "transport.nonInteractivePermissions") {
    try {
      await context.transport.updatePermissionPolicy?.(updated.transport);
    } catch (error) {
      await context.configStore.save(previous);
      context.replaceConfig(previous);
      throw error;
    }
  }
  context.replaceConfig(updated);
  return { text: `配置已更新：${path} = ${result.renderedValue}` };
}

function applySupportedConfigUpdate(
  config: AppConfig,
  path: string,
  rawValue: string,
): { renderedValue: string } | { error: string } {
  switch (path) {
    case "transport.type": {
      const parsed = parseEnum(rawValue, ["acpx-cli", "acpx-bridge"]);
      if (!parsed) return { error: "transport.type 只支持：acpx-cli、acpx-bridge" };
      config.transport.type = parsed;
      return { renderedValue: parsed };
    }
    case "transport.command":
      if (!rawValue.trim()) return { error: "transport.command 不能为空。" };
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
      if (!parsed) return { error: "transport.permissionMode 只支持：approve-all、approve-reads、deny-all" };
      config.transport.permissionMode = parsed;
      return { renderedValue: parsed };
    }
    case "transport.nonInteractivePermissions": {
      const parsed = parseEnum<NonInteractivePermissions>(rawValue, ["deny", "fail"]);
      if (!parsed) return { error: "transport.nonInteractivePermissions 只支持：deny、fail" };
      config.transport.nonInteractivePermissions = parsed;
      return { renderedValue: parsed };
    }
    case "logging.level": {
      const parsed = parseEnum<LoggingLevel>(rawValue, ["error", "info", "debug"]);
      if (!parsed) return { error: "logging.level 只支持：error、info、debug" };
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
    case "wechat.replyMode": {
      const parsed = parseEnum<WechatReplyMode>(rawValue, ["stream", "final"]);
      if (!parsed) return { error: "wechat.replyMode 只支持：stream、final" };
      config.wechat.replyMode = parsed;
      return { renderedValue: parsed };
    }
  }

  const agentMatch = path.match(/^agents\.([^.]+)\.(driver|command)$/);
  if (agentMatch) {
    const [, name, field] = agentMatch;
    if (!name || !field) {
      return { error: `不支持修改这个配置路径：${path}` };
    }
    const agent = config.agents[name];
    if (!agent) {
      return { error: `Agent「${name}」不存在，请先创建。` };
    }
    if (!rawValue.trim()) {
      return { error: `${path} 不能为空。` };
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
      return { error: `不支持修改这个配置路径：${path}` };
    }
    const workspace = config.workspaces[name];
    if (!workspace) {
      return { error: `工作区「${name}」不存在，请先创建。` };
    }
    if (!rawValue.trim()) {
      return { error: `${path} 不能为空。` };
    }
    if (field === "cwd") {
      workspace.cwd = rawValue;
    } else {
      workspace.description = rawValue;
    }
    return { renderedValue: rawValue };
  }

  return { error: `不支持修改这个配置路径：${path}` };
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
    return { error: `${path} 必须是正数。` };
  }
  return { value };
}

