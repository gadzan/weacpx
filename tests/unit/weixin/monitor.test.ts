import { describe, expect, mock, test, beforeEach } from "bun:test";

// Tests focused on v1.4 behavior in monitor.ts:
//   - non-/jx inbound triggers dropPendingFinal alongside onInbound
//   - /jx inbound triggers onInbound but does NOT drop pending
//
// We mock getUpdates to return a single message and abort right after, then
// observe the callback invocations.

beforeEach(() => {
  mock.restore();
});

async function runOneInbound(textBody: string): Promise<{
  inboundCalls: string[];
  dropCalls: string[];
  configCalls: string[];
  typingTickets: string[];
}> {
  const inboundCalls: string[] = [];
  const dropCalls: string[] = [];
  const configCalls: string[] = [];
  const typingTickets: string[] = [];

  let calls = 0;
  mock.module("../../../src/weixin/api/api.ts", () => ({
    getUpdates: async (params: { abortSignal?: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        return {
          ret: 0,
          errcode: 0,
          get_updates_buf: "",
          msgs: [
            {
              from_user_id: "test-user",
              to_user_id: "bot",
              message_id: 1,
              create_time_ms: Date.now(),
              context_token: "ctx",
              item_list: [{ type: 1, text_item: { text: textBody } }],
            },
          ],
          longpolling_timeout_ms: 0,
        };
      }
      // Subsequent calls reject via abort signal.
      return await new Promise((_resolve, reject) => {
        params.abortSignal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
    sendMessage: async () => ({}),
    sendTyping: async () => ({}),
  }));

  mock.module("../../../src/weixin/api/config-cache.ts", () => ({
    WeixinConfigManager: class {
      async getForUser(userId: string) {
        configCalls.push(userId);
        return { typingTicket: "ticket-from-config" };
      }
    },
  }));

  mock.module("../../../src/weixin/messaging/conversation-executor.ts", () => ({
    createConversationExecutor: () => ({
      run: async (_chat: string, _lane: string, fn: () => Promise<void>) => {
        await fn();
      },
    }),
  }));

  // Replace handleWeixinMessageTurn with a stub so the test does not exercise
  // agent / sendMessage paths.
  mock.module("../../../src/weixin/messaging/handle-weixin-message-turn.ts", () => ({
    getWeixinMessageTurnLane: () => "normal",
    handleWeixinMessageTurn: async (_full: unknown, deps: { typingTicket?: string }) => {
      typingTickets.push(deps.typingTicket ?? "");
    },
  }));

  mock.module("../../../src/weixin/storage/sync-buf.ts", () => ({
    getSyncBufFilePath: () => "/tmp/none",
    loadGetUpdatesBuf: () => "",
    saveGetUpdatesBuf: () => {},
  }));

  const { monitorWeixinProvider } = await import(
    "../../../src/weixin/monitor/monitor"
  );

  const ac = new AbortController();
  // Abort after a short tick so the loop only handles the single message.
  setTimeout(() => ac.abort(), 50);

  await monitorWeixinProvider({
    baseUrl: "https://example.com",
    cdnBaseUrl: "https://cdn.example.com",
    token: "t",
    accountId: "acct",
    agent: { chat: async () => ({ text: "" }) },
    abortSignal: ac.signal,
    log: () => {},
    onInbound: (chat) => inboundCalls.push(chat),
    dropPendingFinal: (chat) => dropCalls.push(chat),
  });

  return { inboundCalls, dropCalls, configCalls, typingTickets };
}

describe("v1.4: monitor drops pending final on non-/jx inbound", () => {
  test("plain text inbound triggers both onInbound and dropPendingFinal", async () => {
    const { inboundCalls, dropCalls } = await runOneInbound("hello there");
    expect(inboundCalls).toEqual(["test-user"]);
    expect(dropCalls).toEqual(["test-user"]);
  });

  test("/jx inbound triggers onInbound but NOT dropPendingFinal", async () => {
    const { inboundCalls, dropCalls } = await runOneInbound("/jx");
    expect(inboundCalls).toEqual(["test-user"]);
    expect(dropCalls).toEqual([]);
  });

  test("/JX inbound (case-insensitive) is also treated as control", async () => {
    const { inboundCalls, dropCalls } = await runOneInbound("/JX");
    expect(inboundCalls).toEqual(["test-user"]);
    expect(dropCalls).toEqual([]);
  });

  test("normal inbound fetches typing config before dispatching the turn", async () => {
    const { configCalls, typingTickets } = await runOneInbound("hello there");
    expect(configCalls).toEqual(["test-user"]);
    expect(typingTickets).toEqual(["ticket-from-config"]);
  });

  test("/clear still fetches typing config because session reset can be slow", async () => {
    const { configCalls, typingTickets } = await runOneInbound("/clear");
    expect(configCalls).toEqual(["test-user"]);
    expect(typingTickets).toEqual(["ticket-from-config"]);
  });

  test("/cancel skips typing config so control dispatch is not blocked by getConfig", async () => {
    const { configCalls, typingTickets } = await runOneInbound("/cancel");
    expect(configCalls).toEqual([]);
    expect(typingTickets).toEqual([""]);
  });

  test("fast local slash commands skip typing config", async () => {
    const echo = await runOneInbound("/echo hi");
    expect(echo.configCalls).toEqual([]);
    expect(echo.typingTickets).toEqual([""]);

    const logout = await runOneInbound("/logout");
    expect(logout.configCalls).toEqual([]);
    expect(logout.typingTickets).toEqual([""]);
  });
});

describe("credential recovery on session expiry", () => {
  test("monitor recovers when same account gets fresh token", async () => {
    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    let getUpdatesCalls = 0;
    mock.module("../../../src/weixin/api/api.ts", () => ({
      getUpdates: async (params: { token?: string; abortSignal?: AbortSignal }) => {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return { ret: 0, errcode: -14, msgs: [], get_updates_buf: "" };
        }
        if (getUpdatesCalls === 2) {
          return { ret: 0, errcode: 0, msgs: [], get_updates_buf: "buf-after-recovery", longpolling_timeout_ms: 0 };
        }
        return await new Promise((_resolve, reject) => {
          params.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      sendMessage: async () => ({}),
      sendTyping: async () => ({}),
    }));

    mock.module("../../../src/weixin/api/config-cache.ts", () => ({
      WeixinConfigManager: class {
        async getForUser() { return { typingTicket: "" }; }
      },
    }));

    mock.module("../../../src/weixin/messaging/conversation-executor.ts", () => ({
      createConversationExecutor: () => ({ run: async (_c: string, _l: string, fn: () => Promise<void>) => { await fn(); } }),
    }));

    mock.module("../../../src/weixin/messaging/handle-weixin-message-turn.ts", () => ({
      getWeixinMessageTurnLane: () => "normal",
      handleWeixinMessageTurn: async () => {},
    }));

    mock.module("../../../src/weixin/storage/sync-buf.ts", () => ({
      getSyncBufFilePath: () => "/tmp/none",
      loadGetUpdatesBuf: () => "",
      saveGetUpdatesBuf: () => {},
    }));

    mock.module("../../../src/weixin/auth/accounts.js", () => ({
      resolveWeixinAccount: (id: string) => {
        // Simulate credentials already refreshed by the time the first poll check runs.
        // The monitor's initial token is "stale-token"; returning a different token
        // triggers the "fresh token detected" path on the first poll iteration,
        // avoiding the 30-second sleep interval that would time out the test.
        return { accountId: id, baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://cdn.example.com", token: "fresh-token", enabled: true, configured: true };
      },
      listWeixinAccountIds: () => ["acct"],
    }));

    mock.module("../../../src/weixin/api/session-guard.js", () => ({
      SESSION_EXPIRED_ERRCODE: -14,
      pauseSession: () => {},
      resetSessionPause: () => {},
    }));

    mock.module("../../../src/weixin/messaging/inbound.js", () => ({
      clearContextTokensForAccount: () => {},
      restoreContextTokens: () => {},
    }));

    const { monitorWeixinProvider } = await import("../../../src/weixin/monitor/monitor");

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);

    await monitorWeixinProvider({
      baseUrl: "https://ilinkai.weixin.qq.com",
      cdnBaseUrl: "https://cdn.example.com",
      token: "stale-token",
      accountId: "acct",
      agent: { chat: async () => ({ text: "" }) },
      abortSignal: ac.signal,
      log,
    });

    expect(getUpdatesCalls).toBeGreaterThanOrEqual(2);
    expect(logMessages.some(m => m.includes("credential recovery: fresh token detected"))).toBe(true);
    expect(logMessages.some(m => m.includes("credential recovered, resuming monitor"))).toBe(true);
  });

  test("monitor switches to new account when fresh QR login registers a different accountId", async () => {
    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    let getUpdatesCalls = 0;
    mock.module("../../../src/weixin/api/api.ts", () => ({
      getUpdates: async (params: { token?: string; abortSignal?: AbortSignal }) => {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return { ret: 0, errcode: -14, msgs: [], get_updates_buf: "" };
        }
        if (getUpdatesCalls === 2) {
          return { ret: 0, errcode: 0, msgs: [], get_updates_buf: "buf-new-acct", longpolling_timeout_ms: 0 };
        }
        return await new Promise((_resolve, reject) => {
          params.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      sendMessage: async () => ({}),
      sendTyping: async () => ({}),
    }));

    mock.module("../../../src/weixin/api/config-cache.ts", () => ({
      WeixinConfigManager: class {
        async getForUser() { return { typingTicket: "" }; }
      },
    }));

    mock.module("../../../src/weixin/messaging/conversation-executor.ts", () => ({
      createConversationExecutor: () => ({ run: async (_c: string, _l: string, fn: () => Promise<void>) => { await fn(); } }),
    }));

    mock.module("../../../src/weixin/messaging/handle-weixin-message-turn.ts", () => ({
      getWeixinMessageTurnLane: () => "normal",
      handleWeixinMessageTurn: async () => {},
    }));

    mock.module("../../../src/weixin/storage/sync-buf.ts", () => ({
      getSyncBufFilePath: () => "/tmp/none",
      loadGetUpdatesBuf: () => "",
      saveGetUpdatesBuf: () => {},
    }));

    let resolveCalls = 0;
    mock.module("../../../src/weixin/auth/accounts.js", () => ({
      resolveWeixinAccount: (id: string) => {
        resolveCalls += 1;
        if (id === "stale-acct") {
          return { accountId: "stale-acct", baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://cdn.example.com", token: "stale-token", enabled: true, configured: true };
        }
        return { accountId: "new-acct", baseUrl: "https://ilinkai.weixin.qq.com", cdnBaseUrl: "https://cdn.example.com", token: "fresh-token", enabled: true, configured: true };
      },
      listWeixinAccountIds: () => ["stale-acct", "new-acct"],
    }));

    mock.module("../../../src/weixin/api/session-guard.js", () => ({
      SESSION_EXPIRED_ERRCODE: -14,
      pauseSession: () => {},
      resetSessionPause: () => {},
    }));

    mock.module("../../../src/weixin/messaging/inbound.js", () => ({
      clearContextTokensForAccount: () => {},
      restoreContextTokens: () => {},
    }));

    const { monitorWeixinProvider } = await import("../../../src/weixin/monitor/monitor");

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);

    await monitorWeixinProvider({
      baseUrl: "https://ilinkai.weixin.qq.com",
      cdnBaseUrl: "https://cdn.example.com",
      token: "stale-token",
      accountId: "stale-acct",
      agent: { chat: async () => ({ text: "" }) },
      abortSignal: ac.signal,
      log,
    });

    expect(getUpdatesCalls).toBeGreaterThanOrEqual(2);
    expect(logMessages.some(m => m.includes("new account detected, switching to account=new-acct"))).toBe(true);
    expect(logMessages.some(m => m.includes("credential recovered, resuming monitor with account=new-acct"))).toBe(true);
  });
});
