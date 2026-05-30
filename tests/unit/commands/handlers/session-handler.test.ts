import { expect, test } from "bun:test";
import { handleCancel, handlePrompt, handleSessionUse, handleSessions } from "../../../../src/commands/handlers/session-handler";

/**
 * Minimal fake SessionHandlerContext.
 *
 * Uses approach (ii): both resolver methods return null so handlePrompt hits the
 * `if (!session)` guard immediately, before any transport work. This lets us
 * assert the resolver-choice behavior in isolation without stubbing the full
 * transport stack.
 */
function makeContext(calls: string[]) {
  return {
    sessions: {
      getCurrentSession: async (_chatKey: string) => {
        calls.push("getCurrent");
        return null;
      },
      getResolvedSessionByInternalAlias: (alias: string) => {
        calls.push("getByInternal:" + alias);
        return null;
      },
    },
    // All other SessionHandlerContext fields that TypeScript requires but that
    // handlePrompt never touches before the !session early-return guard.
    transport: undefined as any,
    orchestration: undefined as any,
    config: undefined as any,
    configStore: undefined as any,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    replaceConfig: () => {},
    quota: undefined as any,
    lifecycle: undefined as any,
    interaction: undefined as any,
    recovery: undefined as any,
  } as any;
}

test("handlePrompt uses boundSessionAlias resolver when metadata provides it", async () => {
  const calls: string[] = [];
  const result = await handlePrompt(
    makeContext(calls),
    "weixin:a:u",
    "hi",
    undefined, // reply
    undefined, // replyContextToken
    undefined, // accountId
    undefined, // media
    undefined, // abortSignal
    undefined, // onToolEvent
    undefined, // onThought
    undefined, // perfSpan
    { boundSessionAlias: "backend" } as any,
  );

  expect(calls).toContain("getByInternal:backend");
  expect(calls).not.toContain("getCurrent");
  // Both resolvers return null so the guard fires and returns the no-session text.
  expect(result.text).toBeDefined();
});

test("handlePrompt falls back to getCurrentSession when no boundSessionAlias", async () => {
  const calls: string[] = [];
  await handlePrompt(makeContext(calls), "weixin:a:u", "hi");

  expect(calls).toContain("getCurrent");
  expect(calls.filter((c) => c.startsWith("getByInternal:"))).toHaveLength(0);
});

test("handlePrompt falls back to getCurrentSession when metadata has no boundSessionAlias", async () => {
  const calls: string[] = [];
  await handlePrompt(
    makeContext(calls),
    "weixin:a:u",
    "hi",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { channel: "weixin" } as any,
  );

  expect(calls).toContain("getCurrent");
  expect(calls.filter((c) => c.startsWith("getByInternal:"))).toHaveLength(0);
});

test("switching to a session with a stored background result appends it", async () => {
  const context = {
    sessions: {
      resolveFuzzyAlias: () => ({ kind: "match", alias: "backend" }),
      useSession: async () => ({ alias: "backend", agent: "codex", workspace: "ws" }),
      peekCurrentSessionAlias: () => "backend",
      takeBackgroundResult: async () => ({ text: "build finished", status: "done", finished_at: "x" }),
    },
    activeTurns: { isActive: () => false },
    logger: { info: async () => {} },
  } as any;
  const res = await handleSessionUse(context, "weixin:a:u", "backend");
  expect(res.text).toContain("build finished");
});

test("switching to a still-running session appends a running hint", async () => {
  const context = {
    sessions: {
      resolveFuzzyAlias: () => ({ kind: "match", alias: "backend" }),
      useSession: async () => ({ alias: "backend", agent: "codex", workspace: "ws" }),
      peekCurrentSessionAlias: () => "backend",
      takeBackgroundResult: async () => null,
    },
    activeTurns: { isActive: () => true },
    logger: { info: async () => {} },
  } as any;
  const res = await handleSessionUse(context, "weixin:a:u", "backend");
  expect(res.text).toContain("仍在执行中");
});

test("handleCancel without an alias cancels the foreground session", async () => {
  const foreground = { alias: "frontend", transportSession: "ts-frontend" };
  const cancelled: any[] = [];
  const context = {
    sessions: {
      getCurrentSession: async (_chatKey: string) => foreground,
      // Resolver/getSession must NOT be consulted on the bare path.
      resolveFuzzyAlias: () => {
        throw new Error("should not resolve alias for bare /cancel");
      },
      getSession: async () => {
        throw new Error("should not fetch session for bare /cancel");
      },
    },
    interaction: {
      cancelTransportSession: async (session: any) => {
        cancelled.push(session);
        return { cancelled: true, message: "已取消" };
      },
    },
    recovery: {},
  } as any;

  const res = await handleCancel(context, "weixin:a:u");
  expect(cancelled).toEqual([foreground]);
  expect(res.text).toBe("已取消");
});

test("handleCancel with an alias cancels the named (background) session", async () => {
  const foreground = { alias: "frontend", transportSession: "ts-frontend" };
  const backend = { alias: "backend", transportSession: "ts-backend" };
  const cancelled: any[] = [];
  const context = {
    sessions: {
      getCurrentSession: async (_chatKey: string) => foreground,
      resolveFuzzyAlias: (_chatKey: string, fragment: string) => {
        expect(fragment).toBe("backend");
        return { kind: "match", alias: "backend" };
      },
      resolveAliasForChat: async (_chatKey: string, displayAlias: string) =>
        `weixin:${displayAlias}`,
      getSession: async (internalAlias: string) => {
        expect(internalAlias).toBe("weixin:backend");
        return backend;
      },
    },
    interaction: {
      cancelTransportSession: async (session: any) => {
        cancelled.push(session);
        return { cancelled: true, message: "已取消 backend" };
      },
    },
    recovery: {},
  } as any;

  const res = await handleCancel(context, "weixin:a:u", "backend");
  // The named (background) session was cancelled, NOT the foreground one.
  expect(cancelled).toEqual([backend]);
  expect(res.text).toBe("已取消 backend");
});

test("handleCancel with an unknown alias does not cancel anything", async () => {
  const cancelled: any[] = [];
  const context = {
    sessions: {
      getCurrentSession: async () => ({ alias: "frontend", transportSession: "ts-frontend" }),
      resolveFuzzyAlias: () => ({ kind: "none" }),
    },
    interaction: {
      cancelTransportSession: async (session: any) => {
        cancelled.push(session);
        return { cancelled: true, message: "已取消" };
      },
    },
    recovery: {},
  } as any;

  const res = await handleCancel(context, "weixin:a:u", "nope");
  expect(cancelled).toEqual([]);
  expect(res.text).toContain("nope");
});

test("handleSessions marks session with unread background result with ● prefix", async () => {
  const context = {
    sessions: {
      listSessions: async (_chatKey: string) => [
        { alias: "backend", internalAlias: "weixin:backend", agent: "codex", workspace: "proj", isCurrent: false },
        { alias: "frontend", internalAlias: "weixin:frontend", agent: "claude", workspace: "ui", isCurrent: true },
      ],
      listInternalAliases: () => ["weixin:backend", "weixin:frontend"],
      listBackgroundResultAliases: (_chatKey: string) => ["weixin:backend"],
    },
  } as any;
  const res = await handleSessions(context, "weixin:a:u");
  expect(res.text).toContain("● backend");
  expect(res.text).not.toContain("● frontend");
});
