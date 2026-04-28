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
