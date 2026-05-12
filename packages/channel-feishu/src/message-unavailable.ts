// Feishu IM API error codes returned for recalled / deleted messages.
// Source: https://open.feishu.cn/document/server-docs/im-v1/message/error-code
const RECALLED_CODE = 230011;
const DELETED_CODE = 231003;
const TERMINAL_CODES: ReadonlySet<number> = new Set([RECALLED_CODE, DELETED_CODE]);

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

export function isTerminalMessageApiCode(code: unknown): code is number {
  return typeof code === "number" && TERMINAL_CODES.has(code);
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

export function extractFeishuApiCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const rec = error as { code?: unknown; response?: { data?: { code?: unknown } } };
  if (typeof rec.code === "number") return rec.code;
  const nested = rec.response?.data?.code;
  if (typeof nested === "number") return nested;
  return undefined;
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
