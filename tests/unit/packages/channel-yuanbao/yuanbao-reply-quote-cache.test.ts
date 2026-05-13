import { expect, test } from "bun:test";

import { ReplyQuoteCache } from "../../../../packages/channel-yuanbao/src/reply-quote-cache";

test("ReplyQuoteCache.has returns false for new keys, true after add", () => {
  const cache = new ReplyQuoteCache();
  expect(cache.has("a")).toBe(false);
  cache.add("a");
  expect(cache.has("a")).toBe(true);
});

test("ReplyQuoteCache evicts entries past ttlMs", () => {
  let now = 1_000;
  const cache = new ReplyQuoteCache({ ttlMs: 100, now: () => now });
  cache.add("a");
  expect(cache.has("a")).toBe(true);
  now += 99;
  expect(cache.has("a")).toBe(true);
  now += 2;
  expect(cache.has("a")).toBe(false);
  expect(cache.size()).toBe(0);
});

test("ReplyQuoteCache drops oldest insertion when maxEntries exceeded", () => {
  let now = 1_000;
  const cache = new ReplyQuoteCache({ ttlMs: 60_000, maxEntries: 3, now: () => now });
  cache.add("a"); now += 1;
  cache.add("b"); now += 1;
  cache.add("c"); now += 1;
  cache.add("d"); // forces eviction of "a"
  expect(cache.has("a")).toBe(false);
  expect(cache.has("b")).toBe(true);
  expect(cache.has("c")).toBe(true);
  expect(cache.has("d")).toBe(true);
  expect(cache.size()).toBe(3);
});

test("ReplyQuoteCache prefers evicting expired entries over fresh ones", () => {
  let now = 1_000;
  const cache = new ReplyQuoteCache({ ttlMs: 100, maxEntries: 3, now: () => now });
  cache.add("a"); // expires at 1100
  cache.add("b"); // expires at 1100
  now = 1_200; // a, b expired
  cache.add("c"); // expires at 1300; size becomes 3 (a,b,c)
  cache.add("d"); // size 4 → evictIfNeeded clears expired (a,b) first
  expect(cache.has("a")).toBe(false);
  expect(cache.has("b")).toBe(false);
  expect(cache.has("c")).toBe(true);
  expect(cache.has("d")).toBe(true);
});

test("ReplyQuoteCache.add on existing key refreshes TTL", () => {
  let now = 1_000;
  const cache = new ReplyQuoteCache({ ttlMs: 100, now: () => now });
  cache.add("a");
  now += 80;
  cache.add("a");
  now += 80; // 160ms total — original would have expired at 1100
  expect(cache.has("a")).toBe(true);
});

test("ReplyQuoteCache.clear empties the cache", () => {
  const cache = new ReplyQuoteCache();
  cache.add("a"); cache.add("b");
  cache.clear();
  expect(cache.size()).toBe(0);
  expect(cache.has("a")).toBe(false);
});
