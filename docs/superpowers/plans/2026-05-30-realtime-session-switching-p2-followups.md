# Realtime Session Switching — P2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Dispatch note for THIS repo:** an RTK shell hook garbles `grep`/`cat`/`sed`/`head` output and sometimes the Read tool (injects fake placeholder lines). Read source with `command cat <file>` (sandbox disabled) when Read output looks like a stub, and verify git state via `git --no-pager …` or base64-encoded output. Each task: `git add` ONLY the named files, never `git add -A`, never touch `bun.lock`/`package.json`/`.gitignore`.

**Goal:** Close the three P2 items the adversarial integration review raised against the merged "realtime session switching + background execution" feature.

**Architecture:** Three independent, small hardening changes to the already-shipped feature on `main`. No new subsystems. Each task is self-contained and independently shippable.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes in src), Bun, `bun:test`. Run one test file: `node ./scripts/run-tests.mjs <path>`. Full unit suite: `node ./scripts/run-tests.mjs tests/unit`. Typecheck: `npx tsc --noEmit`. The full suite is GREEN when zero `(fail)` assertion lines appear; the `cli.test.ts` doctor probes (`FAIL Config/acpx/Bridge`) are pre-existing environment checks, NOT test failures — ignore them.

**Source of the P2 list:** final review of the feature (commits `31533ce..47fa96d`, merged at `21e759c`). Feature design: `docs/superpowers/specs/2026-05-30-realtime-session-switching-background-execution-design.md`.

---

## Background facts (verified, post-merge on `main`)

- The background completion notice is sent inside `handleWeixinMessageTurn` (`src/weixin/messaging/handle-weixin-message-turn.ts`) at TWO sites:
  - **done branch** (~line 461-462): after `await deps.onBackgroundFinal(deps.boundSessionAlias, finalText, "done");` it does `await sendMessageWeixin({ to, text: buildBackgroundCompletionNotice(deps.boundSessionAlias, "done"), opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken } }).catch(…)`.
  - **error branch** (~line 627-628): symmetric, with `"error"` and `errMessage`.
- `deps.reserveFinal` exists and is used elsewhere in this file as `const reserved = deps.reserveFinal ? deps.reserveFinal(to) : true;` — it returns a boolean and consumes one final-quota slot for the chatKey `to`. When it returns false the code logs `weixin.final.dropped reason=quota_exhausted …` and skips the send.
- The turn deps already carry `isForeground?: () => boolean`, `boundSessionAlias?: string`, `onBackgroundFinal?: (...) => Promise<void>` (interface around line 95). `shouldDeliverSegment(isForeground)` (from `./foreground-gate.js`) returns `true` when `isForeground` is undefined (legacy) and `isForeground()` otherwise.
- `/cancel` and `/stop` are control-lane (`getWeixinMessageTurnLane`). `handleCancel` in `src/commands/handlers/session-handler.ts` resolves the foreground session via `getCurrentSession(chatKey)` and cancels it. Parsing of `/cancel` lives in `src/commands/parse-command.ts`; router dispatch is the `case "cancel":` in `src/commands/command-router.ts`.

---

## Task 1: Route background completion notices through the final quota gate (P2.1)

**Why:** Spec §4.4 requires the notice to go through the quota gate so a burst of simultaneous background completions cannot blow past WeChat's per-window message cap. Today both notice sends bypass `reserveFinal`.

**Files:**
- Modify: `src/weixin/messaging/handle-weixin-message-turn.ts` (the two notice-send sites, ~461-462 and ~627-628)
- Test: `tests/unit/weixin/messaging/handle-weixin-message-turn-bg-notice.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/weixin/messaging/handle-weixin-message-turn-bg-notice.test.ts`. The full turn is heavy to drive, so extract the gate decision into a tiny pure helper and test that. First the test (it imports a not-yet-existing helper):

```typescript
import { expect, test } from "bun:test";
import { shouldSendBackgroundNotice } from "../../../../src/weixin/messaging/completion-notice";

test("sends when a final slot is reserved", () => {
  expect(shouldSendBackgroundNotice(() => true)).toBe(true);
});

test("drops when no final slot is available", () => {
  expect(shouldSendBackgroundNotice(() => false)).toBe(false);
});

test("sends when no quota gate is configured (legacy)", () => {
  expect(shouldSendBackgroundNotice(undefined)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/handle-weixin-message-turn-bg-notice.test.ts`
Expected: FAIL — `shouldSendBackgroundNotice` is not exported.

- [ ] **Step 3: Add the helper**

In `src/weixin/messaging/completion-notice.ts`, append:

