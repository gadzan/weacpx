import { describe, expect, mock, test } from "bun:test";
import {
  FINAL_BUDGET,
  MID_BUDGET,
  QuotaManager,
  type QuotaObserver,
  type QuotaSnapshot,
} from "../../../src/weixin/messaging/quota-manager";

describe("QuotaManager v1.3", () => {
  test("budget constants are 6 mid + 4 final", () => {
    expect(MID_BUDGET).toBe(6);
    expect(FINAL_BUDGET).toBe(4);
  });

  test("reserveMidSegment succeeds 6 times then returns false on the 7th", () => {
    const quota = new QuotaManager();
    const chatKey = "wx:user-a";

    for (let i = 0; i < 6; i++) {
      expect(quota.reserveMidSegment(chatKey)).toBe(true);
    }
    expect(quota.reserveMidSegment(chatKey)).toBe(false);
    expect(quota.snapshot(chatKey).midUsed).toBe(6);
  });

  test("reserveFinal succeeds 4 times then returns false on the 5th", () => {
    const quota = new QuotaManager();
    const chatKey = "wx:user-b";

    for (let i = 0; i < 4; i++) {
      expect(quota.reserveFinal(chatKey)).toBe(true);
    }
    expect(quota.reserveFinal(chatKey)).toBe(false);
    expect(quota.snapshot(chatKey).finalUsed).toBe(4);
  });

  test("snapshot reflects mid+final remaining and total remaining", () => {
    const quota = new QuotaManager();
    const chatKey = "wx:user-d";

    expect(quota.snapshot(chatKey)).toEqual({
      midUsed: 0,
      finalUsed: 0,
      midRemaining: 6,
      finalRemaining: 4,
      remaining: 10,
    });

    quota.reserveMidSegment(chatKey);
    quota.reserveMidSegment(chatKey);
    quota.reserveFinal(chatKey);
    expect(quota.snapshot(chatKey)).toEqual({
      midUsed: 2,
      finalUsed: 1,
      midRemaining: 4,
      finalRemaining: 3,
      remaining: 7,
    });

    for (let i = 0; i < 4; i++) quota.reserveMidSegment(chatKey);
    for (let i = 0; i < 3; i++) quota.reserveFinal(chatKey);
    expect(quota.snapshot(chatKey)).toEqual({
      midUsed: 6,
      finalUsed: 4,
      midRemaining: 0,
      finalRemaining: 0,
      remaining: 0,
    });
  });

  test("onInbound resets midUsed and finalUsed to 0", () => {
    const quota = new QuotaManager();
    const chatKey = "wx:user-c";

    for (let i = 0; i < 6; i++) quota.reserveMidSegment(chatKey);
    for (let i = 0; i < 4; i++) quota.reserveFinal(chatKey);
    expect(quota.snapshot(chatKey).remaining).toBe(0);

    quota.onInbound(chatKey);
    expect(quota.snapshot(chatKey)).toEqual({
      midUsed: 0,
      finalUsed: 0,
      midRemaining: 6,
      finalRemaining: 4,
      remaining: 10,
    });
    expect(quota.reserveMidSegment(chatKey)).toBe(true);
    expect(quota.reserveFinal(chatKey)).toBe(true);
  });

  test("multiple chatKeys are isolated", () => {
    const quota = new QuotaManager();
    const a = "wx:alice";
    const b = "wx:bob";

    for (let i = 0; i < 6; i++) expect(quota.reserveMidSegment(a)).toBe(true);
    for (let i = 0; i < 4; i++) expect(quota.reserveFinal(a)).toBe(true);
    expect(quota.reserveMidSegment(a)).toBe(false);
    expect(quota.reserveFinal(a)).toBe(false);

    expect(quota.snapshot(b).remaining).toBe(10);
    expect(quota.reserveMidSegment(b)).toBe(true);
    expect(quota.reserveFinal(b)).toBe(true);
    expect(quota.snapshot(b).midUsed).toBe(1);
    expect(quota.snapshot(b).finalUsed).toBe(1);

    expect(quota.snapshot(a).midUsed).toBe(6);
    expect(quota.snapshot(a).finalUsed).toBe(4);
  });

  test("observer fires inbound, mid_reserved, mid_rejected, final_reserved, final_rejected with correct snapshots", () => {
    const observer: Required<QuotaObserver> = {
      onInbound: mock((_chatKey: string) => {}),
      onMidReserved: mock((_chatKey: string, _snap: QuotaSnapshot) => {}),
      onMidRejected: mock((_chatKey: string, _snap: QuotaSnapshot) => {}),
      onFinalReserved: mock((_chatKey: string, _snap: QuotaSnapshot) => {}),
      onFinalRejected: mock((_chatKey: string, _snap: QuotaSnapshot) => {}),
    };
    const quota = new QuotaManager(observer);
    const chatKey = "wx:obs";

    quota.onInbound(chatKey);
    expect(observer.onInbound).toHaveBeenCalledWith(chatKey);

    expect(quota.reserveMidSegment(chatKey)).toBe(true);
    expect(observer.onMidReserved).toHaveBeenCalledTimes(1);
    expect(observer.onMidReserved.mock.calls[0]?.[1]).toMatchObject({
      midUsed: 1,
      finalUsed: 0,
      midRemaining: 5,
      finalRemaining: 4,
      remaining: 9,
    });

    for (let i = 0; i < 5; i++) quota.reserveMidSegment(chatKey);
    expect(observer.onMidReserved).toHaveBeenCalledTimes(6);

    expect(quota.reserveMidSegment(chatKey)).toBe(false);
    expect(observer.onMidRejected).toHaveBeenCalledTimes(1);
    expect(observer.onMidRejected.mock.calls[0]?.[1]).toMatchObject({
      midUsed: 6,
      midRemaining: 0,
      finalRemaining: 4,
    });

    for (let i = 0; i < 4; i++) expect(quota.reserveFinal(chatKey)).toBe(true);
    expect(observer.onFinalReserved).toHaveBeenCalledTimes(4);
    expect(observer.onFinalReserved.mock.calls[3]?.[1]).toMatchObject({
      midUsed: 6,
      finalUsed: 4,
      finalRemaining: 0,
      remaining: 0,
    });

    expect(quota.reserveFinal(chatKey)).toBe(false);
    expect(observer.onFinalRejected).toHaveBeenCalledTimes(1);
    expect(observer.onFinalRejected.mock.calls[0]?.[1]).toMatchObject({
      finalUsed: 4,
      finalRemaining: 0,
    });
  });

  test("v1.4: enqueue / hasPending / countPending / drain / clearPending isolate per chatKey", () => {
    const quota = new QuotaManager();
    const a = "wx:a";
    const b = "wx:b";

    expect(quota.hasPendingFinal(a)).toBe(false);
    expect(quota.countPendingFinal(a)).toBe(0);

    quota.enqueuePendingFinal(a, [
      { text: "(5/8) p5", seq: 5, total: 8 },
      { text: "(6/8) p6", seq: 6, total: 8 },
      { text: "(7/8) p7", seq: 7, total: 8 },
      { text: "(8/8) p8", seq: 8, total: 8 },
    ]);
    expect(quota.hasPendingFinal(a)).toBe(true);
    expect(quota.countPendingFinal(a)).toBe(4);
    expect(quota.hasPendingFinal(b)).toBe(false);

    // Drain up to 2 → leaves 2 pending; first wave keeps order/numbering.
    const wave1 = quota.drainPendingFinalUpToBudget(a, 2);
    expect(wave1.map((c) => c.seq)).toEqual([5, 6]);
    expect(quota.countPendingFinal(a)).toBe(2);

    quota.prependPendingFinal(a, wave1.slice(1));
    expect(quota.countPendingFinal(a)).toBe(3);

    const wave2 = quota.drainPendingFinalUpToBudget(a, 4);
    expect(wave2.map((c) => c.seq)).toEqual([6, 7, 8]);
    expect(quota.hasPendingFinal(a)).toBe(false);

    quota.enqueuePendingFinal(a, [{ text: "(2/2) tail", seq: 2, total: 2 }]);
    quota.clearPendingFinal(a);
    expect(quota.hasPendingFinal(a)).toBe(false);
  });

  test("v1.4: onInbound resets usage but PRESERVES pendingFinalChunks", () => {
    const quota = new QuotaManager();
    const a = "wx:keep-pending";

    for (let i = 0; i < 4; i++) quota.reserveFinal(a);
    quota.enqueuePendingFinal(a, [{ text: "(5/8) p5", seq: 5, total: 8 }]);

    quota.onInbound(a);
    expect(quota.snapshot(a).finalUsed).toBe(0);
    expect(quota.snapshot(a).midUsed).toBe(0);
    expect(quota.hasPendingFinal(a)).toBe(true); // preserved by design
    expect(quota.countPendingFinal(a)).toBe(1);
  });

  test("v1.4: finalRemaining reflects FINAL_BUDGET minus finalUsed", () => {
    const quota = new QuotaManager();
    const a = "wx:rem";
    expect(quota.finalRemaining(a)).toBe(4);
    quota.reserveFinal(a);
    quota.reserveFinal(a);
    expect(quota.finalRemaining(a)).toBe(2);
    quota.reserveFinal(a);
    quota.reserveFinal(a);
    expect(quota.finalRemaining(a)).toBe(0);
  });

  test("observer is optional", () => {
    const quota = new QuotaManager();
    expect(quota.reserveMidSegment("wx:none")).toBe(true);
    expect(quota.reserveFinal("wx:none")).toBe(true);
    expect(quota.snapshot("wx:none")).toMatchObject({
      midUsed: 1,
      finalUsed: 1,
      remaining: 8,
    });
  });
});
