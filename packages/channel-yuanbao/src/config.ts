export type YuanbaoOverflowPolicy = "stop" | "split";
export type YuanbaoReplyToMode = "off" | "first" | "all";

export interface YuanbaoAccountConfig {
  name?: string;
  enabled?: boolean;
  appKey?: string;
  appSecret?: string;
  token?: string;
  botId?: string;
  apiDomain?: string;
  wsUrl?: string;
  requireMention?: boolean;
  overflowPolicy?: YuanbaoOverflowPolicy;
  replyToMode?: YuanbaoReplyToMode;
  outboundQueueStrategy?: "immediate" | "merge-text";
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
  mediaMaxMb?: number;
  historyLimit?: number;
  disableBlockStreaming?: boolean;
  fallbackReply?: string;
  markdownHintEnabled?: boolean;
  debugBotIds?: string[];
}

export interface YuanbaoResolvedAccountConfig {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  appKey?: string;
  appSecret?: string;
  token?: string;
  botId?: string;
  apiDomain: string;
  wsUrl: string;
  requireMention: boolean;
  overflowPolicy: YuanbaoOverflowPolicy;
  replyToMode: YuanbaoReplyToMode;
  outboundQueueStrategy: "immediate" | "merge-text";
  minChars: number;
  maxChars: number;
  idleMs: number;
  mediaMaxMb: number;
  historyLimit: number;
  disableBlockStreaming: boolean;
  fallbackReply: string;
  markdownHintEnabled: boolean;
  debugBotIds: string[];
}

export interface YuanbaoChannelConfig extends YuanbaoAccountConfig {
  defaultAccount: string;
  gatewayModule?: string;
  accounts: YuanbaoResolvedAccountConfig[];
}

