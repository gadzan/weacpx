/**
 * Bounded TTL set for tracking which `(route, replyContextToken)` pairs have
 * already been used to quote-reply once. Without an upper bound + TTL the set
 * grows for the entire daemon lifetime (one entry per inbound message under
 * `replyToMode: "first"`).
 *
 * Implementation: insertion-ordered Map of key→expiresAt. On `has`/`add` we
 * lazily evict expired entries; when size hits `maxEntries` we drop the oldest
 * insertion (Map iteration order preserves insertion order).
 */
export class ReplyQuoteCache {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  has(key: string): boolean {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string): void {
    const now = this.now();
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, now + this.ttlMs);
    this.evictIfNeeded();
  }

  clear(): void {
    this.entries.clear();
  }

  /** Test/inspection helper. */
  size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const now = this.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(key);
        if (this.entries.size <= this.maxEntries) return;
      }
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