```typescript
// Decide whether a background completion notice may be sent: it consumes one
// final-quota slot for the chat. `reserve` is the chat's reserveFinal bound to
// the recipient (returns true when a slot was reserved). When no reserver is
// configured (legacy callers) the notice always sends.
export function shouldSendBackgroundNotice(reserve: (() => boolean) | undefined): boolean {
  return reserve ? reserve() : true;
}
```

- [ ] **Step 4: Wire it into both notice-send sites**

In `src/weixin/messaging/handle-weixin-message-turn.ts`, import it alongside the existing notice import (line ~375):

```typescript
import { buildBackgroundCompletionNotice, shouldSendBackgroundNotice } from "./completion-notice.js";
```

At the **done branch** (~461-462), replace the unconditional notice send with a gated one:

```typescript
          await deps.onBackgroundFinal(deps.boundSessionAlias, finalText, "done");
          if (shouldSendBackgroundNotice(deps.reserveFinal ? () => deps.reserveFinal!(to) : undefined)) {
            await sendMessageWeixin({
              to,
              text: buildBackgroundCompletionNotice(deps.boundSessionAlias, "done"),
              opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
            }).catch((e) => deps.errLog(`bg completion notice failed: ${String(e)}`));
          } else {
            deps.errLog(`weixin.final.dropped reason=quota_exhausted kind=bg_notice chatKey=${to}`);
          }
```

Apply the SAME transformation at the **error branch** (~627-628), using `"error"` in `buildBackgroundCompletionNotice`. Read both regions with `command cat` first to match the exact surrounding indentation and variable names (`to`, `contextToken`, `deps.baseUrl`, `deps.token`, `deps.errLog` are all in scope at both sites).

> Rationale for the inline `() => deps.reserveFinal!(to)` thunk: it defers the slot reservation to the moment we decide to send, and only consumes a slot when one is available — matching how `reserveFinal` is used for the paginated-final path elsewhere in this file. When `deps.reserveFinal` is absent (tests / non-weixin), the notice still sends (legacy behavior preserved).

- [ ] **Step 5: Run test + full suite + typecheck**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/handle-weixin-message-turn-bg-notice.test.ts`
Expected: PASS (3/3).
Run: `node ./scripts/run-tests.mjs tests/unit` — no new `(fail)` lines.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/weixin/messaging/completion-notice.ts src/weixin/messaging/handle-weixin-message-turn.ts tests/unit/weixin/messaging/handle-weixin-message-turn-bg-notice.test.ts
git commit -m "fix(turn): gate background completion notice through final quota"
```

---

## Task 2: Harden the background final-send path against a missing onBackgroundFinal (P2.3)

**Why:** In the (currently unreachable) configuration where a turn is backgrounded (`isForeground()` is false) but `onBackgroundFinal`/`boundSessionAlias` are not wired, the existing `if (… && deps.boundSessionAlias && deps.onBackgroundFinal) { store } else { normal send }` structure falls through to the NORMAL send — leaking the backgrounded session's final answer into the foreground chat. Make "backgrounded" suppress the normal send regardless of whether storage is wired. Do this FIRST (before Task 3) because it's a small safety net in the same file as Task 1.

**Files:**
- Modify: `src/weixin/messaging/handle-weixin-message-turn.ts` (final-text block ~457-558 and error block ~620-653)
- Test: `tests/unit/weixin/messaging/background-suppression.test.ts` (create) — pure-helper level

- [ ] **Step 1: Write the failing test**

The decision "given backgrounded + maybe-missing storage, what do we do with the final?" is best expressed as a pure helper. Create `tests/unit/weixin/messaging/background-suppression.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { resolveFinalDisposition } from "../../../../src/weixin/messaging/foreground-gate";

test("foreground → send normally", () => {
  expect(resolveFinalDisposition(true, true)).toBe("send");
});

test("backgrounded with storage wired → store", () => {
  expect(resolveFinalDisposition(false, true)).toBe("store");
});

test("backgrounded without storage wired → drop (never leak to foreground)", () => {
  expect(resolveFinalDisposition(false, false)).toBe("drop");
});

test("foreground without storage → send normally", () => {
  expect(resolveFinalDisposition(true, false)).toBe("send");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/background-suppression.test.ts`
Expected: FAIL — `resolveFinalDisposition` not exported.

- [ ] **Step 3: Add the helper**

In `src/weixin/messaging/foreground-gate.ts`, append:

