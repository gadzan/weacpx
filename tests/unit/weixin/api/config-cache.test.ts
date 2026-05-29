import { describe, expect, test } from "bun:test";

import { WeixinConfigManager } from "../../../../src/weixin/api/config-cache";

describe("WeixinConfigManager cache retention", () => {
  test("evicts stale user config entries lazily", async () => {
    let now = 1_000;
    const manager = new WeixinConfigManager(
      { baseUrl: "https://example.test", token: "token" },
      () => {},
      {
        now: () => now,
        entryTtlMs: 100,
        getConfig: async ({ ilinkUserId }) => ({ ret: 0, typing_ticket: `ticket-${ilinkUserId}` }),
      },
    );

    expect(await manager.getForUser("old")).toEqual({ typingTicket: "ticket-old" });
    now = 1_200;
    expect(await manager.getForUser("new")).toEqual({ typingTicket: "ticket-new" });

    expect(manager.cacheSizeForTests()).toBe(1);
    expect(manager.hasCachedUserForTests("old")).toBe(false);
    expect(manager.hasCachedUserForTests("new")).toBe(true);
  });

  test("caps user config cache by least recently touched entry", async () => {
    let now = 1_000;
    const manager = new WeixinConfigManager(
      { baseUrl: "https://example.test", token: "token" },
      () => {},
      {
        now: () => now,
        maxEntries: 2,
        getConfig: async ({ ilinkUserId }) => ({ ret: 0, typing_ticket: `ticket-${ilinkUserId}` }),
      },
    );

    await manager.getForUser("a");
    now += 1;
    await manager.getForUser("b");
    now += 1;
    await manager.getForUser("c");

    expect(manager.cacheSizeForTests()).toBe(2);
    expect(manager.hasCachedUserForTests("a")).toBe(false);
    expect(manager.hasCachedUserForTests("b")).toBe(true);
    expect(manager.hasCachedUserForTests("c")).toBe(true);
  });
});
