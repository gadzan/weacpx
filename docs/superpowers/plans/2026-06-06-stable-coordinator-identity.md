# Stable Coordinator Identity Across `/clear` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make orchestration coordinator identity stable across `/clear` (transport-session rotation) so an agent can still `task_cancel` / approve / manage tasks it delegated before the reset.

**Architecture:** The coordinator identity is currently `session.transportSession`. `/clear` rotates that name from `workspace:alias` to `workspace:alias:reset-<timestamp>` (`session-reset-handler.ts:113-114`), so tasks delegated before `/clear` become un-cancellable afterward ("belongs to a previous coordinator", `orchestration-service.ts:2810`). We introduce a pure helper `stableCoordinatorSession()` that strips the volatile `:reset-<digits>` suffix, yielding the stable `workspace:alias` (the workspace-scoped alias). We apply it at the input boundaries where `session.transportSession` becomes a coordinator identity (the agent's MCP queue-owner identity at `command-router.ts:681`, and the WeChat slash-command handlers), update the coordinator-wake reverse-lookup to match on the normalized value, and add a defense-in-depth normalization inside the ownership assertions. The helper is a no-op on any string without a `:reset-<n>` suffix, so external coordinators (`external_*`) and normal sessions are unaffected. No state-key migration is performed; the existing reset-coordinator GC (`purgeExpiredResetCoordinators`) continues to clean any pre-fix reset records.

**Tech Stack:** TypeScript, Bun (build + test runner), Node. Tests under `tests/unit/**/*.test.ts` run via `npm test` (typecheck + unit). Per the repo's testing notes, verify individual test files in isolation (`bun test <file>`), not whole directories.

---

## File Structure

- **Create** `src/orchestration/coordinator-identity.ts` — pure leaf module exporting `stableCoordinatorSession(transportSession: string): string`. No imports, so it can be used from `sessions/`, `commands/`, and `orchestration/` without import cycles.
- **Create** `tests/unit/orchestration/coordinator-identity.test.ts` — unit tests for the helper.
- **Modify** `src/commands/command-router.ts:681` — normalize the coordinator identity baked into `session.mcpCoordinatorSession` (covers the agent MCP path: queue-owner `--coordinator-session`, both transports, and wake).
- **Modify** `src/commands/handlers/orchestration-handler.ts` — normalize every `coordinatorSession: session.transportSession` site and every `task.coordinatorSession !== session.transportSession` pre-check, and the `cleanTasks(session.transportSession)` call (the WeChat slash-command path).
- **Modify** `src/sessions/session-service.ts:184-196` — `getPreferredSessionForTransport` matches on the normalized value so coordinator-wake resolves to the current (post-reset) session.
- **Modify** `src/orchestration/orchestration-service.ts` — defense-in-depth: normalize both sides in `assertCoordinatorOwnership` (3583-3589) and `assertGroupOwnership` (~3605).
- **Create/Modify tests** `tests/unit/commands/orchestration-handler*.test.ts` (or the closest existing handler test) and `tests/unit/sessions/session-service.test.ts` and `tests/unit/orchestration/orchestration-service.test.ts` for the changed behavior.

---

### Task 1: `stableCoordinatorSession` helper

**Files:**
- Create: `src/orchestration/coordinator-identity.ts`
- Test: `tests/unit/orchestration/coordinator-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/orchestration/coordinator-identity.test.ts
import { describe, expect, it } from "bun:test";
import { stableCoordinatorSession } from "../../../src/orchestration/coordinator-identity";

describe("stableCoordinatorSession", () => {
  it("returns a normal transport session unchanged", () => {
    expect(stableCoordinatorSession("ws:alias")).toBe("ws:alias");
  });

  it("strips a trailing :reset-<timestamp> suffix", () => {
    expect(stableCoordinatorSession("ws:alias:reset-1700000000000")).toBe("ws:alias");
  });

  it("only strips a single trailing reset segment and keeps the stable base", () => {
    // /clear always rebuilds from workspace+alias, so there is never more than one reset segment
    expect(stableCoordinatorSession("teamA:weixin:bob:reset-42")).toBe("teamA:weixin:bob");
  });

  it("is a no-op on external coordinator identities", () => {
    expect(stableCoordinatorSession("external_claude-code:abcd1234")).toBe(
      "external_claude-code:abcd1234",
    );
  });

  it("does not strip a non-numeric reset-like segment", () => {
    expect(stableCoordinatorSession("ws:alias:reset-notanumber")).toBe("ws:alias:reset-notanumber");
  });

  it("does not strip when reset appears mid-string", () => {
    expect(stableCoordinatorSession("ws:reset-1:alias")).toBe("ws:reset-1:alias");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/orchestration/coordinator-identity.test.ts`
Expected: FAIL — cannot resolve module `coordinator-identity`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/orchestration/coordinator-identity.ts

/**
 * The orchestration coordinator identity is derived from a session's transport
 * name. `/clear` rotates that name from `workspace:alias` to
 * `workspace:alias:reset-<timestamp>` (see session-reset-handler), which would
 * otherwise orphan every task delegated before the reset. Stripping the
 * volatile `:reset-<digits>` suffix yields the stable `workspace:alias` identity
 * so ownership survives `/clear`.
 *
 * Pure leaf module: do not add imports, so it can be used from sessions/,
 * commands/, and orchestration/ without risking an import cycle.
 *
 * No-op on any value lacking a trailing `:reset-<digits>` segment, so external
 * coordinators (`external_*`) and normal sessions pass through unchanged.
 */
export function stableCoordinatorSession(transportSession: string): string {
  return transportSession.replace(/:reset-\d+$/, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/orchestration/coordinator-identity.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/coordinator-identity.ts tests/unit/orchestration/coordinator-identity.test.ts
git commit -m "feat(orchestration): add stableCoordinatorSession identity helper"
```

---

### Task 2: Normalize the agent MCP coordinator identity (`command-router.ts:681`)

This is the linchpin for the reported symptom (an *agent* calling `task_cancel`). `session.mcpCoordinatorSession` becomes the `--coordinator-session` baked into the spawned MCP queue owner (`acpx-cli-transport.ts:385`, `acpx-bridge-transport.ts:221`) and the value all agent MCP tool calls (`delegate_request`, `task_cancel`, …) carry. Normalizing here makes the old and the post-`/clear` queue owners share the stable identity.

**Files:**
- Modify: `src/commands/command-router.ts` (line 681 and imports)

- [ ] **Step 1: Add the import**

At the top of `src/commands/command-router.ts`, with the other `../` imports, add:

```typescript
import { stableCoordinatorSession } from "../orchestration/coordinator-identity";
```

- [ ] **Step 2: Normalize the assignment**

Replace line 681:

```typescript
    session.mcpCoordinatorSession ??= session.transportSession;
```

with:

```typescript
    session.mcpCoordinatorSession ??= stableCoordinatorSession(session.transportSession);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/command-router.ts
git commit -m "fix(orchestration): bake stable coordinator identity into MCP queue owner"
```

---

### Task 3: Normalize the WeChat slash-command handlers (`orchestration-handler.ts`)

The WeChat `/delegate`, `/task cancel|approve|reject`, `/group …`, `/tasks clean` handlers use `session.transportSession` directly as the coordinator identity and in their `taskNotFound` pre-checks. Normalize them so the slash-command path is stable across `/clear` too, and so its pre-check does not short-circuit to `taskNotFound` before the service is even called.

**Files:**
- Modify: `src/commands/handlers/orchestration-handler.ts`
- Test: `tests/unit/commands/orchestration-handler.test.ts` (create if absent)

- [ ] **Step 1: Add the import**

At the top of `src/commands/handlers/orchestration-handler.ts`, after the existing `import { t } from "../../i18n";` line, add:

```typescript
import { stableCoordinatorSession } from "../../orchestration/coordinator-identity";
```

- [ ] **Step 2: Normalize every coordinator-identity use**

In each handler function that derives the coordinator identity from the session, introduce a local right after the `session` is obtained and is known non-null:

```typescript
  const coordinatorSession = stableCoordinatorSession(session.transportSession);
```

Then replace, within that function:
- every `coordinatorSession: session.transportSession,` → `coordinatorSession,`
- every `task.coordinatorSession !== session.transportSession` → `task.coordinatorSession !== coordinatorSession`
- `await orchestration.cleanTasks(session.transportSession)` (line 381) → `await orchestration.cleanTasks(coordinatorSession)`

Leave `sourceHandle: session.transportSession,` (line 84) **unchanged** — `sourceHandle` is a routing handle, not an ownership identity.

The concrete sites to update (verify by grep after editing):
- `coordinatorSession:` assignments — lines 86, 116, 138, 161, 186, 194, 221, 255, 305, 336, 364
- ownership pre-checks — lines 273, 296, 327, 358
- `cleanTasks(...)` — line 381

- [ ] **Step 3: Verify no raw `session.transportSession` remains as a coordinator identity**

Run:
```bash
command grep -n "coordinatorSession: session.transportSession\|!== session.transportSession\|cleanTasks(session.transportSession)" src/commands/handlers/orchestration-handler.ts
```
Expected: no output (only `sourceHandle: session.transportSession,` at line 84 still references it).

- [ ] **Step 4: Write the regression test**

Add to `tests/unit/commands/orchestration-handler.test.ts` (follow the existing handler-test setup if the file already exists; otherwise mirror the construction used in `tests/unit/orchestration/orchestration-server.test.ts` for a fake `orchestration` + `context`). The key assertion: after the current session's `transportSession` is rotated to a `:reset-…` name, a `task cancel` for a task owned by the pre-reset `ws:alias` still routes to the service with the stable id rather than returning `taskNotFound`.

```typescript
import { describe, expect, it } from "bun:test";
import { handleTaskCancel } from "../../../src/commands/handlers/orchestration-handler";

function buildContext(opts: {
  transportSession: string;
  task: { taskId: string; coordinatorSession: string };
  onCancel: (input: { taskId: string; coordinatorSession: string }) => void;
}) {
  const orchestration = {
    getTask: async (taskId: string) => (taskId === opts.task.taskId ? opts.task : null),
    requestTaskCancellation: async (input: { taskId: string; coordinatorSession: string }) => {
      opts.onCancel(input);
      return { ...opts.task, status: "cancelled" };
    },
  };
  const context = {
    sessions: {
      getCurrentSession: async () => ({
        alias: "alias",
        agent: "codex",
        workspace: "ws",
        transportSession: opts.transportSession,
      }),
    },
    getOrchestration: () => orchestration,
    // plus whatever getCurrentSession/getOrchestration accessors the handler uses
  };
  return { context, orchestration };
}

describe("handleTaskCancel stable identity", () => {
  it("cancels a task owned by the pre-/clear coordinator after transport rotation", async () => {
    let received: { taskId: string; coordinatorSession: string } | null = null;
    const { context } = buildContext({
      transportSession: "ws:alias:reset-1700000000000", // current session, post /clear
      task: { taskId: "t1", coordinatorSession: "ws:alias" }, // delegated before /clear
      onCancel: (input) => {
        received = input;
      },
    });

    // NOTE: adapt the call signature/accessors to match the real handler + test helpers in this repo.
    await handleTaskCancel(context as never, "wx:chat", "t1");

    expect(received).not.toBeNull();
    expect(received!.coordinatorSession).toBe("ws:alias");
  });
});
```

If the existing handler tests use a richer shared fixture (`CommandRouterContext`), reuse that fixture instead of the inline fake above — match the established pattern; the assertion (stable `coordinatorSession` reaches the service, no `taskNotFound`) is what matters.

- [ ] **Step 5: Run the test**

Run: `bun test tests/unit/commands/orchestration-handler.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/handlers/orchestration-handler.ts tests/unit/commands/orchestration-handler.test.ts
git commit -m "fix(orchestration): use stable coordinator identity in WeChat slash handlers"
```

---

### Task 4: Fix the coordinator-wake reverse-lookup (`session-service.ts`)

After `/clear`, a task owned by the stable `ws:alias` must still wake the *current* session whose `transport_session` is `ws:alias:reset-…`. `getPreferredSessionForTransport` currently filters by exact `transport_session` equality, which misses the rotated session and surfaces `no logical session is attached to coordinator`.

**Files:**
- Modify: `src/sessions/session-service.ts:184-196` (and imports)
- Test: `tests/unit/sessions/session-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/sessions/session-service.test.ts` (reuse the file's existing `SessionService` construction/fixtures):

```typescript
it("resolves the current reset session from the stable coordinator id", async () => {
  // Arrange: a logical session whose transport was rotated by /clear.
  // Use the suite's existing helper to seed state.sessions with:
  //   alias: "alias", workspace: "ws", transport_session: "ws:alias:reset-1700000000000"
  const service = makeServiceWithSession({
    alias: "alias",
    workspace: "ws",
    transport_session: "ws:alias:reset-1700000000000",
  });

  const resolved = await service.getPreferredSessionForTransport("ws:alias");

  expect(resolved).not.toBeNull();
  expect(resolved!.alias).toBe("alias");
  expect(resolved!.transportSession).toBe("ws:alias:reset-1700000000000");
});
```

(Adapt `makeServiceWithSession` to whatever seeding helper the test file already provides.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/sessions/session-service.test.ts`
Expected: FAIL — `resolved` is `null` (exact-equality filter misses the rotated transport).

- [ ] **Step 3: Add the import**

At the top of `src/sessions/session-service.ts`, with the other imports, add:

```typescript
import { stableCoordinatorSession } from "../orchestration/coordinator-identity";
```

- [ ] **Step 4: Normalize the lookup**

Replace the body of `getPreferredSessionForTransport` (lines 184-196):

```typescript
  async getPreferredSessionForTransport(transportSession: string): Promise<ResolvedSession | null> {
    const target = stableCoordinatorSession(transportSession);
    const matches = Object.values(this.state.sessions)
      .filter((session) => stableCoordinatorSession(session.transport_session) === target)
      .sort((left, right) => right.last_used_at.localeCompare(left.last_used_at));

    const expectedAlias = target.split(":").at(-1);
    const expectedWorkspace = target.split(":")[0];
    const preferred =
      matches.find(
        (session) => session.alias === expectedAlias && session.workspace === expectedWorkspace,
      ) ?? matches[0];
    return preferred ? this.toResolvedSession(preferred) : null;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/sessions/session-service.test.ts`
Expected: PASS (new test passes, existing tests still pass).

- [ ] **Step 6: Commit**

```bash
git add src/sessions/session-service.ts tests/unit/sessions/session-service.test.ts
git commit -m "fix(sessions): resolve coordinator wake by stable identity across /clear"
```

---

### Task 5: Defense-in-depth in the ownership assertions (`orchestration-service.ts`)

Even if a caller is missed, normalizing both sides of the ownership comparison guarantees a coordinator can manage tasks it owns, and heals any legacy reset-suffixed task records already in `state.json`.

**Files:**
- Modify: `src/orchestration/orchestration-service.ts` (`assertCoordinatorOwnership` ~3583-3589, `assertGroupOwnership` ~3605, and the import block)
- Test: `tests/unit/orchestration/orchestration-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/orchestration/orchestration-service.test.ts` (reuse the suite's existing service + in-memory state harness). The scenario: a task stored with a legacy `:reset-` coordinator id is cancellable by the stable id.

```typescript
it("authorizes cancellation when only a :reset- suffix differs", async () => {
  // Seed a task whose stored coordinatorSession carries a legacy reset suffix.
  const { service } = makeServiceWithTask({
    taskId: "t1",
    coordinatorSession: "ws:alias:reset-1700000000000",
    status: "running",
  });

  // Stable id (post-fix) must be accepted, not rejected with "belongs to coordinator".
  const cancelled = await service.requestTaskCancellation({
    taskId: "t1",
    coordinatorSession: "ws:alias",
  });

  expect(cancelled.taskId).toBe("t1");
});
```

(Adapt `makeServiceWithTask` to the file's existing fixture builder.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/orchestration/orchestration-service.test.ts`
Expected: FAIL — throws `task "t1" belongs to coordinator "ws:alias:reset-1700000000000", not "ws:alias"`.

- [ ] **Step 3: Add the import**

With the other imports at the top of `src/orchestration/orchestration-service.ts`, add:

```typescript
import { stableCoordinatorSession } from "./coordinator-identity";
```

- [ ] **Step 4: Normalize both sides in the assertions**

In `assertCoordinatorOwnership` (currently):

```typescript
  private assertCoordinatorOwnership(task: OrchestrationTaskRecord, coordinatorSession: string): void {
    if (task.coordinatorSession !== coordinatorSession) {
      throw new Error(
        `task "${task.taskId}" belongs to coordinator "${task.coordinatorSession}", not "${coordinatorSession}"`,
      );
    }
  }
```

change the comparison:

```typescript
  private assertCoordinatorOwnership(task: OrchestrationTaskRecord, coordinatorSession: string): void {
    if (stableCoordinatorSession(task.coordinatorSession) !== stableCoordinatorSession(coordinatorSession)) {
      throw new Error(
        `task "${task.taskId}" belongs to coordinator "${task.coordinatorSession}", not "${coordinatorSession}"`,
      );
    }
  }
```

Apply the identical normalization to the comparison in `assertGroupOwnership` (~3605):

```typescript
    if (stableCoordinatorSession(group.coordinatorSession) !== stableCoordinatorSession(coordinatorSession)) {
```

Also normalize the standalone guard at `requestTaskCancellation` (~2810-2814) if it does not route through `assertCoordinatorOwnership`:

```typescript
    if (
      input.coordinatorSession !== undefined &&
      stableCoordinatorSession(task.coordinatorSession) !== stableCoordinatorSession(input.coordinatorSession)
    ) {
      throw new Error(
        `task "${input.taskId}" belongs to coordinator "${task.coordinatorSession}", not "${input.coordinatorSession}"`,
      );
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/orchestration/orchestration-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/orchestration/orchestration-service.ts tests/unit/orchestration/orchestration-service.test.ts
git commit -m "fix(orchestration): normalize coordinator identity in ownership guards"
```

---

### Task 6: Full verification & reset-machinery reconciliation

The change means post-`/clear` coordinators no longer mint a *new* `:reset-` identity for ownership, so existing tests around reset-coordinator detection/purge may assert obsolete behavior. Run the full suite and reconcile.

**Files:**
- Possibly modify: `tests/unit/orchestration/orchestration-service.test.ts`, `tests/unit/run-console.test.ts`, `tests/unit/main.test.ts`, `tests/unit/commands/command-router-interaction.test.ts` (only if they encode the old "reset coordinator is a distinct, un-cancellable identity" assumption).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the affected suites in isolation (per repo testing notes)**

Run each individually (whole-directory runs give false state-leak failures — see repo testing notes):
```bash
bun test tests/unit/orchestration/coordinator-identity.test.ts
bun test tests/unit/orchestration/orchestration-service.test.ts
bun test tests/unit/sessions/session-service.test.ts
bun test tests/unit/commands/orchestration-handler.test.ts
bun test tests/unit/commands/command-router-interaction.test.ts
bun test tests/unit/run-console.test.ts
bun test tests/unit/main.test.ts
```
Expected: all PASS. For any failure that asserts the *old* behavior (a reset coordinator being a separate, un-owned identity), update the test to the new model: reset rotation no longer changes ownership; the stable `workspace:alias` owns the tasks. Keep the `purgeExpiredResetCoordinators` GC tests that seed `:reset-` state **directly** — that machinery still cleans legacy/raw reset records and should keep passing unchanged.

- [ ] **Step 3: Run the full unit suite the way CI does**

Run: `npm test`
Expected: typecheck clean + all unit tests pass.

- [ ] **Step 4: Manual end-to-end sanity (dry-run, optional but recommended)**

Confirm the original symptom is gone using the dry-run harness:
```bash
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/delegate codex do-thing" "/clear" "/task list"
```
Expected: after `/clear`, `/task list` (and a subsequent `/task cancel <id>`) still recognize the task as owned by the current coordinator rather than reporting it belongs to a previous coordinator. (Worker delegation needs a real backend; the ownership/identity routing is what we are checking.)

- [ ] **Step 5: Final commit (only if test files changed in Step 2)**

```bash
git add tests/
git commit -m "test(orchestration): align reset-coordinator tests with stable identity"
```

---

## Self-Review Notes

- **Spec coverage:** The reported bug (agent `task_cancel` rejected as "belongs to a previous orchestrator" after `/clear`) is fixed by Task 2 (agent MCP path) + Task 5 (ownership guard). The WeChat slash path is covered by Task 3. Coordinator wake / result delivery across `/clear` is preserved by Task 4. Task 1 provides the single shared primitive; Task 6 verifies and reconciles.
- **Identity choice:** "Stable identity (alias)" is realized as `stableCoordinatorSession()` returning the workspace-scoped base `workspace:alias`, which is exactly the pre-reset transport name (`session-handler.ts:200`). This avoids a state-key migration and is a no-op for `external_*` coordinators and normal sessions.
- **Known limitation (out of scope):** A session attached via `/session attach` to an arbitrary custom transport name (not `workspace:alias`) and then `/clear`-ed will have its pre-clear identity (the custom name) differ from the post-clear base (`workspace:alias`). This is rare and pre-existing; a full alias-keyed identity model (with state migration) would be required to cover it and is intentionally not attempted here.
- **Reset GC:** `purgeExpiredResetCoordinators` and friends are intentionally left intact to clean any reset-suffixed records created before this fix; they simply find no new candidates going forward.
