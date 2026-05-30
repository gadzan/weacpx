# Realtime Session Switching + Background Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a WeChat user switch sessions in real time while a task is running — the switched-away session keeps executing in the background (silent), and its final result is replayed when the user switches back.

**Architecture:** Change normal-lane concurrency from per-chat to per-session so different sessions run in parallel. Bind each prompt turn to the session that was current *at dispatch time*. Gate output at send-time on whether the turn's bound session is still the chat's live `current_session`; suppress background output, store only the final result, send a short completion notice, and replay the stored result on switch-back.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Bun build, custom test runner (`node ./scripts/run-tests.mjs`), tests under `tests/unit/` mirroring `src/`.

**Spec:** `docs/superpowers/specs/2026-05-30-realtime-session-switching-background-execution-design.md`

---

## Background facts (verified seams)

- `ChatContextState` is `{ current_session, previous_session? }` at `src/state/types.ts:39-42`.
- `createConversationExecutor()` (`src/weixin/messaging/conversation-executor.ts`, 58 lines) serializes the **normal** lane per `conversationId` via a single `normalTail`; **control** lane runs immediately. Monitor passes `conversationId = from_user_id` (the chatKey) at `src/weixin/monitor/monitor.ts:259-260`.
- Lane classification: `getWeixinMessageTurnLane()` at `src/weixin/messaging/handle-weixin-message-turn.ts:215-224` puts only `/cancel`, `/stop`, `/jx` on control.
- The turn builds a `ChatRequest` with `metadata` at `handle-weixin-message-turn.ts:411-428`, calls `executeChatTurn(...)` at `:431`, sends mid segments via `sendReplySegment` (`:388-409`), and sends the final answer at `:443-535` (error notice at `:591-614`).
- `handlePrompt` (`src/commands/handlers/session-handler.ts:~648`) resolves the session via `context.sessions.getCurrentSession(chatKey)` at `:662` — a **live read** at execution time. `handlePromptWithSession` then runs the transport prompt.
- Router `case "prompt"` is at `src/commands/command-router.ts:317`; it already branches on `metadata.scheduledSessionAlias` / `scheduledSessionDescriptor` before falling through to `handlePrompt`. `case "session.use"` / `"session.use.previous"` at `:221-224`.
- `getCurrentSession` (`src/sessions/session-service.ts:353-367`) mutates `last_used_at` and persists. `useSession` at `:191`, `usePreviousSession` at `:221`, `resolveFuzzyAlias` at `:255`.
- `ConsoleAgent` (`src/console-agent.ts`) wraps `CommandRouter` and forwards `ChatRequest` → `router.handle(...)`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/sessions/active-turn-registry.ts` | In-memory per-(chat,session) "is a turn running" set | **Create** |
| `src/state/types.ts` | State model | Add `background_results` to `ChatContextState` |
| `src/sessions/session-service.ts` | Session state + background-result store + peek helpers | Add methods |
| `src/weixin/messaging/conversation-executor.ts` | Concurrency lanes | Per-session normal tails |
| `src/weixin/agent/interface.ts` (ChatRequestMetadata) | Request metadata | Add `boundSessionAlias` |
| `src/console-agent.ts` + `src/commands/command-router.ts` | Peek passthrough | Add `peekCurrentSessionAlias` |
| `src/commands/handlers/session-handler.ts` | Bound-session prompt + switch-back replay | Honor `boundSessionAlias`; replay on `/use` |
| `src/weixin/messaging/handle-weixin-message-turn.ts` | Foreground gate + completion notice | Gate output, store bg result |
| `src/weixin/monitor/monitor.ts` | Dispatch-time binding + lane key wiring | Compute boundAlias, thread deps |

Each phase below produces working, tested software on its own.

---

## Phase 1 — Background-result store (state + service)

### Task 1: Extend `ChatContextState` with `background_results`

**Files:**
- Modify: `src/state/types.ts:39-42`
- Test: `tests/unit/state/types.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/state/types.test.ts`:

```typescript
import { test, expect } from "../../helpers/test-harness.js";
import { createEmptyState } from "../../../src/state/types.js";

test("createEmptyState starts with empty chat_contexts", () => {
  const state = createEmptyState();
  expect(state.chat_contexts).toEqual({});
});

test("ChatContextState accepts a background_results map", () => {
  const state = createEmptyState();
  state.chat_contexts["weixin:a:u"] = {
    current_session: "s1",
    background_results: {
      s2: { text: "done", status: "done", finished_at: "2026-05-30T00:00:00.000Z" },
    },
  };
  expect(state.chat_contexts["weixin:a:u"]!.background_results!.s2!.status).toBe("done");
});
```

> Check `tests/helpers/` for the actual harness export. If the project uses `bun:test` or a custom `test/expect`, match the import style already used in `tests/unit/sessions/session-service.test.ts` instead of the line above.

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/state/types.test.ts`
Expected: FAIL — typecheck error, `background_results` not assignable to `ChatContextState`.

- [ ] **Step 3: Add the type**

In `src/state/types.ts`, replace the `ChatContextState` interface (lines 39-42):

```typescript
export interface BackgroundResult {
  text: string;
  status: "done" | "error";
  finished_at: string;
}

export interface ChatContextState {
  current_session: string;
  previous_session?: string;
  background_results?: Record<string, BackgroundResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/state/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/types.ts tests/unit/state/types.test.ts
git commit -m "feat(state): add background_results to ChatContextState"
```

### Task 2: Background-result store methods on `SessionService`

