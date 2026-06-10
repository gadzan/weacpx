import { describe, expect, test, beforeEach, afterAll } from "bun:test";

import { drainPendingFinalForJx, handleSlashCommand } from "../../../src/weixin/messaging/slash-commands";
import type { PendingFinalChunk } from "../../../src/weixin/messaging/quota-manager";
import type { SlashCommandContext } from "../../../src/weixin/messaging/slash-commands";
import { setLocale } from "../../../src/i18n";

beforeEach(() => { setLocale("zh"); });
afterAll(() => { setLocale("en"); });

const sentTexts: string[] = [];

function baseCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    to: "wx:user",
    contextToken: "ctx",
    baseUrl: "https://example.com",
    token: "t",
    accountId: "acct",
    log: () => {},
    errLog: () => {},
    sendText: async (params) => {
      sentTexts.push(params.text);
    },
    ...overrides,
  };
}

describe("/logout chat command removal", () => {
  test("/logout is no longer handled (no unauthenticated credential wipe)", async () => {
    // Must fall through as an unknown command: any chat peer could previously
    // trigger clearAllWeixinAccounts() with zero authorization. CLI `xacpx
    // logout` is the only remaining logout surface.
    const result = await handleSlashCommand("/logout", baseCtx(), Date.now());
    expect(result.handled).toBe(false);
  });
});

describe("v1.4: /jx drains pending final pages", () => {
  beforeEach(() => {
    sentTexts.length = 0;
  });

  test("/jx with no pending → no-op (no send)", async () => {
    const ctx = baseCtx({
      hasPendingFinal: () => false,
      drainPendingFinal: () => [],
      prependPendingFinal: () => {},
      reserveFinal: () => true,
      finalRemaining: () => 4,
    });

    await drainPendingFinalForJx(ctx);
    expect(sentTexts).toEqual([]);
  });

  test("/jx with 4 pending and finalRemaining=4 → drains all 4, no heads-up tail", async () => {
    const queue: PendingFinalChunk[] = [
      { text: "(5/8) p5", seq: 5, total: 8 },
      { text: "(6/8) p6", seq: 6, total: 8 },
      { text: "(7/8) p7", seq: 7, total: 8 },
      { text: "(8/8) p8", seq: 8, total: 8 },
    ];

    const ctx = baseCtx({
      hasPendingFinal: () => queue.length > 0,
      drainPendingFinal: (_chat, available) => queue.splice(0, available),
      prependPendingFinal: (_chat, chunks) => queue.unshift(...chunks),
      reserveFinal: () => true,
      finalRemaining: () => 4,
    });

    await drainPendingFinalForJx(ctx);
    expect(sentTexts.length).toBe(4);
    expect(sentTexts[0]!.startsWith("(5/8) ")).toBe(true);
    expect(sentTexts[3]!.startsWith("(8/8) ")).toBe(true);
    expect(sentTexts.some((t) => t.includes("📄"))).toBe(false);
    expect(queue.length).toBe(0);
  });

  test("/jx with 4 pending but finalRemaining=2 → sends 2 with heads-up; remaining 2 stay pending", async () => {
    const queue: PendingFinalChunk[] = [
      { text: "(5/8) p5", seq: 5, total: 8 },
      { text: "(6/8) p6", seq: 6, total: 8 },
      { text: "(7/8) p7", seq: 7, total: 8 },
      { text: "(8/8) p8", seq: 8, total: 8 },
    ];

    const ctx = baseCtx({
      hasPendingFinal: () => queue.length > 0,
      drainPendingFinal: (_chat, available) => queue.splice(0, available),
      prependPendingFinal: (_chat, chunks) => queue.unshift(...chunks),
      reserveFinal: () => true,
      finalRemaining: () => 2,
    });

    await drainPendingFinalForJx(ctx);
    expect(sentTexts.length).toBe(2);
    expect(sentTexts[0]!.startsWith("(5/8) ")).toBe(true);
    expect(sentTexts[1]!.startsWith("(6/8) ")).toBe(true);
    expect(sentTexts[1]!).toContain("📄 结果共 8 段，已发 6 段");
    expect(sentTexts[1]!).toContain("/jx");
    expect(sentTexts[0]!).not.toContain("📄");
    expect(queue.length).toBe(2);
  });

  test("/jx restores unsent pages to the front when reserveFinal rejects", async () => {
    const queue: PendingFinalChunk[] = [
      { text: "(5/8) p5", seq: 5, total: 8 },
      { text: "(6/8) p6", seq: 6, total: 8 },
      { text: "(7/8) p7", seq: 7, total: 8 },
      { text: "(8/8) p8", seq: 8, total: 8 },
    ];
    let reserveCalls = 0;

    const ctx = baseCtx({
      hasPendingFinal: () => queue.length > 0,
      drainPendingFinal: (_chat, available) => queue.splice(0, available),
      prependPendingFinal: (_chat, chunks) => queue.unshift(...chunks),
      reserveFinal: () => {
        reserveCalls += 1;
        return reserveCalls === 1;
      },
      finalRemaining: () => 4,
    });

    await drainPendingFinalForJx(ctx);
    expect(sentTexts).toEqual(["(5/8) p5"]);
    expect(queue.map((c) => c.seq)).toEqual([6, 7, 8]);
    expect(queue[2]!.text).toBe("(8/8) p8");
  });

  test("/jx restores current and later pages to the front when send fails", async () => {
    const queue: PendingFinalChunk[] = [
      { text: "(5/8) p5", seq: 5, total: 8 },
      { text: "(6/8) p6", seq: 6, total: 8 },
      { text: "(7/8) p7", seq: 7, total: 8 },
      { text: "(8/8) p8", seq: 8, total: 8 },
    ];
    let sendCalls = 0;

    const ctx = baseCtx({
      hasPendingFinal: () => queue.length > 0,
      drainPendingFinal: (_chat, available) => queue.splice(0, available),
      prependPendingFinal: (_chat, chunks) => queue.unshift(...chunks),
      reserveFinal: () => true,
      finalRemaining: () => 4,
      sendText: async (params) => {
        sendCalls += 1;
        if (sendCalls === 2) throw new Error("network");
        sentTexts.push(params.text);
      },
    });

    await drainPendingFinalForJx(ctx);
    expect(sentTexts).toEqual(["(5/8) p5"]);
    expect(queue.map((c) => c.seq)).toEqual([6, 7, 8]);
    expect(queue[2]!.text).toBe("(8/8) p8");
  });
});
