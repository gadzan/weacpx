import { describe, expect, test } from "bun:test";

import {
  buildOverflowSummary,
  createQuotaGatedReplySink,
  DEFAULT_HEADS_UP_TEXT,
} from "../../../src/transport/quota-gated-reply-sink";
import { QuotaManager } from "../../../src/weixin/messaging/quota-manager";

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("streaming-prompt quota integration", () => {
  test("first 6 distinct mid segments are flushed within budget", async () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const quota = new QuotaManager();
    const chatKey = "wx:user-a";
    quota.onInbound(chatKey);

    const sink = createQuotaGatedReplySink({
      reply: async (text) => {
        flushed.push(text);
      },
      replyContext: { chatKey, quota },
      now: clock.now,
      windowMs: 5_000,
    });

    for (let i = 0; i < 6; i += 1) {
      sink.feedSegment(`📖 file-${i}`);
      clock.advance(6_000);
      sink.feedSegment(`flush-trigger-${i}`);
    }

    sink.finalize();

    await Promise.resolve();
    await Promise.resolve();

    expect(sink.getOverflowCount()).toBe(0);
    const fileMessages = flushed.filter((m) => m.includes("📖 file-"));
    expect(fileMessages.length).toBe(6);
  });

  test("segments beyond the mid budget are counted as overflow and not sent", async () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const quota = new QuotaManager();
    const chatKey = "wx:user-b";
    quota.onInbound(chatKey);

    const sink = createQuotaGatedReplySink({
      reply: async (text) => {
        flushed.push(text);
      },
      replyContext: { chatKey, quota },
      now: clock.now,
      windowMs: 5_000,
    });

    // Push 12 segments forcing immediate flush each iteration.
    for (let i = 0; i < 12; i += 1) {
      sink.feedSegment(`📖 file-${i}`);
      clock.advance(6_000);
      sink.feedSegment(`tail-${i}`);
    }
    sink.finalize();

    await Promise.resolve();
    await Promise.resolve();

    // Mid budget is 6 — anything past that should overflow.
    expect(sink.getOverflowCount()).toBeGreaterThanOrEqual(6);
    const summary = buildOverflowSummary(sink.getOverflowCount());
    expect(summary).toContain("省略");
    expect(summary).toContain(`${sink.getOverflowCount()}`);
  });

  test("without replyContext, quota gate is bypassed and all segments flush", async () => {
    const flushed: string[] = [];
    const clock = makeClock();

    const sink = createQuotaGatedReplySink({
      reply: async (text) => {
        flushed.push(text);
      },
      now: clock.now,
      windowMs: 5_000,
    });

    for (let i = 0; i < 15; i += 1) {
      sink.feedSegment(`📖 file-${i}`);
      clock.advance(6_000);
      sink.feedSegment(`tail-${i}`);
    }
    sink.finalize();

    await Promise.resolve();
    await Promise.resolve();

    expect(sink.getOverflowCount()).toBe(0);
    const fileMessages = flushed.filter((m) => m.includes("📖 file-"));
    expect(fileMessages.length).toBe(15);
  });

  test("buildOverflowSummary returns undefined for zero overflow", () => {
    expect(buildOverflowSummary(0)).toBeUndefined();
    expect(buildOverflowSummary(-1)).toBeUndefined();
  });

  test("verbose long task: 12 mid segments → exactly 6 reserved (6th carries heads-up tail), overflow=6, midUsed=6", async () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const quota = new QuotaManager();
    const chatKey = "wx:user-verbose";
    quota.onInbound(chatKey);

    const sink = createQuotaGatedReplySink({
      reply: async (text) => {
        flushed.push(text);
      },
      replyContext: { chatKey, quota },
      now: clock.now,
      windowMs: 5_000,
    });

    for (let i = 0; i < 12; i += 1) {
      sink.feedSegment(`📖 file-${i}`);
      clock.advance(6_000);
      sink.feedSegment(`flush-trigger-${i}`);
    }
    sink.finalize();

    await Promise.resolve();
    await Promise.resolve();

    expect(sink.getOverflowCount()).toBe(6);
    const fileMessages = flushed.filter((m) => m.includes("📖 file-"));
    expect(fileMessages.length).toBe(6);

    expect(fileMessages[5]!.endsWith(DEFAULT_HEADS_UP_TEXT)).toBe(true);
    expect(flushed.filter((m) => m.includes(DEFAULT_HEADS_UP_TEXT)).length).toBe(1);

    const snap = quota.snapshot(chatKey);
    expect(snap.midUsed).toBe(6);
    // mid empty + 4 final still available = remaining 4.
    expect(snap.remaining).toBe(4);

    const summary = buildOverflowSummary(sink.getOverflowCount());
    expect(summary).toContain("省略 6");
  });
});
