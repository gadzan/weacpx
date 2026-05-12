import type { FeishuMessageEvent } from "./types.js";

// Conservative trigger list. We intentionally exclude common-English words
// with non-abort meanings ("wait", "halt", "esc", "exit") because users say
// them mid-conversation for unrelated reasons. The unambiguous slash-command
// forms (`/stop`, `/abort`, `/cancel`) cover power users, and the bare words
// here are the few that almost-always signal "stop the bot."
const ABORT_TRIGGERS = new Set([
  "stop",
  "abort",
  "interrupt",
  "停止",
  "停下",
  "中断",
  "取消",
  "暂停",
  "停一下",
  "stop weacpx",
  "weacpx stop",
  "stop action",
  "stop current action",
  "stop run",
  "stop current run",
  "stop agent",
  "stop the agent",
  "please stop",
  "stop please",
]);

const TRAILING_ABORT_PUNCTUATION_RE = /[.!?…,，。;；:：'"'")\]}]+$/u;

function normalizeAbortTriggerText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(TRAILING_ABORT_PUNCTUATION_RE, "")
    .trim();
}

export function isAbortTrigger(text: string): boolean {
  if (!text) return false;
  return ABORT_TRIGGERS.has(normalizeAbortTriggerText(text));
}

export function isLikelyAbortText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "/stop" || trimmed === "/abort" || trimmed === "/cancel") return true;
  return isAbortTrigger(trimmed);
}

export function extractRawTextFromFeishuEvent(event: FeishuMessageEvent): string | undefined {
  if (!event.message || event.message.message_type !== "text") return undefined;
  try {
    const parsed = JSON.parse(event.message.content) as { text?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : undefined;
    if (!text) return undefined;
    const cleaned = text.replace(/@_user_\d+/g, "").trim();
    return cleaned || undefined;
  } catch {
    return undefined;
  }
}
