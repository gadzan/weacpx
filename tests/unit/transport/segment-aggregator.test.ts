import { describe, expect, test } from "bun:test";
import { SegmentAggregator } from "../../../src/transport/segment-aggregator";

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("SegmentAggregator", () => {
  test("single segment is not flushed immediately", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const agg = new SegmentAggregator({
      windowMs: 5_000,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 src/foo.ts");
    expect(flushed).toEqual([]);

    // Drain pending state without invoking flush callback.
    expect(agg.finalize()).toBe("📖 src/foo.ts");
    expect(flushed).toEqual([]);
  });

  test("identical consecutive tool-call segments fold into (×N)", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const agg = new SegmentAggregator({
      windowMs: 5_000,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 src/foo.ts");
    agg.feed("📖 src/foo.ts");
    agg.feed("📖 src/foo.ts");

    expect(agg.finalize()).toBe("📖 src/foo.ts (×3)");
  });

  test("segments with different prefixes are joined by newlines", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const agg = new SegmentAggregator({
      windowMs: 5_000,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 src/foo.ts");
    agg.feed("🔍 needle");
    agg.feed("💻 ls");

    expect(agg.finalize()).toBe("📖 src/foo.ts\n🔍 needle\n💻 ls");
  });

  test("finalize returns pending tail and clears state", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const agg = new SegmentAggregator({
      windowMs: 5_000,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 a.ts");
    agg.feed("📖 a.ts");
    expect(agg.finalize()).toBe("📖 a.ts (×2)");

    // After finalize, further feeds are dropped and state is empty.
    agg.feed("📖 b.ts");
    expect(agg.finalize()).toBe("");
    expect(flushed).toEqual([]);
  });

  test("fake clock: feed after window elapsed triggers immediate flush", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    const agg = new SegmentAggregator({
      windowMs: 5_000,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 a.ts");
    expect(flushed).toEqual([]);

    // Within the window — still no flush.
    clock.advance(4_999);
    agg.feed("📖 a.ts");
    expect(flushed).toEqual([]);

    // Cross the window boundary on the next feed — it flushes the run so far,
    // including the segment that just arrived.
    clock.advance(1);
    agg.feed("🔍 q");
    expect(flushed).toEqual(["📖 a.ts (×2)\n🔍 q"]);

    // After flush, lastFlushAt is reset; the next feed should not re-fire.
    agg.feed("🔍 q");
    expect(flushed).toEqual(["📖 a.ts (×2)\n🔍 q"]);

    expect(agg.finalize()).toBe("🔍 q");
  });

  test("windowMs as a function is evaluated each feed", () => {
    const flushed: string[] = [];
    const clock = makeClock();
    let currentWindow = 5_000;
    const agg = new SegmentAggregator({
      windowMs: () => currentWindow,
      now: clock.now,
      flush: (text) => flushed.push(text),
    });

    // First feed: window=5_000, advance 4_999 → still within window.
    agg.feed("📖 a.ts");
    clock.advance(4_999);
    agg.feed("📖 b.ts");
    expect(flushed).toEqual([]);

    // Tighten window to 1_000 — now since lastFlushAt was 0, elapsed=4_999
    // already >= 1_000 so the next feed flushes immediately.
    currentWindow = 1_000;
    agg.feed("🔍 q");
    expect(flushed).toEqual(["📖 a.ts\n📖 b.ts\n🔍 q"]);

    // After flush, lastFlushAt = 4_999. Widen window to 60_000 — even after
    // advancing 30_000, no flush should fire on next feed.
    currentWindow = 60_000;
    clock.advance(30_000);
    agg.feed("💻 ls");
    expect(flushed).toEqual(["📖 a.ts\n📖 b.ts\n🔍 q"]);
  });

  test("windowMs function reschedules the timer with the freshly evaluated value", async () => {
    const flushed: string[] = [];
    const windows = [10, 50];
    let idx = 0;
    const agg = new SegmentAggregator({
      windowMs: () => windows[Math.min(idx, windows.length - 1)]!,
      flush: (text) => flushed.push(text),
    });

    agg.feed("A");
    // After first feed, timer scheduled with 10ms.
    await new Promise((r) => setTimeout(r, 30));
    expect(flushed).toEqual(["A"]);

    // Now widen the window to 50ms; the next feed schedules with 50ms.
    idx = 1;
    agg.feed("B");
    await new Promise((r) => setTimeout(r, 20));
    // Within 50ms window, no flush yet.
    expect(flushed).toEqual(["A"]);
    await new Promise((r) => setTimeout(r, 60));
    expect(flushed).toEqual(["A", "B"]);
  });

  test("real timer fires flush after windowMs without further feeds", async () => {
    const flushed: string[] = [];
    const agg = new SegmentAggregator({
      windowMs: 20,
      flush: (text) => flushed.push(text),
    });

    agg.feed("📖 a.ts");
    expect(flushed).toEqual([]);

    await new Promise((r) => setTimeout(r, 60));
    expect(flushed).toEqual(["📖 a.ts"]);

    // finalize after timer-driven flush returns empty.
    expect(agg.finalize()).toBe("");
  });
});
