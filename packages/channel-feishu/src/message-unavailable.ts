import {
  FeishuErrorCode,
  extractFeishuApiCode,
  isTerminalMessageApiCode,
} from "./errors.js";

// Re-export so existing importers keep working; new code should import from
// `./errors.js` directly.
export { extractFeishuApiCode, isTerminalMessageApiCode };

const TTL_MS = 30 * 60 * 1000;
const MAX_BEFORE_PRUNE = 512;
const DEFAULT_ACCOUNT_SCOPE = "__default__";

interface State {
  apiCode: number;
  markedAtMs: number;
}

const cache = new Map<string, State>();

function buildKey(accountId: string | undefined, messageId: string): string {
  return `${accountId ?? DEFAULT_ACCOUNT_SCOPE}:${messageId}`;
}

function prune(nowMs: number): void {
  for (const [id, state] of cache) {
    if (nowMs - state.markedAtMs > TTL_MS) cache.delete(id);
  }
}

export function isMessageUnavailable(
  messageId: string | undefined,
  accountId?: string,
): boolean {
  if (!messageId) return false;
  const key = buildKey(accountId, messageId);
  const state = cache.get(key);
  if (!state) return false;
  if (Date.now() - state.markedAtMs > TTL_MS) {
    cache.delete(key);
    return false;
  }
  return true;
}

export function markMessageUnavailable(
  messageId: string,
  apiCode: number,
  accountId?: string,
): void {
  if (!messageId) return;
  const now = Date.now();
  cache.set(buildKey(accountId, messageId), { apiCode, markedAtMs: now });
  if (cache.size > MAX_BEFORE_PRUNE) prune(now);
}

export function markIfUnavailableError(
  messageId: string,
  error: unknown,
  accountId?: string,
): boolean {
  const code = extractFeishuApiCode(error);
  if (code !== undefined && isTerminalMessageApiCode(code)) {
    markMessageUnavailable(messageId, code, accountId);
    return true;
  }
  return false;
}

export function clearMessageUnavailableForAccount(accountId: string | undefined): void {
  const prefix = `${accountId ?? DEFAULT_ACCOUNT_SCOPE}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function resetMessageUnavailableCacheForTests(): void {
  cache.clear();
}

// Re-export so call sites can reference the code by name without a separate
// import. Old direct numeric usages still compile.
export { FeishuErrorCode };
