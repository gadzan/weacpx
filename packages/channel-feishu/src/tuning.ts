/**
 * Central tunable surface for the Feishu channel.
 *
 * Each subsystem reads its knobs from a single {@link FeishuTuning} object
 * so operators can override them via channel config without code changes.
 * Defaults are the values the subsystems shipped with — overriding any of
 * them is intended for ops tuning, not normal use.
 */

export interface FeishuTuning {
  /** Min interval between streaming card flushes. */
  cardFlushIntervalMs: number;
  /** N consecutive flush failures before {@link onCardDegraded} fires. */
  cardFailureThreshold: number;
  /** Max characters the streaming card body will hold (rest is truncated). */
  cardBodyMaxChars: number;
  /** Wait budget for in-flight image uploads at terminal card states. */
  imageResolveTimeoutMs: number;
  /** Max bytes per remote image fetched/uploaded by the resolver. */
  imageMaxBytes: number;
  /** LRU cap for the image resolver's resolved/failed maps. */
  imageCacheCap: number;
  /** TTL for an entry in the message-unavailable cache. */
  messageUnavailableTtlMs: number;
  /** Size at which the message-unavailable cache prunes expired entries. */
  messageUnavailableMaxBeforePrune: number;
  /** Cooldown between permission-error notifications per (chat, code). */
  permissionNotifyCooldownMs: number;
}

export const DEFAULT_FEISHU_TUNING: FeishuTuning = {
  cardFlushIntervalMs: 800,
  cardFailureThreshold: 3,
  cardBodyMaxChars: 28_000,
  imageResolveTimeoutMs: 3_000,
  imageMaxBytes: 5 * 1024 * 1024,
  imageCacheCap: 256,
  messageUnavailableTtlMs: 30 * 60 * 1000,
  messageUnavailableMaxBeforePrune: 512,
  permissionNotifyCooldownMs: 5 * 60 * 1000,
};

/**
 * Merge a partial override with defaults. Unknown fields are ignored. Used
 * by config parsing — callers should never pass user input directly to
 * subsystems.
 */
export function resolveFeishuTuning(partial: Partial<FeishuTuning> | undefined): FeishuTuning {
  if (!partial) return { ...DEFAULT_FEISHU_TUNING };
  return { ...DEFAULT_FEISHU_TUNING, ...stripUndefined(partial) };
}

function stripUndefined<T extends object>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
