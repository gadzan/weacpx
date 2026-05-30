import { expect, test } from "bun:test";
import { handlePrompt, handleSessionUse } from "../../../../src/commands/handlers/session-handler";

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