**Files:**
- Modify: `src/sessions/session-service.ts` (add methods near `useSession`, ~line 219)
- Test: `tests/unit/sessions/session-service.test.ts` (existing, 23KB)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/sessions/session-service.test.ts` (reuse the file's existing `buildService()`/setup helper — match how other tests in this file construct a `SessionService` with a temp `StateStore`):

```typescript
test("setBackgroundResult then takeBackgroundResult returns and clears it", async () => {
  const { service } = await buildService(); // use this file's existing factory
  const chatKey = "weixin:acc:user";
  await service.setBackgroundResult(chatKey, "backend", {
    text: "build finished",
    status: "done",
    finished_at: "2026-05-30T01:00:00.000Z",
  });
  expect(service.listBackgroundResultAliases(chatKey)).toEqual(["backend"]);

  const taken = await service.takeBackgroundResult(chatKey, "backend");
  expect(taken?.text).toBe("build finished");
  expect(service.listBackgroundResultAliases(chatKey)).toEqual([]);

  const again = await service.takeBackgroundResult(chatKey, "backend");
  expect(again).toBeNull();
});

test("setBackgroundResult overwrites a prior unread result for the same alias", async () => {
  const { service } = await buildService();
  const chatKey = "weixin:acc:user";
  await service.setBackgroundResult(chatKey, "backend", { text: "first", status: "done", finished_at: "2026-05-30T01:00:00.000Z" });
  await service.setBackgroundResult(chatKey, "backend", { text: "second", status: "error", finished_at: "2026-05-30T02:00:00.000Z" });
  const taken = await service.takeBackgroundResult(chatKey, "backend");
  expect(taken?.text).toBe("second");
  expect(taken?.status).toBe("error");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/session-service.test.ts`
Expected: FAIL — `setBackgroundResult`/`takeBackgroundResult`/`listBackgroundResultAliases` are not functions.

- [ ] **Step 3: Implement the methods**

In `src/sessions/session-service.ts`, import the type at the top alongside the existing state-type imports:

```typescript
import type { BackgroundResult } from "../state/types.js";
```

Add these methods inside the `SessionService` class (after `usePreviousSession`, ~line 253). They use the existing `this.mutate(...)` / `this.persist()` pattern seen in `useSession`:

```typescript
async setBackgroundResult(chatKey: string, alias: string, result: BackgroundResult): Promise<void> {
  await this.mutate(async () => {
    const ctx = this.state.chat_contexts[chatKey] ?? { current_session: "" };
    const results = { ...(ctx.background_results ?? {}), [alias]: result };
    this.state.chat_contexts[chatKey] = { ...ctx, background_results: results };
    await this.persist();
  });
}

async takeBackgroundResult(chatKey: string, alias: string): Promise<BackgroundResult | null> {
  return await this.mutate(async () => {
    const ctx = this.state.chat_contexts[chatKey];
    const found = ctx?.background_results?.[alias];
    if (!ctx || !found) return null;
    const remaining = { ...ctx.background_results };
    delete remaining[alias];
    this.state.chat_contexts[chatKey] = {
      ...ctx,
      ...(Object.keys(remaining).length > 0 ? { background_results: remaining } : { background_results: undefined }),
    };
    await this.persist();
    return found;
  });
}

// Read-only; no persistence.
listBackgroundResultAliases(chatKey: string): string[] {
  const results = this.state.chat_contexts[chatKey]?.background_results;
  return results ? Object.keys(results) : [];
}
```

> If `this.state.chat_contexts[chatKey]` does not exist when `setBackgroundResult` is called, we create a stub with `current_session: ""`. This is safe because background results are only ever set for a chat that already has an active session, but the guard avoids a crash in tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/session-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sessions/session-service.ts tests/unit/sessions/session-service.test.ts
git commit -m "feat(sessions): background-result store (set/take/list)"
```

---

## Phase 2 — Active-turn registry + dispatch-time session binding

### Task 3: Active-turn registry (in-memory)

**Files:**
- Create: `src/sessions/active-turn-registry.ts`
- Test: `tests/unit/sessions/active-turn-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sessions/active-turn-registry.test.ts`:

```typescript
import { test, expect } from "../../helpers/test-harness.js"; // match repo style
import { createActiveTurnRegistry } from "../../../src/sessions/active-turn-registry.js";

test("marks a session active then inactive", () => {
  const reg = createActiveTurnRegistry();
  const chatKey = "weixin:a:u";
  expect(reg.isActive(chatKey, "backend")).toBe(false);
  reg.markActive(chatKey, "backend");
  expect(reg.isActive(chatKey, "backend")).toBe(true);
  reg.markInactive(chatKey, "backend");
  expect(reg.isActive(chatKey, "backend")).toBe(false);
});

test("tracks two sessions in the same chat independently", () => {
  const reg = createActiveTurnRegistry();
  const chatKey = "weixin:a:u";
  reg.markActive(chatKey, "a");
  reg.markActive(chatKey, "b");
  reg.markInactive(chatKey, "a");
  expect(reg.isActive(chatKey, "a")).toBe(false);
  expect(reg.isActive(chatKey, "b")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/active-turn-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `src/sessions/active-turn-registry.ts`:

```typescript
// Non-persisted, in-memory record of which (chatKey, sessionAlias) pairs have a
// turn currently executing. Used to tell the user "session X is still running"
// when they switch back before it finishes. Cleared naturally on process exit;
// it never needs to survive a restart.
export interface ActiveTurnRegistry {
  markActive(chatKey: string, alias: string): void;
  markInactive(chatKey: string, alias: string): void;
  isActive(chatKey: string, alias: string): boolean;
}

export function createActiveTurnRegistry(): ActiveTurnRegistry {
  const byChat = new Map<string, Set<string>>();
  return {
    markActive(chatKey, alias) {
      const set = byChat.get(chatKey) ?? new Set<string>();
      set.add(alias);
      byChat.set(chatKey, set);
    },
    markInactive(chatKey, alias) {
      const set = byChat.get(chatKey);
      if (!set) return;
      set.delete(alias);
      if (set.size === 0) byChat.delete(chatKey);
    },
    isActive(chatKey, alias) {
      return byChat.get(chatKey)?.has(alias) ?? false;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/active-turn-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sessions/active-turn-registry.ts tests/unit/sessions/active-turn-registry.test.ts
git commit -m "feat(sessions): in-memory active-turn registry"
```

### Task 4: Read-only `peekCurrentSessionAlias` + bound-alias resolve on SessionService

**Files:**
- Modify: `src/sessions/session-service.ts`
- Test: `tests/unit/sessions/session-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
test("peekCurrentSessionAlias returns current without mutating", async () => {
  const { service } = await buildService();
  const chatKey = "weixin:acc:user";
  // create + select a session via the file's existing helpers, e.g. createSession/useSession
  await createSessionFixture(service, "backend"); // adapt to this file's helper name
  await service.useSession(chatKey, "backend");
  expect(service.peekCurrentSessionAlias(chatKey)).toBe("backend");
  // peeking twice does not throw and stays stable
  expect(service.peekCurrentSessionAlias(chatKey)).toBe("backend");
});

test("peekCurrentSessionAlias returns undefined for unknown chat", async () => {
  const { service } = await buildService();
  expect(service.peekCurrentSessionAlias("weixin:nope:nope")).toBeUndefined();
});
```

> `peekCurrentSessionAlias` returns the **internal** alias stored in `current_session` (the same value `getCurrentSession` reads). Bound-alias resolution (next method) must accept that internal alias.

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/session-service.test.ts`
Expected: FAIL — `peekCurrentSessionAlias` is not a function.

- [ ] **Step 3: Implement**

In `src/sessions/session-service.ts`, add (read-only, no `mutate`):

```typescript
// Read-only peek at the chat's current internal session alias. Unlike
// getCurrentSession it does NOT touch last_used_at or persist, so it is safe to
// call on the hot dispatch path for every inbound message.
peekCurrentSessionAlias(chatKey: string): string | undefined {
  return this.state.chat_contexts[chatKey]?.current_session;
}

// Resolve a session by its INTERNAL alias (as returned by
// peekCurrentSessionAlias) to a ResolvedSession, without changing current_session.
// Returns null if the alias no longer exists.
getResolvedSessionByInternalAlias(internalAlias: string): ResolvedSession | null {
  const session = this.state.sessions[internalAlias];
  return session ? this.toResolvedSession(session) : null;
}
```

> `toResolvedSession` and `ResolvedSession` already exist in this file (used by `getCurrentSession` at line 365). Reuse them; do not redefine.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/sessions/session-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sessions/session-service.ts tests/unit/sessions/session-service.test.ts
git commit -m "feat(sessions): read-only peek + resolve-by-internal-alias"
```

### Task 5: Thread `boundSessionAlias` through metadata → `handlePrompt`

**Files:**
- Modify: `src/weixin/agent/interface.ts` (`ChatRequestMetadata`)
- Modify: `src/commands/handlers/session-handler.ts` (`handlePrompt`, ~line 648-668)
- Test: `tests/unit/commands/handlers/session-handler.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

In a session-handler test (match the existing test file for this handler if present; otherwise create `tests/unit/commands/handlers/session-handler.test.ts`). Use a fake `SessionHandlerContext` whose `sessions` records which lookup was called:

```typescript
test("handlePrompt binds to metadata.boundSessionAlias instead of current", async () => {
  let getCurrentCalled = false;
  let resolvedAlias: string | undefined;
  const context = makeFakeContext({
    sessions: {
      getCurrentSession: async () => { getCurrentCalled = true; return makeResolved("live"); },
      getResolvedSessionByInternalAlias: (alias: string) => { resolvedAlias = alias; return makeResolved(alias); },
    },
    // promptWithSession stub returns a no-op RouterResponse
  });

  await handlePrompt(context, "weixin:a:u", "hello", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { boundSessionAlias: "backend" });

  expect(resolvedAlias).toBe("backend");
  expect(getCurrentCalled).toBe(false);
});

test("handlePrompt falls back to getCurrentSession without boundSessionAlias", async () => {
  let getCurrentCalled = false;
  const context = makeFakeContext({
    sessions: { getCurrentSession: async () => { getCurrentCalled = true; return makeResolved("live"); } },
  });
  await handlePrompt(context, "weixin:a:u", "hello");
  expect(getCurrentCalled).toBe(true);
});
```

> `makeFakeContext`, `makeResolved` are local helpers — build minimal stubs satisfying the `SessionHandlerContext` / `ResolvedSession` shapes the function actually touches. Keep them in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts`
Expected: FAIL — `boundSessionAlias` not on metadata type and not honored.

- [ ] **Step 3: Implement**

In `src/weixin/agent/interface.ts`, add to `ChatRequestMetadata` (next to `scheduledSessionAlias`):

```typescript
  // When set, the prompt is bound to this INTERNAL session alias, captured at
  // dispatch time. Used so a queued prompt runs against the session that was
  // current when the user sent it — not whatever current_session is now (the
  // user may have switched sessions while it waited on the per-session lane).
  boundSessionAlias?: string;
```

In `src/commands/handlers/session-handler.ts`, change the session resolution in `handlePrompt` (line 662) from:

```typescript
  const session = await context.sessions.getCurrentSession(chatKey);
```

to:

```typescript
  const session = metadata?.boundSessionAlias
    ? context.sessions.getResolvedSessionByInternalAlias(metadata.boundSessionAlias)
    : await context.sessions.getCurrentSession(chatKey);
```

> `metadata` is already a parameter of `handlePrompt` (last arg). Leave the `if (!session) return { text: NO_CURRENT_SESSION_TEXT }` guard immediately below unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/weixin/agent/interface.ts src/commands/handlers/session-handler.ts tests/unit/commands/handlers/session-handler.test.ts
git commit -m "feat(commands): bind prompt to dispatch-time session alias"
```

---

## Phase 3 — Per-session concurrency lanes

### Task 6: Per-session normal tails in the conversation executor

**Files:**
- Modify: `src/weixin/messaging/conversation-executor.ts` (whole file, 58 lines)
- Test: `tests/unit/weixin/messaging/conversation-executor.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/weixin/messaging/conversation-executor.test.ts`:

```typescript
import { test, expect } from "../../../helpers/test-harness.js"; // match repo style
import { createConversationExecutor } from "../../../../src/weixin/messaging/conversation-executor.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

test("same chat + same sessionKey serializes (second waits for first)", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { order.push("start1"); await g1.promise; order.push("end1"); }, "s1");
  const p2 = exec.run("chat", "normal", async () => { order.push("start2"); }, "s1");
  await Promise.resolve();
  expect(order).toEqual(["start1"]); // p2 has not started
  g1.resolve();
  await Promise.all([p1, p2]);
  expect(order).toEqual(["start1", "end1", "start2"]);
});

test("same chat + different sessionKey runs in parallel", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { order.push("start1"); await g1.promise; order.push("end1"); }, "s1");
  const p2 = exec.run("chat", "normal", async () => { order.push("start2"); }, "s2");
  await Promise.resolve();
  expect(order).toContain("start2"); // s2 started despite s1 still blocked
  g1.resolve();
  await Promise.all([p1, p2]);
});

test("control lane runs immediately regardless of a blocked normal lane", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { await g1.promise; }, "s1");
  const pc = exec.run("chat", "control", async () => { order.push("control"); });
  await pc;
  expect(order).toEqual(["control"]);
  g1.resolve();
  await p1;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/conversation-executor.test.ts`
Expected: FAIL — `run` ignores the 4th `sessionKey` arg; the parallel test fails (s2 blocked behind s1).

- [ ] **Step 3: Implement per-session tails**

Replace the entire contents of `src/weixin/messaging/conversation-executor.ts`:

```typescript
export type ConversationExecutorLane = "normal" | "control";

type ConversationTask<T> = () => Promise<T>;

type ConversationState = {
  normalTails: Map<string, Promise<unknown>>;
  activeControls: number;
};

const DEFAULT_SESSION_KEY = "__chat__";

export type ConversationExecutor = {
  run<T>(
    conversationId: string,
    lane: ConversationExecutorLane,
    task: ConversationTask<T>,
    sessionKey?: string,
  ): Promise<T>;
};

export function createConversationExecutor(): ConversationExecutor {
  const states = new Map<string, ConversationState>();

  const getState = (conversationId: string): ConversationState => {
    const existing = states.get(conversationId);
    if (existing) return existing;
    const created: ConversationState = { normalTails: new Map(), activeControls: 0 };
    states.set(conversationId, created);
    return created;
  };

  const cleanupState = (conversationId: string, state: ConversationState) => {
    if (state.normalTails.size === 0 && state.activeControls === 0) {
      states.delete(conversationId);
    }
  };

  return {
    run<T>(
      conversationId: string,
      lane: ConversationExecutorLane,
      task: ConversationTask<T>,
      sessionKey?: string,
    ): Promise<T> {
      const state = getState(conversationId);

      if (lane === "control") {
        state.activeControls += 1;
        return Promise.resolve()
          .then(task)
          .finally(() => {
            state.activeControls -= 1;
            cleanupState(conversationId, state);
          });
      }

      const key = sessionKey ?? DEFAULT_SESSION_KEY;
      const previous = state.normalTails.get(key) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(task);
      state.normalTails.set(key, next);

      return next.finally(() => {
        if (state.normalTails.get(key) === next) {
          state.normalTails.delete(key);
        }
        cleanupState(conversationId, state);
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/conversation-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/weixin/messaging/conversation-executor.ts tests/unit/weixin/messaging/conversation-executor.test.ts
git commit -m "feat(executor): per-session normal lanes for parallel sessions"
```

### Task 7: Move `/use` family to the control lane

**Files:**
- Modify: `src/weixin/messaging/handle-weixin-message-turn.ts:215-224` (`getWeixinMessageTurnLane`)
- Test: `tests/unit/weixin/messaging/lane-classification.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/weixin/messaging/lane-classification.test.ts`:

```typescript
import { test, expect } from "../../../helpers/test-harness.js"; // match repo style
import { getWeixinMessageTurnLane } from "../../../../src/weixin/messaging/handle-weixin-message-turn.js";

const msg = (text: string) => ({ item_list: [{ text }] } as any); // shape matches extractTextBody

test("/use, /ss, /use - are on the control lane", () => {
  expect(getWeixinMessageTurnLane(msg("/use backend"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/ss backend"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/use -"))).toBe("control");
});

test("existing control commands still control; prompts stay normal", () => {
  expect(getWeixinMessageTurnLane(msg("/cancel"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/jx"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("hello world"))).toBe("normal");
  expect(getWeixinMessageTurnLane(msg("/status"))).toBe("normal");
});
```

> Verify the message shape `extractTextBody` expects (look at its implementation near the top of `handle-weixin-message-turn.ts`) and adjust `msg()` to match. The point of the test is the command→lane mapping.

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/lane-classification.test.ts`
Expected: FAIL — `/use` etc. classify as `normal`.

- [ ] **Step 3: Implement**

In `src/weixin/messaging/handle-weixin-message-turn.ts`, replace the body of `getWeixinMessageTurnLane` (lines 215-224):

```typescript
export function getWeixinMessageTurnLane(full: WeixinMessage): "normal" | "control" {
  const textBody = extractTextBody(full.item_list).trim().toLowerCase();
  const command = textBody.split(/\s+/)[0] ?? "";
  // Switch commands must preempt an in-flight prompt so the user can change the
  // foreground session in real time; they only touch chat-context state and
  // never run a long task, so the control lane is safe.
  const isSwitch = command === "/use" || command === "/ss";
  return command === "/cancel" || command === "/stop" || command === "/jx" || isSwitch
    ? "control"
    : "normal";
}
```

> `/use -` matches because `command` is the first token `/use`. `/ssn` (native list) must NOT match `/ss` — using the first whitespace-delimited token, `/ssn` is its own token and does not equal `/ss`, so it stays normal. Confirm there is no `/use`-prefixed long-running command; `/use`/`/ss` are pure switches.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/lane-classification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/weixin/messaging/handle-weixin-message-turn.ts tests/unit/weixin/messaging/lane-classification.test.ts
git commit -m "feat(lane): route /use and /ss to the control lane"
```

---

## Phase 4 — Foreground output gate + completion handling

### Task 8: Add foreground/bg deps to the turn and gate mid segments

**Files:**
- Modify: `src/weixin/messaging/handle-weixin-message-turn.ts` (deps type; `sendReplySegment` at :388; final/error paths)
- Test: `tests/unit/weixin/messaging/handle-weixin-message-turn.test.ts` (create or extend)

This task adds the gate but keeps behavior identical when the new deps are absent (backward compatible — all current call sites omit them until Task 10 wires them).

- [ ] **Step 1: Write the failing test**

Create/extend `tests/unit/weixin/messaging/handle-weixin-message-turn.test.ts`. Because the full turn has heavy deps, test the **gate decision helper** in isolation. First we extract it; the test targets the extracted helper:

```typescript
import { test, expect } from "../../../helpers/test-harness.js"; // match repo style
import { shouldDeliverSegment } from "../../../../src/weixin/messaging/foreground-gate.js";

test("delivers when no gate is configured (legacy)", () => {
  expect(shouldDeliverSegment(undefined)).toBe(true);
});

test("delivers when the turn's session is the live foreground", () => {
  expect(shouldDeliverSegment(() => true)).toBe(true);
});

test("suppresses when the turn's session has been backgrounded", () => {
  expect(shouldDeliverSegment(() => false)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/handle-weixin-message-turn.test.ts`
Expected: FAIL — `foreground-gate.js` does not exist.

- [ ] **Step 3: Implement the gate helper + wire into the turn**

Create `src/weixin/messaging/foreground-gate.ts`:

```typescript
// A turn is "foreground" when the session it is bound to is still the chat's
// live current_session. The predicate is evaluated at SEND time (not turn start)
// so a turn that gets backgrounded mid-flight stops delivering, and one switched
// back to resumes delivering.
export function shouldDeliverSegment(isForeground: (() => boolean) | undefined): boolean {
  return isForeground ? isForeground() : true;
}
```

In `src/weixin/messaging/handle-weixin-message-turn.ts`:

1. Import it:
```typescript
import { shouldDeliverSegment } from "./foreground-gate.js";
```

2. Add to `HandleWeixinMessageTurnDeps` (the deps interface near the top of the file):
```typescript
  // When provided, returns true iff this turn's bound session is still the
  // chat's live foreground session. Omitted = always foreground (legacy).
  isForeground?: () => boolean;
  // Internal alias of the session this turn is bound to (for bg-result keying).
  boundSessionAlias?: string;
  // Called when this turn finishes while BACKGROUND, to store the final result
  // for later replay. text is the final answer (or error message).
  onBackgroundFinal?: (alias: string, text: string, status: "done" | "error") => Promise<void>;
```

3. In `sendReplySegment` (line 388), add the gate as the first check:
```typescript
  const sendReplySegment = async (text: string): Promise<boolean> => {
    if (!shouldDeliverSegment(deps.isForeground)) {
      return false; // backgrounded: suppress mid output, count as "not delivered"
    }
    const plainText = markdownToPlainText(text).trim();
    // ...unchanged below...
```

4. At the final-send block (the `if (turn.text)` at line 443), branch on the gate. Wrap the existing final-send logic so it only runs when foreground; otherwise store the result:
```typescript
    if (turn.text) {
      const finalText = markdownToPlainText(turn.text).trim();
      if (finalText.length > 0) {
        if (!shouldDeliverSegment(deps.isForeground) && deps.boundSessionAlias && deps.onBackgroundFinal) {
          await deps.onBackgroundFinal(deps.boundSessionAlias, finalText, "done");
        } else {
          // ...existing chunk/reserveFinal/sendMessageWeixin logic, unchanged...
        }
      }
      perfSpan.mark("reply.final_done", { /* unchanged */ });
    }
```

5. In the `catch (err)` error path (line 591), after the `isAbortError` early return, branch similarly so a backgrounded error is stored instead of sent:
```typescript
    const errMessage = `⚠️ 执行出错：${err instanceof Error ? err.message : JSON.stringify(err)}`;
    if (!shouldDeliverSegment(deps.isForeground) && deps.boundSessionAlias && deps.onBackgroundFinal) {
      await deps.onBackgroundFinal(deps.boundSessionAlias, errMessage, "error");
    } else {
      // ...existing reserveFinal + sendWeixinErrorNotice logic, unchanged...
    }
```

> Keep all existing logic intact in the `else` branches — only add the new background branches. The default (no `isForeground` dep) keeps every current call site behaving exactly as before.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/handle-weixin-message-turn.test.ts`
Expected: PASS. Then run the full suite to confirm no regression in the turn:
Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/weixin/messaging/foreground-gate.ts src/weixin/messaging/handle-weixin-message-turn.ts tests/unit/weixin/messaging/handle-weixin-message-turn.test.ts
git commit -m "feat(turn): foreground gate suppresses background output, stores final"
```

### Task 9: Completion notice on background finish

**Files:**
- Modify: `src/weixin/messaging/handle-weixin-message-turn.ts` (background-final branches)
- Test: `tests/unit/weixin/messaging/completion-notice.test.ts` (create)

The completion notice is a short line sent to the same `to`. Build it as a pure function and send it from the background-final branch.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/weixin/messaging/completion-notice.test.ts`:

```typescript
import { test, expect } from "../../../helpers/test-harness.js"; // match repo style
import { buildBackgroundCompletionNotice } from "../../../../src/weixin/messaging/completion-notice.js";

test("done notice names the session", () => {
  expect(buildBackgroundCompletionNotice("backend", "done")).toBe("✅ backend 已完成，/use backend 查看结果");
});

test("error notice names the session", () => {
  expect(buildBackgroundCompletionNotice("backend", "error")).toBe("⚠️ backend 失败，/use backend 查看详情");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/completion-notice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement + wire**

Create `src/weixin/messaging/completion-notice.ts`:

```typescript
import { toDisplaySessionAlias } from "../../sessions/session-service.js";

// Short line sent to the foreground chat when a backgrounded session finishes,
// so the user knows it is ready without dumping the full result. The result
// itself is replayed only on /use switch-back.
export function buildBackgroundCompletionNotice(internalAlias: string, status: "done" | "error"): string {
  const display = toDisplaySessionAlias(internalAlias);
  return status === "done"
    ? `✅ ${display} 已完成，/use ${display} 查看结果`
    : `⚠️ ${display} 失败，/use ${display} 查看详情`;
}
```

> Confirm `toDisplaySessionAlias` is exported from `session-service.ts` (it is used in `session-handler.ts`). If it lives elsewhere, import from the correct module.

In `handle-weixin-message-turn.ts`, inside BOTH background-final branches added in Task 8 (the `onBackgroundFinal` calls), send the notice to `to` right after storing — reuse the existing `sendMessageWeixin` import already used by `sendReplySegment`:

```typescript
import { buildBackgroundCompletionNotice } from "./completion-notice.js";
// ...
if (!shouldDeliverSegment(deps.isForeground) && deps.boundSessionAlias && deps.onBackgroundFinal) {
  await deps.onBackgroundFinal(deps.boundSessionAlias, finalText, "done");
  await sendMessageWeixin({
    to,
    text: buildBackgroundCompletionNotice(deps.boundSessionAlias, "done"),
    opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
  }).catch((e) => deps.errLog(`bg completion notice failed: ${String(e)}`));
}
```

Do the same in the error branch with `"error"`.

> Notice sends bypass the mid-quota gate intentionally — they are short and rare (one per backgrounded completion). They DO share the `to`'s outbound budget only if you route them through `reserveFinal`; for simplicity and reliability we send directly. If quota pressure becomes an issue, gate later.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/completion-notice.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/weixin/messaging/completion-notice.ts src/weixin/messaging/handle-weixin-message-turn.ts tests/unit/weixin/messaging/completion-notice.test.ts
git commit -m "feat(turn): send short completion notice when a bg session finishes"
```

---

## Phase 5 — Wiring + switch-back replay + list markers

### Task 10: Wire dispatch-time binding, lane key, and gate in the monitor

**Files:**
- Modify: `src/weixin/monitor/monitor.ts:259-288` (dispatch site) and the monitor options type
- Modify: `src/main.ts` (or wherever the monitor + agent + session service are wired — `buildApp`) to inject `sessions`/`activeTurns` access into the monitor
- Test: covered by integration smoke (Task 13) + the unit tests already written; add a focused dispatch test if the monitor exposes a testable dispatch function

This is the integration task. The monitor must, per inbound message:
1. Compute `boundAlias = sessions.peekCurrentSessionAlias(chatKey)` for non-slash (prompt) messages.
2. Pass `sessionKey` to `conversationExecutor.run(...)`: `boundAlias` for prompts, `"__chat__"` for slash commands.
3. Pass `boundSessionAlias`, `isForeground`, `onBackgroundFinal` into `handleWeixinMessageTurn` deps.
4. Mark the active-turn registry around the run for prompt turns.

- [ ] **Step 1: Identify wiring inputs**

Read `src/main.ts` `buildApp()` and `src/run-console.ts` to find where the monitor is started and where `SessionService` + `ConsoleAgent` are available. The monitor needs:
- `peekCurrentSessionAlias(chatKey)` — from `SessionService`.
- `setBackgroundResult(...)` — from `SessionService`.
- an `ActiveTurnRegistry` instance (create one in `buildApp` and share it with the session handlers' context — see Task 11).

Add these to the monitor's options/deps object. Run: `node ./scripts/run-tests.mjs tests/unit` to capture the current green baseline before editing.

- [ ] **Step 2: Implement the dispatch wiring**

In `src/weixin/monitor/monitor.ts`, replace the dispatch block (lines 259-288). Compute the bound alias and thread deps:

```typescript
const chatKey = `weixin:${accountId}:${full.from_user_id ?? ""}`;
const inboundLower = inboundText.trim().toLowerCase();
const isSlash = inboundLower.startsWith("/");
// Prompts bind to the session current AT DISPATCH; slash commands use the chat lane.
const boundAlias = isSlash ? undefined : opts.peekCurrentSessionAlias?.(chatKey);
const sessionKey = boundAlias ?? "__chat__";

const isForeground = boundAlias
  ? () => opts.peekCurrentSessionAlias?.(chatKey) === boundAlias
  : undefined;

if (boundAlias) opts.activeTurns?.markActive(chatKey, boundAlias);

void conversationExecutor
  .run(
    full.from_user_id ?? "",
    getWeixinMessageTurnLane(full),
    () =>
      handleWeixinMessageTurn(full, {
        accountId,
        agent,
        baseUrl,
        cdnBaseUrl,
        token,
        typingTicket: cachedConfig.typingTicket,
        log,
        errLog,
        ...(boundAlias ? { boundSessionAlias: boundAlias } : {}),
        ...(isForeground ? { isForeground } : {}),
        ...(opts.setBackgroundResult
          ? {
              onBackgroundFinal: async (alias: string, text: string, status: "done" | "error") => {
                await opts.setBackgroundResult!(chatKey, alias, {
                  text,
                  status,
                  finished_at: new Date().toISOString(),
                });
              },
            }
          : {}),
        // ...existing optional deps (onInbound, reserveFinal, ... ) unchanged...
      }),
    sessionKey,
  )
  .catch((err) => {
    errLog(`[weixin] message turn failed: ${String(err)}`);
  })
  .finally(() => {
    if (boundAlias) opts.activeTurns?.markInactive(chatKey, boundAlias);
  });
```

Add to the monitor options type (the `opts` interface in this file or its imported type):

```typescript
  peekCurrentSessionAlias?: (chatKey: string) => string | undefined;
  setBackgroundResult?: (chatKey: string, alias: string, result: { text: string; status: "done" | "error"; finished_at: string }) => Promise<void>;
  activeTurns?: import("../../sessions/active-turn-registry.js").ActiveTurnRegistry;
```

In `buildApp()` (`src/main.ts`), create one shared registry and pass the three new options when starting the monitor:

```typescript
import { createActiveTurnRegistry } from "./sessions/active-turn-registry.js";
// ...
const activeTurns = createActiveTurnRegistry();
// when wiring the monitor opts:
peekCurrentSessionAlias: (chatKey) => sessions.peekCurrentSessionAlias(chatKey),
setBackgroundResult: (chatKey, alias, result) => sessions.setBackgroundResult(chatKey, alias, result),
activeTurns,
```

> `sessions` is the `SessionService` instance already constructed in `buildApp`. Keep `activeTurns` in scope so Task 11 can also pass it into the command router / session-handler context.

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: PASS (existing tests still green; new units green).

- [ ] **Step 4: Manual dry-run sanity (no WeChat needed)**

Run:
```bash
bun run dry-run --chat-key wx:test -- "/session new a --agent codex" "/session new b --agent codex" "/use a" "/status"
```
Expected: commands execute without crashing; `/use` switches are accepted immediately.

- [ ] **Step 5: Commit**

```bash
git add src/weixin/monitor/monitor.ts src/main.ts
git commit -m "feat(monitor): dispatch-time session binding, per-session lane, fg gate wiring"
```

### Task 11: Switch-back replay + "still running" hint

**Files:**
- Modify: `src/commands/handlers/session-handler.ts` (`handleSessionUse` :270, `handleSessionUsePrevious` :294, and `SessionHandlerContext`)
- Modify: wherever `SessionHandlerContext` is constructed (`createSessionHandlerContext` in `src/commands/command-router.ts`) to supply `activeTurns`
- Test: `tests/unit/commands/handlers/session-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the session-handler test:

```typescript
test("switching to a session with a stored bg result appends the result", async () => {
  const taken = { text: "build finished", status: "done" as const, finished_at: "x" };
  const context = makeFakeContext({
    sessions: {
      resolveFuzzyAlias: () => ({ kind: "match", alias: "backend" }),
      useSession: async () => ({ alias: "backend", agent: "codex", workspace: "ws" }),
      takeBackgroundResult: async () => taken,
    },
    activeTurns: { isActive: () => false },
  });
  const res = await handleSessionUse(context, "weixin:a:u", "backend");
  expect(res.text).toContain("已切到 backend");
  expect(res.text).toContain("build finished");
});

test("switching to a still-running session appends a running hint", async () => {
  const context = makeFakeContext({
    sessions: {
      resolveFuzzyAlias: () => ({ kind: "match", alias: "backend" }),
      useSession: async () => ({ alias: "backend", agent: "codex", workspace: "ws" }),
      takeBackgroundResult: async () => null,
    },
    activeTurns: { isActive: () => true },
  });
  const res = await handleSessionUse(context, "weixin:a:u", "backend");
  expect(res.text).toContain("仍在执行中");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts`
Expected: FAIL — context has no `activeTurns`/`takeBackgroundResult` usage; replay not implemented.

- [ ] **Step 3: Implement**

Add `activeTurns` to `SessionHandlerContext` (its interface in `session-handler.ts`):

```typescript
  activeTurns?: import("../../sessions/active-turn-registry.js").ActiveTurnRegistry;
```

Add a shared helper in `session-handler.ts` and call it from both switch handlers. The handlers currently `return { text: renderSwitched(switched) }`; wrap that:

```typescript
async function appendSwitchBackContext(
  context: SessionHandlerContext,
  chatKey: string,
  internalAlias: string,
  baseText: string,
): Promise<string> {
  const lines = [baseText];
  const result = await context.sessions.takeBackgroundResult(chatKey, internalAlias);
  if (result) {
    lines.push("", result.text);
  } else if (context.activeTurns?.isActive(chatKey, internalAlias)) {
    lines.push("", `⏳ ${toDisplaySessionAlias(internalAlias)} 仍在执行中…`);
  }
  return lines.join("\n");
}
```

In `handleSessionUse` (line 286-291), after `useSession`, resolve the internal alias and append:

```typescript
  const switched = await context.sessions.useSession(chatKey, result.alias);
  await context.logger.info("session.selected", "selected logical session", { alias: switched.alias, chatKey });
  const internalAlias = context.sessions.peekCurrentSessionAlias(chatKey) ?? switched.alias;
  const text = await appendSwitchBackContext(context, chatKey, internalAlias, renderSwitched(switched));
  return { text };
```

In `handleSessionUsePrevious` (line 298-306), do the same after the `usePreviousSession` success path.

In `createSessionHandlerContext` (`command-router.ts`), include `activeTurns` (threaded from `buildApp` → router constructor → context). Add an `activeTurns` field to the router so `createSessionHandlerContext` can set `activeTurns: this.activeTurns`.

> `takeBackgroundResult` removes the result, so the unread marker (Task 12) clears on switch-back automatically. Long stored results flow through the normal final-send chunking because the handler's `{ text }` goes through the standard final path.

- [ ] **Step 4: Run test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts`
Expected: PASS
Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/handlers/session-handler.ts src/commands/command-router.ts
git commit -m "feat(commands): replay bg result and show running hint on switch-back"
```

### Task 12: Unread markers in the session list

**Files:**
- Modify: the session-list render path (find via `grep -rn "handleSessions\|renderSessionList\|nativeSessionListFormat" src/commands`)
- Test: a unit test for the marker decoration function

- [ ] **Step 1: Locate the list renderer**

Run:
```bash
grep -rn "handleSessions\b\|session list\|renderSession\|listSessions" src/commands/handlers/ | head
```
Identify the function that renders the `/sessions` (and `/ss` listing) output and how it iterates aliases. Note its file and the exact line where each session line/card is produced.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/commands/handlers/session-list-marker.test.ts`:

```typescript
import { test, expect } from "../../../helpers/test-harness.js"; // match repo style
import { decorateAliasWithUnread } from "../../../../src/commands/handlers/session-list-marker.js";

test("prefixes a dot when the alias has an unread bg result", () => {
  expect(decorateAliasWithUnread("backend", new Set(["backend"]))).toBe("● backend");
});

test("leaves alias unchanged with no unread result", () => {
  expect(decorateAliasWithUnread("backend", new Set())).toBe("backend");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-list-marker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement + integrate**

Create `src/commands/handlers/session-list-marker.ts`:

```typescript
// Prefix a "● " marker on sessions that have an unread background result waiting
// to be replayed on switch-back.
export function decorateAliasWithUnread(displayAlias: string, unreadInternalAliases: Set<string>): string {
  // Caller passes the set of INTERNAL aliases with unread results; the display
  // alias is compared by the caller before calling, OR pass internal alias here.
  return unreadInternalAliases.has(displayAlias) ? `● ${displayAlias}` : displayAlias;
}
```

In the list renderer (located in Step 1), build the unread set once via `context.sessions.listBackgroundResultAliases(chatKey)` and decorate each rendered alias. For the table format, prefix the name cell; for the weixin card format (`nativeSessionListFormat === "cards"`), prefix the card title. Match the unread set against the **internal** alias used when iterating sessions (convert as needed so the comparison is internal-alias to internal-alias).

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-list-marker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/handlers/session-list-marker.ts <list-renderer-file> tests/unit/commands/handlers/session-list-marker.test.ts
git commit -m "feat(commands): mark sessions with unread background results in the list"
```

### Task 13: End-to-end smoke test

**Files:**
- Create: `tests/smoke/realtime-session-switching.test.ts` (real-environment, not run by default)

- [ ] **Step 1: Write the smoke scenario**

Create a smoke test (follow the structure of existing `tests/smoke/**` tests — they use real acpx). Scenario:

```
1. /session new a --agent codex --ws <ws>
2. /session new b --agent codex --ws <ws>
3. /use a
4. send a prompt to a that takes a while (e.g. "count slowly to 20 with pauses")
5. immediately /use b   (must be accepted right away — control lane)
6. assert: no mid-output from a appears while b is foreground
7. send a quick prompt to b, assert b responds normally (parallel execution)
8. wait for a to finish; assert a "✅ a 已完成" notice arrives
9. /use a ; assert a's final result is replayed
```

- [ ] **Step 2: Run the smoke test**

Run: `npm run test:smoke`
Expected: PASS against a real acpx + configured environment. (Document any env prerequisites inline in the test.)

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/realtime-session-switching.test.ts
git commit -m "test(smoke): realtime session switching + background replay"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Run `npm test` — all unit tests pass.
- [ ] Run `bun run build` — builds `dist/cli.js` + `dist/bridge/bridge-main.js`.
- [ ] Dry-run a multi-session switch sequence (Task 10 Step 4) and eyeball output.
- [ ] Update docs: add a short note to `docs/commands.md` describing that `/use` now switches instantly during a running task and replays the backgrounded session's final result on return. Commit.

---

## Self-review notes (spec coverage)

- Spec §3 output rules → Task 8 (gate), Task 9 (notice), Task 11 (replay + running hint).
- Spec §4.1 per-session lanes → Task 6; `/use` on control → Task 7; dispatch-time key → Task 10.
- Spec §4.2 send-time gate → Task 8 (`shouldDeliverSegment` evaluated per send).
- Spec §4.3 background store (persisted, overwrite-latest) → Task 1, Task 2.
- Spec §4.4 switch-back replay / notice / list markers → Task 11, Task 9, Task 12.
- Spec §6 edges: error result stored → Task 8/9 error branch; frequent switching (no mid buffer) → Task 8 (drop, no buffer); multiple bg completions → independent keys in Task 2 + markers in Task 12; `/cancel` foreground-only → unchanged control lane targets current session; daemon restart → persisted results replay (Task 2), in-flight not resumed (documented limitation, `ActiveTurnRegistry` is in-memory by design, Task 3).
- Dispatch-time binding correctness (a queued prompt must not re-read live current) → Task 5 + Task 10.
