/**
 * Per-account, per-group rolling history of inbound text messages.
 *
 * Used to assemble context when the bot is @mentioned in a group — users
 * naturally say "what about that thing he just mentioned?" and expect the
 * agent to see the last few messages even though they didn't all @ the bot.
 *
 * Lifecycle:
 * - `record()` is called for every non-self inbound group message.
 * - `consume()` returns the accumulated entries when the bot is addressed
 *   (and clears them — by then they're folded into the prompt).
 * - Each group keeps at most `perGroupLimit` entries (newest wins).
 * - The store caps total groups (LRU-by-last-write) so a runaway burst of
 *   chats from many groups can't grow memory without bound.
 *
 * Set `perGroupLimit: 0` (i.e. the account's `historyLimit`) to disable.
 */

export interface GroupHistoryEntry {
  senderId: string;
  senderName?: string;
  text: string;
  /** ms since epoch */
  timestamp: number;
  messageId?: string;
}

export interface GroupHistoryStoreOptions {
  /** Max entries per (accountId, groupCode). Default 100. 0 disables recording. */
  perGroupLimit?: number;
  /** Max distinct groups tracked across all accounts. Default 256. */
  maxGroups?: number;
}

interface GroupBucket {
  entries: GroupHistoryEntry[];
  lastTouched: number;
}

export class GroupHistoryStore {
  private readonly perGroupLimit: number;
  private readonly maxGroups: number;
  private readonly groups = new Map<string, GroupBucket>();

  constructor(options: GroupHistoryStoreOptions = {}) {
    this.perGroupLimit = options.perGroupLimit ?? 100;
    this.maxGroups = options.maxGroups ?? 256;
  }

  isEnabled(): boolean {
    return this.perGroupLimit > 0;
  }

  /**
   * Append an entry to the (accountId, groupCode) bucket. No-op when the
   * store is disabled, when the entry has empty text, or when called for a
   * non-group context.
   */
  record(accountId: string, groupCode: string, entry: GroupHistoryEntry): void {
    if (!this.isEnabled()) return;
    if (!entry.text.trim()) return;
    const key = this.key(accountId, groupCode);
    const now = Date.now();
    let bucket = this.groups.get(key);
    if (!bucket) {
      this.evictIfNeeded();
      bucket = { entries: [], lastTouched: now };
      this.groups.set(key, bucket);
    }
    bucket.entries.push(entry);
    if (bucket.entries.length > this.perGroupLimit) {
      bucket.entries.splice(0, bucket.entries.length - this.perGroupLimit);
    }
    bucket.lastTouched = now;
    // Re-insert to refresh LRU position (Map preserves insertion order).
    this.groups.delete(key);
    this.groups.set(key, bucket);
  }

  /**
   * Return a snapshot of the bucket's entries (oldest-first) and clear it.
   * Returns an empty array when the bucket is empty or the store is disabled.
   */
  consume(accountId: string, groupCode: string): GroupHistoryEntry[] {
    if (!this.isEnabled()) return [];
    const key = this.key(accountId, groupCode);
    const bucket = this.groups.get(key);
    if (!bucket || bucket.entries.length === 0) return [];
    const out = bucket.entries.slice();
    this.groups.delete(key);
    return out;
  }

  clearAccount(accountId: string): void {
    const prefix = `${accountId}::`;
    for (const key of [...this.groups.keys()]) {
      if (key.startsWith(prefix)) this.groups.delete(key);
    }
  }

  clear(): void {
    this.groups.clear();
  }

  /** Test/diagnostic helper. */
  sizeForTests(): number {
    return this.groups.size;
  }

  /** Test/diagnostic helper. */
  peekForTests(accountId: string, groupCode: string): GroupHistoryEntry[] {
    return this.groups.get(this.key(accountId, groupCode))?.entries.slice() ?? [];
  }

  private key(accountId: string, groupCode: string): string {
    return `${accountId}::${groupCode}`;
  }

  private evictIfNeeded(): void {
    while (this.groups.size >= this.maxGroups) {
      const oldest = this.groups.keys().next().value;
      if (oldest === undefined) return;
      this.groups.delete(oldest);
    }
  }
}

/**
 * Format a list of history entries as readable agent-facing context.
 * Returns "" when the list is empty.
 */
export function formatGroupHistoryContext(entries: GroupHistoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    const who = e.senderName ?? e.senderId;
    const time = formatClock(e.timestamp);
    return `- @${who} (${time}): ${e.text.replace(/\n+/g, " ")}`;
  });
  return `[group history]\n${lines.join("\n")}`;
}

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
