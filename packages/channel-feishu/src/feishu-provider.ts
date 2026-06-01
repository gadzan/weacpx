import type { ChannelRuntimeConfig } from "xacpx/plugin-api";
import { parseBooleanFlag, takeFlagValue, type ChannelCliInput, type ChannelCliIo, type ChannelCliParseResult, type ChannelCliProvider, type ChannelCliValidationIssue } from "./provider.js";

const DEFAULT_FEISHU_DOMAIN = "feishu";
const DEFAULT_FEISHU_DEDUP_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_FEISHU_DEDUP_MAX_ENTRIES = 5000;

const FEISHU_CHANNEL_LEVEL_OPTION_KEYS = ["textMessageFormat", "dedupTtlMs", "dedupMaxEntries", "defaultAccount", "accounts"] as const;

function stringField(input: ChannelCliInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export const feishuCliProvider: ChannelCliProvider = {
  type: "feishu",
  displayName: "Feishu",
  supportsLogin: false,

  parseAddArgs(args: string[]): ChannelCliParseResult {
    const input: ChannelCliInput = {};
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      switch (arg) {
        case "--app-id": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.appId = value.value;
          index = value.nextIndex;
          break;
        }
        case "--app-secret": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.appSecret = value.value;
          index = value.nextIndex;
          break;
        }
        case "--domain": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.domain = value.value;
          index = value.nextIndex;
          break;
        }
        case "--require-mention": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          const parsed = parseBooleanFlag(value.value, arg);
          if (!parsed.ok) return parsed;
          input.requireMention = parsed.value;
          index = value.nextIndex;
          break;
        }
        default:
          return { ok: false, message: `unknown feishu option: ${arg}` };
      }
    }
    return { ok: true, input };
  },

  buildDefaultConfig(input: ChannelCliInput): ChannelRuntimeConfig {
    return {
      id: "feishu",
      type: "feishu",
      enabled: true,
      options: {
        appId: stringField(input, "appId"),
        appSecret: stringField(input, "appSecret"),
        domain: stringField(input, "domain") ?? DEFAULT_FEISHU_DOMAIN,
        requireMention: typeof input.requireMention === "boolean" ? input.requireMention : true,
        textMessageFormat: "text",
        dedupTtlMs: DEFAULT_FEISHU_DEDUP_TTL_MS,
        dedupMaxEntries: DEFAULT_FEISHU_DEDUP_MAX_ENTRIES,
      },
    };
  },

  validateConfig(config: ChannelRuntimeConfig): ChannelCliValidationIssue[] {
    const issues: ChannelCliValidationIssue[] = [];
    if (config.id !== "feishu") issues.push({ kind: "invalid-config", message: "feishu channel id must be feishu" });
    if (config.type !== "feishu") issues.push({ kind: "invalid-config", message: "feishu channel type must be feishu" });
    const options = config.options as Record<string, any> | undefined;
    const accounts = options && typeof options.accounts === "object" && options.accounts !== null
      ? (options.accounts as Record<string, Record<string, any>>)
      : undefined;
    const hasConfiguredAccount = accounts
      ? Object.values(accounts).some((acc) =>
          (typeof acc.appId === "string" && acc.appId.trim().length > 0 && typeof acc.appSecret === "string" && acc.appSecret.trim().length > 0) ||
          (typeof options?.appId === "string" && typeof options?.appSecret === "string"),
        )
      : Boolean(options?.appId && options?.appSecret);
    if (!hasConfiguredAccount) {
      if (!accounts && !options?.appId) {
        issues.push({ kind: "missing-required-field", flag: "--app-id", message: "缺少 Feishu appId" });
      }
      if (!accounts && !options?.appSecret) {
        issues.push({ kind: "missing-required-field", flag: "--app-secret", message: "缺少 Feishu appSecret" });
      }
      if (accounts) {
        issues.push({ kind: "invalid-config", message: "channel.options.accounts 中至少要有一个账号同时配置了 appId 和 appSecret" });
      }
    }
    return issues;
  },

  renderSummary(config: ChannelRuntimeConfig): string[] {
    const options = config.options as Record<string, any> | undefined;
    const accounts = options && typeof options.accounts === "object" && options.accounts !== null
      ? (options.accounts as Record<string, Record<string, any>>)
      : undefined;
    const lines = [
      `type: ${config.type}`,
      `enabled: ${config.enabled}`,
    ];
    if (accounts) {
      lines.push(`defaultAccount: ${options?.defaultAccount ?? Object.keys(accounts)[0] ?? "default"}`);
      lines.push(`accounts:`);
      for (const [accountId, acc] of Object.entries(accounts)) {
        const appId = acc.appId ?? options?.appId ?? "";
        const domain = acc.domain ?? options?.domain ?? DEFAULT_FEISHU_DOMAIN;
        const requireMention = acc.requireMention ?? options?.requireMention ?? true;
        const dmPolicy = acc.dmPolicy ?? options?.dmPolicy ?? "open";
        const groupPolicy = acc.groupPolicy ?? options?.groupPolicy ?? "open";
        const allowFrom = Array.isArray(acc.allowFrom) ? acc.allowFrom : Array.isArray(options?.allowFrom) ? options.allowFrom : [];
        const enabled = acc.enabled !== false;
        lines.push(`  - ${accountId}${acc.name ? ` (${acc.name})` : ""}${enabled ? "" : " [disabled]"}`);
        lines.push(`      appId: ${appId}`);
        lines.push(`      appSecret: ***`);
        lines.push(`      domain: ${domain}`);
        lines.push(`      requireMention: ${requireMention}`);
        lines.push(`      dmPolicy: ${dmPolicy}`);
        lines.push(`      groupPolicy: ${groupPolicy}`);
        if (allowFrom.length > 0) lines.push(`      allowFrom: ${allowFrom.join(", ")}`);
      }
    } else {
      lines.push(`appId: ${options?.appId ?? ""}`);
      lines.push("appSecret: ***");
      lines.push(`domain: ${options?.domain ?? DEFAULT_FEISHU_DOMAIN}`);
      lines.push(`requireMention: ${options?.requireMention ?? true}`);
      lines.push(`dmPolicy: ${options?.dmPolicy ?? "open"}`);
      lines.push(`groupPolicy: ${options?.groupPolicy ?? "open"}`);
      if (Array.isArray(options?.allowFrom) && options.allowFrom.length > 0) {
        lines.push(`allowFrom: ${options.allowFrom.join(", ")}`);
      }
    }
    return lines;
  },

  async promptForMissingFields(input: ChannelCliInput, io: ChannelCliIo): Promise<ChannelCliInput> {
    const completed: ChannelCliInput = { ...input };
    if (!stringField(completed, "appId")) {
      const value = (await io.promptText("Feishu appId: ")).trim();
      if (value) completed.appId = value;
    }
    if (!stringField(completed, "appSecret")) {
      const value = (await io.promptSecret("Feishu appSecret: ")).trim();
      if (value) completed.appSecret = value;
    }
    return completed;
  },

  supportsMultipleAccounts: true,
  channelLevelOptionKeys: FEISHU_CHANNEL_LEVEL_OPTION_KEYS,

  buildAccountOverride(input: ChannelCliInput): Record<string, unknown> {
    const override: Record<string, unknown> = {
      appId: stringField(input, "appId"),
      appSecret: stringField(input, "appSecret"),
    };
    const domain = stringField(input, "domain");
    if (domain) override.domain = domain;
    if (typeof input.requireMention === "boolean") override.requireMention = input.requireMention;
    return override;
  },

  renderAccountSummary(config: ChannelRuntimeConfig, accountId: string): string[] | null {
    const options = config.options as Record<string, any> | undefined;
    const accounts = options && typeof options.accounts === "object" && options.accounts !== null
      ? (options.accounts as Record<string, Record<string, any>>)
      : undefined;
    const acc = accounts ? accounts[accountId] : (accountId === (options?.defaultAccount ?? "default") ? options : undefined);
    if (!acc) return null;
    const appId = acc.appId ?? options?.appId ?? "";
    const domain = acc.domain ?? options?.domain ?? DEFAULT_FEISHU_DOMAIN;
    const requireMention = acc.requireMention ?? options?.requireMention ?? true;
    const dmPolicy = acc.dmPolicy ?? options?.dmPolicy ?? "open";
    const groupPolicy = acc.groupPolicy ?? options?.groupPolicy ?? "open";
    const allowFrom = Array.isArray(acc.allowFrom) ? acc.allowFrom : Array.isArray(options?.allowFrom) ? options.allowFrom : [];
    const enabled = acc.enabled !== false;
    const lines = [
      `account: ${accountId}${acc.name ? ` (${acc.name})` : ""}${enabled ? "" : " [disabled]"}`,
      `appId: ${appId}`,
      "appSecret: ***",
      `domain: ${domain}`,
      `requireMention: ${requireMention}`,
      `dmPolicy: ${dmPolicy}`,
      `groupPolicy: ${groupPolicy}`,
    ];
    if (allowFrom.length > 0) lines.push(`allowFrom: ${allowFrom.join(", ")}`);
    return lines;
  },
};