const DEFAULT_API_DOMAIN = "bot.yuanbao.tencent.com";
const DEFAULT_WS_URL = "wss://bot-wss.yuanbao.tencent.com/wss/connection";
const DEFAULT_FALLBACK_REPLY = "暂时无法解答，你可以换个问题问问我哦";
const DEFAULT_ACCOUNT_ID = "default";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOptional(raw: unknown, path: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new Error(`${path} must be a string`);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanOptional(raw: unknown, path: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") throw new Error(`${path} must be a boolean`);
  return raw;
}

function positiveNumber(raw: unknown, path: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${path} must be a positive number`);
  }
  return raw;
}

function nonNegativeNumber(raw: unknown, path: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`${path} must be a non-negative number`);
  }
  return raw;
}

function enumValue<T extends string>(raw: unknown, path: string, allowed: readonly T[], fallback: T): T {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return raw as T;
}

function stringArray(raw: unknown, path: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
  return raw.map((item) => item.trim()).filter(Boolean);
}

function parseGatewayModule(raw: unknown): string | undefined {
  const module = stringOptional(raw, "channel.options.gatewayModule");
  if (!module) return undefined;
  if (module.startsWith(".")) {
    throw new Error("channel.options.gatewayModule must be an absolute path, ~/ path, file URL, or package name");
  }
  return module;
}

function extractCredentials(account: Record<string, unknown>, path: string): { appKey?: string; appSecret?: string; token?: string } {
  let appKey = stringOptional(account.appKey, `${path}.appKey`);
  let appSecret = stringOptional(account.appSecret, `${path}.appSecret`);
  let token = stringOptional(account.token, `${path}.token`);

  if ((!appKey || !appSecret) && token) {
    const colonIndex = token.indexOf(":");
    if (colonIndex > 0) {
      const parsedKey = token.slice(0, colonIndex).trim();
      const parsedSecret = token.slice(colonIndex + 1).trim();
      if (parsedKey && parsedSecret) {
        appKey = appKey ?? parsedKey;
        appSecret = appSecret ?? parsedSecret;
        token = undefined;
      }
    }
  }

  return { appKey, appSecret, token };
}

function resolveAccount(accountId: string, base: Record<string, unknown>, override: Record<string, unknown>, path: string): YuanbaoResolvedAccountConfig {
  const merged = { ...base, ...override };
  const { appKey, appSecret, token } = extractCredentials(merged, path);
  const botId = stringOptional(merged.botId, `${path}.botId`);
  if (token && !botId) {
    throw new Error(`${path}.botId is required when ${path}.token is a static Yuanbao auth token`);
  }
  const configured = Boolean((appKey && appSecret) || (token && botId));
  const enabled = booleanOptional(merged.enabled, `${path}.enabled`) ?? true;

  return {
    accountId,
    name: stringOptional(merged.name, `${path}.name`),
    enabled,
    configured,
    appKey,
    appSecret,
    token,
    botId,
    apiDomain: stringOptional(merged.apiDomain, `${path}.apiDomain`) ?? DEFAULT_API_DOMAIN,
    wsUrl: stringOptional(merged.wsUrl, `${path}.wsUrl`) ?? DEFAULT_WS_URL,
    requireMention: booleanOptional(merged.requireMention, `${path}.requireMention`) ?? true,
    overflowPolicy: enumValue(merged.overflowPolicy, `${path}.overflowPolicy`, ["stop", "split"], "split"),
    replyToMode: enumValue(merged.replyToMode, `${path}.replyToMode`, ["off", "first", "all"], "first"),
    outboundQueueStrategy: enumValue(merged.outboundQueueStrategy, `${path}.outboundQueueStrategy`, ["immediate", "merge-text"], "merge-text"),
    minChars: positiveNumber(merged.minChars, `${path}.minChars`, 2800),
    maxChars: positiveNumber(merged.maxChars, `${path}.maxChars`, 3000),
    idleMs: nonNegativeNumber(merged.idleMs, `${path}.idleMs`, 5000),
    mediaMaxMb: positiveNumber(merged.mediaMaxMb, `${path}.mediaMaxMb`, 20),
    historyLimit: nonNegativeNumber(merged.historyLimit, `${path}.historyLimit`, 100),
    disableBlockStreaming: booleanOptional(merged.disableBlockStreaming, `${path}.disableBlockStreaming`) ?? false,
    fallbackReply: stringOptional(merged.fallbackReply, `${path}.fallbackReply`) ?? DEFAULT_FALLBACK_REPLY,
    markdownHintEnabled: booleanOptional(merged.markdownHintEnabled, `${path}.markdownHintEnabled`) ?? true,
    debugBotIds: stringArray(merged.debugBotIds, `${path}.debugBotIds`),
  };
}

export function parseYuanbaoChannelConfig(raw: unknown): YuanbaoChannelConfig {
  if (!isRecord(raw)) {
    throw new Error("channel.options must be an object when channel.type is yuanbao");
  }

  const defaultAccount = stringOptional(raw.defaultAccount, "channel.options.defaultAccount") ?? DEFAULT_ACCOUNT_ID;
  const gatewayModule = parseGatewayModule(raw.gatewayModule);
  const accountsRaw = isRecord(raw.accounts) ? raw.accounts : undefined;
  if ("accounts" in raw && raw.accounts !== undefined && !accountsRaw) {
    throw new Error("channel.options.accounts must be an object");
  }

  const baseAccountKeys = new Set(["accounts", "defaultAccount", "gatewayModule"]);
  const baseAccount: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!baseAccountKeys.has(key)) baseAccount[key] = value;
  }

  const accounts: YuanbaoResolvedAccountConfig[] = [];
  if (accountsRaw) {
    for (const [accountId, value] of Object.entries(accountsRaw)) {
      if (!isRecord(value)) throw new Error(`channel.options.accounts.${accountId} must be an object`);
      accounts.push(resolveAccount(accountId, baseAccount, value, `channel.options.accounts.${accountId}`));
    }
  } else {
    accounts.push(resolveAccount(defaultAccount, baseAccount, {}, "channel.options"));
  }

  const enabledAccounts = accounts.filter((account) => account.enabled);
  const configuredAccounts = enabledAccounts.filter((account) => account.configured);
  if (configuredAccounts.length === 0) {
    throw new Error("channel.options.appKey and channel.options.appSecret are required when channel.type is yuanbao");
  }

  return {
    ...baseAccount,
    defaultAccount,
    gatewayModule,
    accounts,
  } as YuanbaoChannelConfig;
}