```typescript
export type FinalDisposition = "send" | "store" | "drop";

// Decide what to do with a turn's final output:
//   - foreground            → "send" through the normal quota-gated path
//   - backgrounded + can store → "store" via onBackgroundFinal
//   - backgrounded + cannot store → "drop" (NEVER fall through to a foreground
//     send, which would leak a background session's answer into the wrong chat)
export function resolveFinalDisposition(isForeground: boolean, canStore: boolean): FinalDisposition {
  if (isForeground) return "send";
  return canStore ? "store" : "drop";
}
```

- [ ] **Step 4: Apply it at both blocks**

In `src/weixin/messaging/handle-weixin-message-turn.ts`, import:

```typescript
import { shouldDeliverSegment, resolveFinalDisposition } from "./foreground-gate.js";
```

In the **final-text block**, replace the current `if (!shouldDeliverSegment(deps.isForeground) && deps.boundSessionAlias && deps.onBackgroundFinal) { store } else { …normal send… }` with a three-way switch on the disposition:

```typescript
      if (finalText.length > 0) {
        const disposition = resolveFinalDisposition(
          shouldDeliverSegment(deps.isForeground),
          Boolean(deps.boundSessionAlias && deps.onBackgroundFinal),
        );
        if (disposition === "store") {
          await deps.onBackgroundFinal!(deps.boundSessionAlias!, finalText, "done");
          // …Task 1's gated completion notice…
        } else if (disposition === "drop") {
          deps.errLog(`weixin.final.dropped reason=backgrounded_no_store kind=text chatKey=${to}`);
        } else {
          // …ALL the existing chunk/reserveFinal/sendMessageWeixin normal-send logic, unchanged…
        }
      }
```

Apply the SAME three-way shape to the **error block**: `store` → `onBackgroundFinal(..., "error")` + gated notice; `drop` → `deps.errLog("weixin.final.dropped reason=backgrounded_no_store kind=error_notice …")`; `send` → existing `reserveFinal` + `sendWeixinErrorNotice` path unchanged.

> Read both blocks with `command cat` first. Preserve the existing `perfSpan.mark("reply.final_done", …)` call and all metric variables. The Task-1 notice code lives inside the `"store"` branch. Behavior is IDENTICAL to today in every reachable config: foreground → `"send"`; backgrounded with wiring → `"store"`. Only the previously-leaky backgrounded-without-wiring case changes (now `"drop"` instead of leak).

- [ ] **Step 5: Verify**

Run: `node ./scripts/run-tests.mjs tests/unit/weixin/messaging/background-suppression.test.ts` — PASS (4/4).
Run: `node ./scripts/run-tests.mjs tests/unit` — no new `(fail)`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/weixin/messaging/foreground-gate.ts src/weixin/messaging/handle-weixin-message-turn.ts tests/unit/weixin/messaging/background-suppression.test.ts
git commit -m "fix(turn): never leak a backgrounded final when storage is unwired"
```

---

## Task 3: `/cancel <alias>` — cancel a specific (possibly backgrounded) session (P2.2)

**Why:** Today `/cancel` only aborts the foreground session's running turn. After switching away from a long task, you cannot kill it without switching back first. Add an optional alias argument so `/cancel <alias>` (and `/stop <alias>`) cancels that session's in-flight turn; bare `/cancel` keeps cancelling the foreground session.

This task has a genuine unknown (how cancel currently reaches a running turn), so it starts with a discovery step.

**Files:**
- Modify: `src/commands/parse-command.ts` (cancel/stop parsing → optional alias)
- Modify: `src/commands/command-router.ts` (`case "cancel"` dispatch passes the alias through)
- Modify: `src/commands/handlers/session-handler.ts` (`handleCancel` resolves a specific alias)
- Test: `tests/unit/commands/parse-command.test.ts` (extend) and `tests/unit/commands/handlers/session-handler.test.ts` (extend)

- [ ] **Step 1: Discovery (no code change)**

Read, with `command cat`:
- `src/commands/handlers/session-handler.ts` `handleCancel` — how does it currently cancel? Does it call `context.sessions.getCurrentSession(chatKey)` then a transport/interaction `cancel(session)`, or does it trip an `AbortSignal` wired to the running turn? Note the exact mechanism and signature.
- `src/commands/parse-command.ts` — the `/cancel` and `/stop` parse arms (they currently produce `{ kind: "cancel" }`).
- `src/commands/command-router.ts` — the `case "cancel":` dispatch and how `handleCancel` is invoked.
- How a running prompt's cancellation is delivered: search for `abortSignal`, `AbortController`, `transport.cancel`, `interaction.cancel`. Determine whether cancel can target a session OTHER than the foreground one (per-session lanes mean multiple turns may be in flight). Write a 4-6 line note in your report: "cancel works by X; to target session Y I will Z."

If discovery shows cancelling a non-foreground session is infeasible without larger plumbing (e.g. abort controllers are only held for the foreground turn), STOP and report BLOCKED with the finding — do not fake it. Otherwise continue.

- [ ] **Step 2: Write the failing parse test**

Extend `tests/unit/commands/parse-command.test.ts` (match its existing style — read it first). Add:

```typescript
test("/cancel parses with no alias (foreground)", () => {
  expect(parseCommand("/cancel")).toEqual({ kind: "cancel" });
});

