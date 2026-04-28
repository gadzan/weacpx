const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;

const SECRET_KEYS = new Set([
  "authorization",
  "access_token",
  "aes_key",
  "aeskey",
  "context_token",
  "replycontexttoken",
  "secret",
  "signature",
  "token",
]);

const CONTENT_KEYS = new Set([
  "content",
  "message",
  "msg",
  "rawtext",
  "text",
]);

/**
 * Truncate a string, appending a length indicator when trimmed.
 * Returns `""` for empty/undefined input.
 */
export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

/**
 * Redact a token/secret: show only the first few chars + total length.
 * Returns `"(none)"` when absent.
 */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

/**
 * Redact a JSON body string for safe logging. JSON objects are structurally
 * sanitized so secrets and user-authored message bodies are not written to
 * disk. Non-JSON payloads fall back to length-bounded truncation.
 */
export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";

  const parsed = parseJson(body);
  if (parsed !== undefined) {
    return truncateForBody(JSON.stringify(redactJsonValue(parsed)), maxLen);
  }

  return truncateForBody(body, maxLen);
}

function parseJson(body: string): unknown | undefined {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function redactJsonValue(value: unknown, key?: string): unknown {
  const normalizedKey = key?.toLowerCase();
  if (normalizedKey && SECRET_KEYS.has(normalizedKey)) {
    return redactScalar(value);
  }
  if (normalizedKey && CONTENT_KEYS.has(normalizedKey)) {
    return redactContent(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactJsonValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function redactScalar(value: unknown): string {
  const len = typeof value === "string" ? value.length : JSON.stringify(value)?.length ?? 0;
  return `<redacted len=${len}>`;
}

function redactContent(value: unknown): unknown {
  if (typeof value === "string") {
    return `<redacted len=${value.length}>`;
  }
  return redactJsonValue(value);
}

function truncateForBody(body: string, maxLen: number): string {
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}…(truncated, totalLen=${body.length})`;
}

/**
 * Strip query string (which often contains signatures/tokens) from a URL,
 * keeping only origin + pathname.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}
