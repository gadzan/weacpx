import { createHmac, randomBytes } from "node:crypto";
import { getOpenclawVersion, getOperationSystem, getPluginVersion } from "./access/env.js";
import type { AppLogger } from "weacpx/plugin-api";
import type { YuanbaoResolvedAccountConfig } from "./config.js";

export type YuanbaoSignTokenData = {
  bot_id: string;
  duration: number;
  product: string;
  source: string;
  token: string;
};

const SIGN_TOKEN_PATH = "/api/v5/robotLogic/sign-token";
const RETRYABLE_SIGN_CODE = 10099;
const SIGN_MAX_RETRIES = 3;
const SIGN_RETRY_DELAY_MS = 1000;
const CACHE_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_SIGN_TOKEN_TIMEOUT_MS = 30_000;

type CacheEntry = {
  data: YuanbaoSignTokenData;
  expiresAt: number;
};

const tokenCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<YuanbaoSignTokenData>>();

export type YuanbaoSignTokenOptions = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
};

function computeSignature(input: {
  nonce: string;
  timestamp: string;
  appKey: string;
  appSecret: string;
}): string {
  const plain = input.nonce + input.timestamp + input.appKey + input.appSecret;
  return createHmac("sha256", input.appSecret).update(plain).digest("hex");
}

function currentBeijingTimestamp(): string {
  return new Date(Date.now() + 8 * 3600000)
    .toISOString()
    .replace("Z", "+08:00")
    .replace(/\.\d{3}/, "");
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(reason ? String(reason) : "Yuanbao sign-token aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

function createFetchAbortSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason ?? new Error("Yuanbao sign-token aborted"));
  const timer = setTimeout(() => {
    controller.abort(new Error(`Yuanbao sign-token request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (parent?.aborted) {
    onAbort();
  } else {
    parent?.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchSignToken(
  account: YuanbaoResolvedAccountConfig,
  logger?: AppLogger,
  options: YuanbaoSignTokenOptions = {},
): Promise<YuanbaoSignTokenData> {
  if (!account.appKey || !account.appSecret) {
    throw new Error("Yuanbao sign-token failed: missing appKey or appSecret");
  }

  const url = `https://${account.apiDomain}${SIGN_TOKEN_PATH}`;
  for (let attempt = 0; attempt <= SIGN_MAX_RETRIES; attempt++) {
    throwIfAborted(options.abortSignal);
    const nonce = randomBytes(16).toString("hex");
    const timestamp = currentBeijingTimestamp();
    const signature = computeSignature({ nonce, timestamp, appKey: account.appKey, appSecret: account.appSecret });
    const body = { app_key: account.appKey, nonce, signature, timestamp };

    await logger?.info("yuanbao.sign_token.request", "requesting yuanbao sign-token", {
      accountId: account.accountId,
      apiDomain: account.apiDomain,
      attempt,
    });

    const abort = createFetchAbortSignal(options.abortSignal, options.timeoutMs ?? DEFAULT_SIGN_TOKEN_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: abort.signal,
        headers: {
          "Content-Type": "application/json",
          "X-AppVersion": getPluginVersion(),
          "X-OperationSystem": getOperationSystem(),
          "X-Instance-Id": "16",
          "X-Bot-Version": getOpenclawVersion(),
        },
        body: JSON.stringify(body),
      });
    } finally {
      abort.cleanup();
    }

    if (!response.ok) {
      throw new Error(`Yuanbao sign-token HTTP error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as { code: number; data?: YuanbaoSignTokenData; msg?: string };
    if (result.code === 0 && result.data?.token) {
      await logger?.info("yuanbao.sign_token.success", "yuanbao sign-token acquired", {
        accountId: account.accountId,
        botId: result.data.bot_id,
        duration: result.data.duration,
      });
      return result.data;
    }

    if (result.code === RETRYABLE_SIGN_CODE && attempt < SIGN_MAX_RETRIES) {
      await logger?.info("yuanbao.sign_token.retry", "yuanbao sign-token retryable response", {
        accountId: account.accountId,
        code: result.code,
      });
      await sleep(SIGN_RETRY_DELAY_MS, options.abortSignal);
      continue;
    }

    throw new Error(`Yuanbao sign-token error: code=${result.code}, msg=${result.msg ?? ""}`);
  }

  throw new Error("Yuanbao sign-token failed: max retries exceeded");
}

export function clearYuanbaoSignTokenCache(accountId?: string): void {
  if (accountId) {
    tokenCache.delete(accountId);
    pendingFetches.delete(accountId);
    return;
  }
  tokenCache.clear();
  pendingFetches.clear();
}

export async function getYuanbaoSignToken(
  account: YuanbaoResolvedAccountConfig,
  logger?: AppLogger,
  options: YuanbaoSignTokenOptions = {},
): Promise<YuanbaoSignTokenData> {
  throwIfAborted(options.abortSignal);
  if (account.token) {
    return {
      bot_id: account.botId ?? "",
      duration: 0,
      product: "yuanbao",
      source: "bot",
      token: account.token,
    };
  }

  const cached = tokenCache.get(account.accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const pending = pendingFetches.get(account.accountId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const data = await fetchSignToken(account, logger, options);
      if (data.duration > 0) {
        const ttlMs = Math.max(0, data.duration * 1000 - CACHE_REFRESH_MARGIN_MS);
        tokenCache.set(account.accountId, { data, expiresAt: Date.now() + ttlMs });
      }
      return data;
    } finally {
      pendingFetches.delete(account.accountId);
    }
  })();
  pendingFetches.set(account.accountId, request);
  return request;
}

export async function refreshYuanbaoSignToken(
  account: YuanbaoResolvedAccountConfig,
  logger?: AppLogger,
  options: YuanbaoSignTokenOptions = {},
): Promise<YuanbaoSignTokenData> {
  clearYuanbaoSignTokenCache(account.accountId);
  return getYuanbaoSignToken(account, logger, options);
}
