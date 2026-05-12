import { extractFeishuApiCode } from "./message-unavailable.js";
import { permissionPromptToGrant, permissionScopeMissing } from "./strings.js";

// Feishu's "missing app scope" error code.
// Source: https://open.feishu.cn/document/server-docs/getting-started/api-error-code
const APP_SCOPE_MISSING_CODE = 99991672;

export interface PermissionError {
  code: number;
  message: string;
  grantUrl: string;
}

// Only accept grant URLs from Feishu/Lark's own hosts to prevent any
// attacker-controlled error string from relaying a phishing link to chat.
const ALLOWED_GRANT_HOSTS = new Set([
  "open.feishu.cn",
  "open.larksuite.com",
  "open.feishu-pre.cn",
  "open.larksuite-staging.com",
]);

// Strip Unicode/ASCII trailing punctuation that may be glued to the URL in the
// raw error message (e.g. `https://...?q=im:message).`).
const TRAILING_URL_JUNK_RE = /[.,;:!?)\]>}'"`，。；:：！？）】》"']+$/u;

export function extractPermissionGrantUrl(msg: string): string {
  const match = msg.match(/https:\/\/[^\s]+\/app\/[^\s]+/);
  if (!match?.[0]) return "";
  const cleaned = match[0].replace(TRAILING_URL_JUNK_RE, "");
  try {
    const url = new URL(cleaned);
    if (!ALLOWED_GRANT_HOSTS.has(url.hostname)) return "";
    // Keep only the params we know are safe — drop everything else so a
    // future change to Feishu's error format can't smuggle session tokens etc.
    const scopeList = url.searchParams.get("q") ?? "";
    const appId = url.searchParams.get("app_id");
    const cleanUrl = new URL(`${url.origin}${url.pathname}`);
    if (appId) cleanUrl.searchParams.set("app_id", appId);
    const top = pickHighestPriorityScope(scopeList);
    if (top) cleanUrl.searchParams.set("q", top);
    return cleanUrl.href;
  } catch {
    return "";
  }
}

function pickHighestPriorityScope(scopeList: string): string {
  return scopeList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => priority(a) - priority(b))[0] ?? "";
}

function priority(scope: string): number {
  const lower = scope.toLowerCase();
  const read = lower.includes("read");
  const write = lower.includes("write");
  if (read && !write) return 1;
  if (write && !read) return 2;
  return 3;
}

export function extractPermissionScopes(msg: string): string {
  const match = msg.match(/\[([^\]]+)\]/);
  return match?.[1] ?? "";
}

export function extractPermissionError(error: unknown): PermissionError | null {
  const code = extractFeishuApiCode(error);
  if (code !== APP_SCOPE_MISSING_CODE) return null;
  const message = extractFeishuMessage(error);
  const grantUrl = extractPermissionGrantUrl(message);
  if (!grantUrl) return null;
  return { code, message, grantUrl };
}

function extractFeishuMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const rec = error as { msg?: unknown; message?: unknown; response?: { data?: { msg?: unknown } } };
  if (typeof rec.msg === "string") return rec.msg;
  const nested = rec.response?.data?.msg;
  if (typeof nested === "string") return nested;
  if (typeof rec.message === "string") return rec.message;
  return "";
}

export const PERMISSION_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Per-key cooldown tracker for surfacing permission errors to users.
 *
 * Use `tryReserve()` to decide whether to send a notification; if the send
 * succeeds, call `commit()`. If the send itself fails, call `rollback()` so
 * the next attempt isn't gated by a phantom cooldown — otherwise a single
 * flaky API call would silence the user for the entire cooldown window.
 */
export class PermissionNotifier {
  private readonly lastNotifiedAtMs: Map<string, number> = new Map();
  private readonly reservedAtMs: Map<string, number> = new Map();

  constructor(private readonly cooldownMs: number = PERMISSION_NOTIFY_COOLDOWN_MS) {}

  /**
   * Returns true if the caller may proceed to send a notification. The slot
   * is held until {@link commit} or {@link rollback} is called; concurrent
   * `tryReserve` calls with the same key while a slot is held return false.
   */
  tryReserve(key: string, nowMs: number = Date.now()): boolean {
    if (this.reservedAtMs.has(key)) return false;
    const last = this.lastNotifiedAtMs.get(key);
    if (last !== undefined && nowMs - last < this.cooldownMs) return false;
    this.reservedAtMs.set(key, nowMs);
    return true;
  }

  commit(key: string, nowMs: number = Date.now()): void {
    this.lastNotifiedAtMs.set(key, nowMs);
    this.reservedAtMs.delete(key);
  }

  rollback(key: string): void {
    this.reservedAtMs.delete(key);
  }

  /** @deprecated Prefer tryReserve + commit/rollback. Retained for tests. */
  shouldNotify(key: string, nowMs: number = Date.now()): boolean {
    if (!this.tryReserve(key, nowMs)) return false;
    this.commit(key, nowMs);
    return true;
  }

  reset(): void {
    this.lastNotifiedAtMs.clear();
    this.reservedAtMs.clear();
  }
}

export function formatPermissionNotice(err: PermissionError): string {
  const scopes = extractPermissionScopes(err.message);
  return `${permissionScopeMissing(scopes)}\n${permissionPromptToGrant()}\n${err.grantUrl}`;
}
