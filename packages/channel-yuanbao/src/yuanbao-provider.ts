import type {
  ChannelCliInput,
  ChannelCliIo,
  ChannelCliParseResult,
  ChannelCliProvider,
  ChannelCliValidationIssue,
  ChannelRuntimeConfig,
} from "xacpx/plugin-api";

function parseBooleanFlag(value: string, flagName: string): { ok: true; value: boolean } | { ok: false; message: string } {
  if (value === "true") return { ok: true, value: true };
  if (value === "false") return { ok: true, value: false };
  return { ok: false, message: `${flagName} must be true or false` };
}

function takeFlagValue(args: string[], index: number, flagName: string): { ok: true; value: string; nextIndex: number } | { ok: false; message: string } {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return { ok: false, message: `${flagName} requires a value` };
  return { ok: true, value, nextIndex: index + 1 };
}

function stringField(input: ChannelCliInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(input: ChannelCliInput, key: string): number | undefined {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isAppKeySecretToken(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const colon = value.indexOf(":");
  if (colon <= 0) return false;
  return Boolean(value.slice(0, colon).trim() && value.slice(colon + 1).trim());
}

export const yuanbaoCliProvider: ChannelCliProvider = {
  type: "yuanbao",
  displayName: "Yuanbao",
  supportsLogin: false,

  parseAddArgs(args: string[]): ChannelCliParseResult {
    const input: ChannelCliInput = {};
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      switch (arg) {
        case "--app-key": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.appKey = value.value;
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
        case "--token": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.token = value.value;
          index = value.nextIndex;
          break;
        }
        case "--bot-id": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.botId = value.value;
          index = value.nextIndex;
          break;
        }
        case "--api-domain": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.apiDomain = value.value;
          index = value.nextIndex;
          break;
        }
        case "--ws-url": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          input.wsUrl = value.value;
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
        case "--max-chars":
        case "--idle-ms": {
          const value = takeFlagValue(args, index, arg);
          if (!value.ok) return value;
          const n = Number(value.value);
          if (!Number.isFinite(n) || n <= 0) return { ok: false, message: `${arg} must be a positive number` };
          input[arg === "--max-chars" ? "maxChars" : "idleMs"] = value.value;
          index = value.nextIndex;
          break;
        }
        default:
          return { ok: false, message: `unknown yuanbao option: ${arg}` };
      }
    }
    return { ok: true, input };
  },

  buildDefaultConfig(input: ChannelCliInput): ChannelRuntimeConfig {
    const options: Record<string, unknown> = {
      appKey: stringField(input, "appKey"),
      appSecret: stringField(input, "appSecret"),
      token: stringField(input, "token"),
      botId: stringField(input, "botId"),
      apiDomain: stringField(input, "apiDomain") ?? "bot.yuanbao.tencent.com",
      wsUrl: stringField(input, "wsUrl") ?? "wss://bot-wss.yuanbao.tencent.com/wss/connection",
      requireMention: typeof input.requireMention === "boolean" ? input.requireMention : true,
      replyToMode: "first",
      overflowPolicy: "split",
      outboundQueueStrategy: "merge-text",
      minChars: 2800,
      maxChars: numberField(input, "maxChars") ?? 3000,
      idleMs: numberField(input, "idleMs") ?? 5000,
      mediaMaxMb: 20,
      historyLimit: 100,
      disableBlockStreaming: false,
      fallbackReply: "暂时无法解答，你可以换个问题问问我哦",
      markdownHintEnabled: true,
    };
    for (const key of Object.keys(options)) {
      if (options[key] === undefined) delete options[key];
    }
    return { id: "yuanbao", type: "yuanbao", enabled: true, options };
  },

  validateConfig(config: ChannelRuntimeConfig): ChannelCliValidationIssue[] {
    const issues: ChannelCliValidationIssue[] = [];
    if (config.id !== "yuanbao") issues.push({ kind: "invalid-config", message: "yuanbao channel id must be yuanbao" });
    if (config.type !== "yuanbao") issues.push({ kind: "invalid-config", message: "yuanbao channel type must be yuanbao" });
    const options = config.options as Record<string, unknown> | undefined;
    const accounts = options && typeof options.accounts === "object" && options.accounts !== null
      ? (options.accounts as Record<string, Record<string, unknown>>)
      : undefined;

    if (accounts) {
      const merged = Object.values(accounts).map((acc) => ({
        appKey: (acc.appKey ?? options?.appKey) as unknown,
        appSecret: (acc.appSecret ?? options?.appSecret) as unknown,
        token: (acc.token ?? options?.token) as unknown,
        botId: (acc.botId ?? options?.botId) as unknown,
        enabled: acc.enabled !== false,
      }));
      const hasUsableAccount = merged.some((acc) => {
        if (!acc.enabled) return false;
        const hasPair = Boolean(acc.appKey && acc.appSecret);
        const hasToken = Boolean(acc.token);
        const hasStaticToken = hasToken && !isAppKeySecretToken(acc.token);
        if (hasPair) return true;
        if (hasToken && (!hasStaticToken || acc.botId)) return true;
        return false;
      });
      if (!hasUsableAccount) {
        issues.push({ kind: "invalid-config", message: "channel.options.accounts 中至少要有一个启用账号同时配置 appKey/appSecret，或者配置 token（静态 token 还需要 botId）" });
      }
      return issues;
    }

    const hasAppPair = Boolean(options?.appKey && options?.appSecret);
    const hasToken = Boolean(options?.token);
    const hasStaticToken = hasToken && !isAppKeySecretToken(options?.token);
    if (!hasAppPair && !hasToken) {
      issues.push({ kind: "missing-required-field", flag: "--app-key", message: "缺少 Yuanbao appKey" });
      issues.push({ kind: "missing-required-field", flag: "--app-secret", message: "缺少 Yuanbao appSecret" });
    } else if (options?.appKey && !options.appSecret) {
      issues.push({ kind: "missing-required-field", flag: "--app-secret", message: "缺少 Yuanbao appSecret" });
    } else if (!options?.appKey && options?.appSecret) {
      issues.push({ kind: "missing-required-field", flag: "--app-key", message: "缺少 Yuanbao appKey" });
    }
    if (!hasAppPair && hasStaticToken && !options?.botId) {
      issues.push({ kind: "missing-required-field", flag: "--bot-id", message: "静态 Yuanbao token 需要同时配置 botId" });
    }
    return issues;
  },

  renderSummary(config: ChannelRuntimeConfig): string[] {
    const options = config.options as Record<string, unknown> | undefined;
    return [
      `type: ${config.type}`,
      `enabled: ${config.enabled}`,
      `appKey: ${options?.appKey ?? ""}`,
      options?.token ? "token: ***" : "appSecret: ***",
      "gateway: builtin",
      `botId: ${options?.botId ?? ""}`,
      `apiDomain: ${options?.apiDomain ?? "bot.yuanbao.tencent.com"}`,
      `wsUrl: ${options?.wsUrl ?? "wss://bot-wss.yuanbao.tencent.com/wss/connection"}`,
      `requireMention: ${options?.requireMention ?? true}`,
    ];
  },

  async promptForMissingFields(input: ChannelCliInput, io: ChannelCliIo): Promise<ChannelCliInput> {
    const completed: ChannelCliInput = { ...input };
    if (!stringField(completed, "appKey") && !stringField(completed, "token")) {
      const value = (await io.promptText("Yuanbao appKey: ")).trim();
      if (value) completed.appKey = value;
    }
    if (stringField(completed, "appKey") && !stringField(completed, "appSecret")) {
      const value = (await io.promptSecret("Yuanbao appSecret: ")).trim();
      if (value) completed.appSecret = value;
    }
    return completed;
  },

  supportsMultipleAccounts: true,
  channelLevelOptionKeys: ["defaultAccount", "accounts", "gatewayModule"] as const,

  buildAccountOverride(input: ChannelCliInput): Record<string, unknown> {
    const override: Record<string, unknown> = {};
    const set = (key: string, value: unknown): void => {
      if (value !== undefined) override[key] = value;
    };
    set("appKey", stringField(input, "appKey"));
    set("appSecret", stringField(input, "appSecret"));
    set("token", stringField(input, "token"));
    set("botId", stringField(input, "botId"));
    set("apiDomain", stringField(input, "apiDomain"));
    set("wsUrl", stringField(input, "wsUrl"));
    if (typeof input.requireMention === "boolean") override.requireMention = input.requireMention;
    set("maxChars", numberField(input, "maxChars"));
    set("idleMs", numberField(input, "idleMs"));
    return override;
  },

  renderAccountSummary(config: ChannelRuntimeConfig, accountId: string): string[] | null {
    const options = config.options as Record<string, any> | undefined;
    if (!options) return null;
    const accounts = typeof options.accounts === "object" && options.accounts !== null
      ? (options.accounts as Record<string, Record<string, any>>)
      : null;
    const acc = accounts ? accounts[accountId] : (accountId === (options.defaultAccount ?? "default") ? options : undefined);
    if (!acc) return null;
    const appKey = acc.appKey ?? options.appKey ?? "";
    const hasToken = Boolean(acc.token ?? options.token);
    const botId = acc.botId ?? options.botId ?? "";
    const apiDomain = acc.apiDomain ?? options.apiDomain ?? "bot.yuanbao.tencent.com";
    const wsUrl = acc.wsUrl ?? options.wsUrl ?? "wss://bot-wss.yuanbao.tencent.com/wss/connection";
    const requireMention = acc.requireMention ?? options.requireMention ?? true;
    const enabled = acc.enabled !== false;
    const lines = [
      `account: ${accountId}${acc.name ? ` (${acc.name})` : ""}${enabled ? "" : " [disabled]"}`,
      `appKey: ${appKey}`,
      hasToken ? "token: ***" : "appSecret: ***",
      `botId: ${botId}`,
      `apiDomain: ${apiDomain}`,
      `wsUrl: ${wsUrl}`,
      `requireMention: ${requireMention}`,
    ];
    return lines;
  },
};
