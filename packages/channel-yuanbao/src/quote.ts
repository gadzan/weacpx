/**
 * Parse the `cloud_custom_data.quote` payload that Yuanbao attaches when a
 * user replies-to a message.
 *
 * The payload is opaque to the platform — clients embed JSON inside
 * `cloud_custom_data`. We tolerate missing/malformed values and only return a
 * QuoteInfo when there's enough to build readable context.
 */

export interface YuanbaoQuoteInfo {
  /** Message id of the quoted message, if the client provided one. */
  msgId?: string;
  /** Account id of the original sender. */
  senderId?: string;
  /** Display name of the original sender. */
  senderNickname?: string;
  /** IM client message_type (1=text, 2=image, 3=file, 4=video, 5=audio). */
  type?: number;
  /** Inline description / preview text of the quoted message. */
  desc?: string;
}

/** IM client message_type enum (kept private to this module). */
const IM_MT_PIC = 2;

const MAX_DESC_CHARS = 500;

interface RawQuote {
  msgId?: unknown;
  msg_id?: unknown;
  sender_id?: unknown;
  senderId?: unknown;
  sender_nickname?: unknown;
  senderNickname?: unknown;
  type?: unknown;
  desc?: unknown;
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function parseQuoteFromCloudCustomData(cloudCustomData?: string): YuanbaoQuoteInfo | undefined {
  if (!cloudCustomData || typeof cloudCustomData !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cloudCustomData);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const quoteRaw = (parsed as Record<string, unknown>).quote;
  if (!quoteRaw || typeof quoteRaw !== "object") return undefined;
  const q = quoteRaw as RawQuote;

  const type = pickNumber(q.type);
  let desc = pickString(q.desc);
  if (type === IM_MT_PIC && !desc) desc = "[image]";

  const senderId = pickString(q.sender_id, q.senderId);
  const senderNickname = pickString(q.sender_nickname, q.senderNickname);
  const msgId = pickString(q.msg_id, q.msgId);

  if (!desc && !senderId && !senderNickname) return undefined;

  const info: YuanbaoQuoteInfo = {};
  if (msgId) info.msgId = msgId;
  if (senderId) info.senderId = senderId;
  if (senderNickname) info.senderNickname = senderNickname;
  if (type !== undefined) info.type = type;
  if (desc) info.desc = desc;
  return info;
}

/**
 * Render the quote as readable agent-facing context. Output:
 *
 * ```
 * > [Quoted message from <nickname>]:
 * > <desc (truncated)>
 * ```
 */
export function formatQuoteContext(quote: YuanbaoQuoteInfo): string {
  const senderLabel = quote.senderNickname ?? quote.senderId;
  const header = senderLabel ? `> [Quoted message from ${senderLabel}]:` : "> [Quoted message]:";
  let desc = (quote.desc ?? "").trim();
  if (desc.length > MAX_DESC_CHARS) desc = `${desc.slice(0, MAX_DESC_CHARS)}...(truncated)`;
  const body = desc ? `> ${desc.replace(/\n/g, "\n> ")}` : "> (no preview)";
  return `${header}\n${body}`;
}

/** Returns true when the quoted message was originally sent by the bot. */
export function isQuoteRepliedToBot(quote: YuanbaoQuoteInfo | undefined, botId: string | undefined): boolean {
  if (!quote || !botId) return false;
  return quote.senderId === botId;
}