test("/cancel <alias> parses the target alias", () => {
  expect(parseCommand("/cancel backend")).toEqual({ kind: "cancel", alias: "backend" });
});

test("/stop <alias> parses the target alias", () => {
  expect(parseCommand("/stop backend")).toEqual({ kind: "cancel", alias: "backend" });
});
```

> Confirm the real `parseCommand` export name/signature and the exact shape it returns for `/cancel` today (it may include other fields). Match them; only ADD the optional `alias`.

- [ ] **Step 3: Run parse test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/parse-command.test.ts`
Expected: FAIL — alias not parsed.

- [ ] **Step 4: Implement parsing**

In `src/commands/parse-command.ts`, change the `/cancel` and `/stop` arms to capture an optional trailing token as `alias` (omit the field when absent so bare `/cancel` still deep-equals `{ kind: "cancel" }`). Match the file's existing parsing idiom (split on whitespace, the command is token 0, alias is token 1 if present).

- [ ] **Step 5: Write the failing handler test**

Extend `tests/unit/commands/handlers/session-handler.test.ts`. Using the same fake-context style already in that file, assert that:
- `handleCancel(context, chatKey)` (no alias) cancels the FOREGROUND session (resolved via `getCurrentSession`), and
- `handleCancel(context, chatKey, "backend")` resolves "backend" (via the resolver discovered in Step 1 — likely `resolveFuzzyAlias` + `getResolvedSessionByInternalAlias`, or `getSession`) and cancels THAT session.

Write the assertions against whatever cancel mechanism Step 1 identified (e.g. a recorded `cancel(session)` call capturing which session was passed). Keep them strong: the no-alias path must hit the foreground session; the alias path must hit the named session.

- [ ] **Step 6: Run handler test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts`
Expected: FAIL — `handleCancel` ignores the alias arg.

- [ ] **Step 7: Implement handler + router**

- `handleCancel(context, chatKey, alias?)`: when `alias` is provided, resolve it (fuzzy → internal → `getResolvedSessionByInternalAlias`, mirroring `handleSessionUse`'s resolution; handle "none"/"ambiguous" with the same user-facing messages) and cancel that session via the mechanism from Step 1. When absent, keep the current `getCurrentSession` path. Return a confirmation naming which session was cancelled (display alias).
- `src/commands/command-router.ts` `case "cancel":` — pass `command.alias` through to `handleCancel`.

> Keep the cancel MECHANISM identical to today (same transport/abort call); only the SESSION SELECTION changes. If Step 1 found cancellation is delivered via an abort controller held only for the foreground turn, the implementation must instead look up the target session's in-flight turn — if that registry doesn't exist, that's the BLOCKED case from Step 1.

- [ ] **Step 8: Verify**

Run: `node ./scripts/run-tests.mjs tests/unit/commands/parse-command.test.ts` — PASS.
Run: `node ./scripts/run-tests.mjs tests/unit/commands/handlers/session-handler.test.ts` — PASS.
Run: `node ./scripts/run-tests.mjs tests/unit` — no new `(fail)`.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 9: Update docs + commit**

Add a line to `docs/commands.md` near the `/cancel` / `/stop` entry: `/cancel [alias]` / `/stop [alias]` — 不带参数取消当前前台会话的在跑任务；带 alias 取消指定（含后台）会话的任务。

```bash
git add src/commands/parse-command.ts src/commands/command-router.ts src/commands/handlers/session-handler.ts tests/unit/commands/parse-command.test.ts tests/unit/commands/handlers/session-handler.test.ts docs/commands.md
git commit -m "feat(commands): /cancel <alias> cancels a specific background session"
```

---

## Self-review notes (coverage)

- **P2.1** (notice bypasses quota gate) → Task 1.
- **P2.3** (backgrounded final leaks when storage unwired) → Task 2.
- **P2.2** (no cancel for a specific background session) → Task 3, with a discovery gate because the cancel-delivery mechanism is not yet traced.

Tasks 1 and 2 are mechanical and low-risk (same file, pure-helper-tested, behavior-preserving in all reachable configs). Task 3 is the only one with real design risk; its Step 1 discovery decides feasibility before any code is written.
