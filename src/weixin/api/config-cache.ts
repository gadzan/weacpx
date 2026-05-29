import { getConfig } from "./api.js";

/** Subset of getConfig fields that we actually need; add new fields here as needed. */
export interface CachedConfig {
  typingTicket: string;
}

const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2_000;
const CONFIG_CACHE_MAX_RETRY_MS = 60 * 60 * 1000;

interface ConfigCacheEntry {
  config: CachedConfig;
  everSucceeded: boolean;
  nextFetchAt: number;
  retryDelayMs: number;
  lastTouchedAt: number;
}

type GetConfigFn = typeof getConfig;

export interface WeixinConfigManagerOptions {
  maxEntries?: number;
  entryTtlMs?: number;
  now?: () => number;
  getConfig?: GetConfigFn;
}

const CONFIG_CACHE_DEFAULT_MAX_ENTRIES = 5000;
const CONFIG_CACHE_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-user getConfig cache with periodic random refresh (within 24h) and
 * exponential-backoff retry (up to 1h) on failure.
 */
export class WeixinConfigManager {
  private cache = new Map<string, ConfigCacheEntry>();
  private readonly maxEntries: number;
  private readonly entryTtlMs: number;
  private readonly now: () => number;
  private readonly fetchConfig: GetConfigFn;

  constructor(
    private apiOpts: { baseUrl: string; token?: string },
    private log: (msg: string) => void,
    options: WeixinConfigManagerOptions = {},
  ) {
    this.maxEntries = normalizePositiveInt(options.maxEntries, CONFIG_CACHE_DEFAULT_MAX_ENTRIES);
    this.entryTtlMs = normalizeNonNegativeMs(options.entryTtlMs, CONFIG_CACHE_ENTRY_TTL_MS);
    this.now = options.now ?? (() => Date.now());
    this.fetchConfig = options.getConfig ?? getConfig;
  }

  async getForUser(userId: string, contextToken?: string): Promise<CachedConfig> {
    const now = this.now();
    this.prune(now);
    const entry = this.cache.get(userId);
    const shouldFetch = !entry || now >= entry.nextFetchAt;

    if (shouldFetch) {
      let fetchOk = false;
      try {
        const resp = await this.fetchConfig({
          baseUrl: this.apiOpts.baseUrl,
          token: this.apiOpts.token,
          ilinkUserId: userId,
          contextToken,
        });
        if (resp.ret === 0) {
          this.cache.set(userId, {
            config: { typingTicket: resp.typing_ticket ?? "" },
            everSucceeded: true,
            nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
            lastTouchedAt: now,
          });
          this.log(
            `[weixin] config ${entry?.everSucceeded ? "refreshed" : "cached"} for ${userId}`,
          );
          fetchOk = true;
        }
      } catch (err) {
        this.log(`[weixin] getConfig failed for ${userId} (ignored): ${String(err)}`);
      }
      if (!fetchOk) {
        const prevDelay = entry?.retryDelayMs ?? CONFIG_CACHE_INITIAL_RETRY_MS;
        const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
        if (entry) {
          entry.nextFetchAt = now + nextDelay;
          entry.retryDelayMs = nextDelay;
          entry.lastTouchedAt = now;
        } else {
          this.cache.set(userId, {
            config: { typingTicket: "" },
            everSucceeded: false,
            nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
            retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS,
            lastTouchedAt: now,
          });
        }
      }
    } else {
      entry.lastTouchedAt = now;
    }

    this.enforceMaxEntries();
    return this.cache.get(userId)?.config ?? { typingTicket: "" };
  }

  cacheSizeForTests(): number {
    this.prune(this.now());
    return this.cache.size;
  }

  hasCachedUserForTests(userId: string): boolean {
    this.prune(this.now());
    return this.cache.has(userId);
  }

  private prune(now: number): void {
    const cutoff = now - this.entryTtlMs;
    for (const [key, entry] of this.cache) {
      if (entry.lastTouchedAt < cutoff) {
        this.cache.delete(key);
      }
    }
    this.enforceMaxEntries();
  }

  private enforceMaxEntries(): void {
    while (this.cache.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestTouchedAt = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.cache) {
        if (entry.lastTouchedAt < oldestTouchedAt) {
          oldestTouchedAt = entry.lastTouchedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function normalizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
