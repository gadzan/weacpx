# Relay-web Turn-Status Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give relay-web's chat live + persisted per-turn status — "working" HUD with elapsed timer, collapsible tool-call panel with friendly per-kind detail (no raw JSON), reasoning panel, and done/stopped/error terminal states — by plumbing new typed control events end-to-end and normalizing tool data at the connector.

**Architecture:** `ControlService.prompt` emits new bus events (`turn-started`, `tool-event`, `turn-thought`, plus a `cancelled` flag on `turn-finished`). The connector normalizes each raw `ToolUseEvent` into a small presentation-ready `ToolStepDto` (one unit-tested module). The relay server accumulates per-turn structured state and persists it in a new SQLite `structured` column; relay-web renders it live and reloads it from history with pure per-kind renderer components.

**Tech Stack:** TypeScript, Bun test (core/connector/relay/protocol under `tests/unit/**`), Vitest + @vue/test-utils + jsdom (relay-web under `packages/relay-web/src/__tests__/`), Vue 3 + Pinia + Tailwind, Hono relay server, SQLite (`node:sqlite`/`bun:sqlite`).

**Conventions used throughout:**
- Run a core/connector/relay/protocol test file: `node ./scripts/run-tests.mjs <path-to-test-file>`
- Run a relay-web test file: `bun run --cwd packages/relay-web test -- <filter>`
- Typecheck: `npx tsc --noEmit`
- Build relay-web (proves the package compiles): `bun run --cwd packages/relay-web build`
- **Git hygiene:** stage only the exact paths listed in each Commit step. NEVER `git add -A`/`git add .`. Never stage `bun.lock`, `dist/`, or `node_modules/`.
- **Do NOT** run whole-directory `bun test` (state-leak false failures). Use the per-file commands above.

---

## File Structure

**Core (`src/`):**
- `src/control/control-event-bus.ts` — MODIFY: add 3 variants + `cancelled?` on `turn-finished`.
- `src/control/control-service.ts` — MODIFY: emit `turn-started`, wire `onToolEvent`/`onThought`, set `cancelled` on abort.

**Protocol (`packages/relay-protocol/src/`):**
- `dtos.ts` — MODIFY: add `ToolStepDto`/`ToolDetailDto` + 3 `ControlEventDto` variants + `cancelled?`.
- `web-dtos.ts` — MODIFY: add `MessageRecordDto.structured`, new control-event types + validators.

**Connector (`packages/channel-relay/src/`):**
- `tool-presentation.ts` — CREATE: `toolUseEventToStepDto(event)` normalizer + caps.
- `control-bridge.ts` — MODIFY: map `tool-event` through the normalizer in `subscribeControlEvents`.

**Relay server (`packages/relay/src/`):**
- `db.ts` — MODIFY: migrate `messages` to add a nullable `structured` column.
- `stores/messages.ts` — MODIFY: `append` accepts `structured`; `listBySession` projects it.
- `server.ts` — MODIFY: `turnBuffers` becomes a richer accumulator; persist `structured` on finish.

**relay-web (`packages/relay-web/src/`):**
- `stores/chat.ts` — MODIFY: `LiveTurn` model + new-variant handling + busy flag.
- `components/ToolDetail.vue` — CREATE: per-kind detail presenters.
- `components/ToolCallPanel.vue` — CREATE: collapsible tool list.
- `components/ReasoningPanel.vue` — CREATE: collapsible reasoning.
- `components/MessageList.vue` — MODIFY: render persisted panels under `out` messages + live panels.
- `components/ChatPane.vue` — MODIFY: status HUD + elapsed timer.
- `components/PromptInput.vue` — MODIFY: busy-guard.

**Docs:**
- `docs/relay-module.md`, `docs/relay-web-module.md` — MODIFY.

---

## Task 1: Core bus — new control-event variants

**Files:**
- Modify: `src/control/control-event-bus.ts`
- Test: `tests/unit/control/control-event-bus.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `tests/unit/control/control-event-bus.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

test("bus forwards the new turn-status variants verbatim", () => {
  const bus = createControlEventBus();
  const seen: ControlEvent[] = [];
  bus.subscribe((e) => seen.push(e));

  bus.emit({ type: "turn-started", chatKey: "relay:a", sessionAlias: "backend" });
  bus.emit({
    type: "tool-event",
    chatKey: "relay:a",
    sessionAlias: "backend",
    event: { toolCallId: "t1", toolName: "Read", kind: "read", status: "running" },
  });
  bus.emit({ type: "turn-thought", chatKey: "relay:a", sessionAlias: "backend", chunk: "hmm" });
  bus.emit({ type: "turn-finished", chatKey: "relay:a", sessionAlias: "backend", ok: false, cancelled: true });

  expect(seen.map((e) => e.type)).toEqual(["turn-started", "tool-event", "turn-thought", "turn-finished"]);
  expect(seen[3]).toMatchObject({ ok: false, cancelled: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/control/control-event-bus.test.ts`
Expected: FAIL (TypeScript error — `turn-started`/`tool-event`/`turn-thought` not assignable to `ControlEvent`).

- [ ] **Step 3: Add the variants**

In `src/control/control-event-bus.ts`, add the import at the top (after the existing `AppLogger` import):

```ts
import type { ToolUseEvent } from "../channels/types";
```

Replace the `ControlEvent` union with:

```ts
export type ControlEvent =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-started"; chatKey: string; sessionAlias: string }
  | { type: "tool-event"; chatKey: string; sessionAlias: string; event: ToolUseEvent }
  | { type: "turn-thought"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string; cancelled?: boolean }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/control/control-event-bus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/control-event-bus.ts tests/unit/control/control-event-bus.test.ts
git commit -m "feat(control): add turn-started/tool-event/turn-thought bus variants + cancelled flag"
```

---

## Task 2: ControlService.prompt — emit status + wire tool/thought callbacks + cancelled

**Files:**
- Modify: `src/control/control-service.ts:211-266` (the `prompt` method)
- Test: `tests/unit/control/control-service-prompt-status.test.ts` (create)

Context: `prompt` currently passes only a `reply` sink to `agent.chat` and emits `turn-output`/`turn-finished`. `ChatRequest` already accepts `onToolEvent`/`onThought` (`src/weixin/agent/interface.ts`). The in-flight `AbortController` is aborted by `cancelTurn`; in the catch we read `controller.signal.aborted` to flag a cancel.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/control/control-service-prompt-status.test.ts`:

```ts
import { expect, test } from "bun:test";
import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

function makeDeps(chat: (req: any) => Promise<{ text?: string }>) {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((e) => seen.push(e));
  const deps = {
    agent: { chat },
    sessions: {
      listAllResolvedSessions: () => [],
      removeSession: async () => ({ wasActive: false }),
      useSession: async () => ({ alias: "backend", agent: "claude", workspace: "/ws" }),
      resolveAliasForChat: async (_c: string, a: string) => a,
    },
    createSessionWithTransport: async () => ({}),
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: { listPending: () => [], createTask: async () => ({}), cancelPending: async () => false },
    orchestration: { listTasks: async () => [], getTask: async () => null, requestTaskCancellation: async () => ({}) },
    agents: { list: () => [], catalog: () => [], create: async () => ({}), remove: async () => {} },
    workspaces: { list: () => [], create: async () => ({}), remove: async () => {} },
    events,
  };
  return { deps, seen };
}

test("prompt emits turn-started and forwards tool/thought events", async () => {
  const { deps, seen } = makeDeps(async (req) => {
    await req.onToolEvent?.({ toolCallId: "t1", toolName: "Read", kind: "read", status: "success" });
    await req.onThought?.("thinking…");
    await req.reply("hello");
    return { text: "" };
  });
  const control = new ControlService(deps as never);
  await control.prompt({ chatKey: "relay:a", sessionAlias: "backend", text: "hi", senderId: "s" });

  const types = seen.map((e) => e.type);
  expect(types[0]).toBe("turn-started");
  expect(types).toContain("tool-event");
  expect(types).toContain("turn-thought");
  expect(types.at(-1)).toBe("turn-finished");
  const tool = seen.find((e) => e.type === "tool-event") as Extract<ControlEvent, { type: "tool-event" }>;
  expect(tool.event.toolCallId).toBe("t1");
});

test("an aborted turn finishes with cancelled:true", async () => {
  const { deps, seen } = makeDeps(async (req) => {
    const err = new Error("aborted");
    req.abortSignal?.dispatchEvent?.(new Event("abort"));
    throw err;
  });
  const control = new ControlService(deps as never);
  const p = control.prompt({ chatKey: "relay:a", sessionAlias: "backend", text: "hi", senderId: "s" });
  control.cancelTurn("relay:a", "backend"); // aborts the in-flight controller
  await p;
  const fin = seen.find((e) => e.type === "turn-finished") as Extract<ControlEvent, { type: "turn-finished" }>;
  expect(fin.cancelled).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/control/control-service-prompt-status.test.ts`
Expected: FAIL (no `turn-started` emitted; `tool-event`/`turn-thought` absent; `cancelled` undefined).

- [ ] **Step 3: Implement**

In `src/control/control-service.ts`, inside `prompt`, after `this.inFlight.set(key, controller);` and the `useSession` try/catch, add the `turn-started` emit just before the `emitChunk` definition:

```ts
    this.deps.events.emit({
      type: "turn-started",
      chatKey: input.chatKey,
      sessionAlias: input.sessionAlias,
    });
```

In the `agent.chat({ ... })` call, add the two callbacks alongside `reply`:

```ts
        reply: async (chunk) => {
          emitChunk(chunk);
        },
        onToolEvent: (event) => {
          this.deps.events.emit({
            type: "tool-event",
            chatKey: input.chatKey,
            sessionAlias: input.sessionAlias,
            event,
          });
        },
        onThought: (chunk) => {
          this.deps.events.emit({
            type: "turn-thought",
            chatKey: input.chatKey,
            sessionAlias: input.sessionAlias,
            chunk,
          });
        },
```

In the `catch (error)` block, replace the `turn-finished` emit to carry `cancelled`:

```ts
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.deps.events.emit({
        type: "turn-finished",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        ok: false,
        errorMessage,
        ...(controller.signal.aborted ? { cancelled: true } : {}),
      });
      return { ok: false, errorMessage };
    } finally {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/control/control-service-prompt-status.test.ts`
Expected: PASS.

Also run the existing prompt/session tests to confirm no regression:
Run: `node ./scripts/run-tests.mjs tests/unit/control/control-service-sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control/control-service.ts tests/unit/control/control-service-prompt-status.test.ts
git commit -m "feat(control): emit turn-started, forward tool/thought events, flag cancelled turns"
```

---

## Task 3: Protocol DTOs — ToolStepDto, ToolDetailDto, new event variants

**Files:**
- Modify: `packages/relay-protocol/src/dtos.ts`
- Test: `tests/unit/packages/relay-protocol/tool-step-dto.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/packages/relay-protocol/tool-step-dto.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { ControlEventDto, ToolStepDto } from "../../../../packages/relay-protocol/src/dtos";

test("ToolStepDto and the new ControlEventDto variants are assignable", () => {
  const step: ToolStepDto = {
    toolCallId: "t1",
    toolName: "Edit",
    kind: "edit",
    status: "success",
    title: "src/x.ts",
    detail: { type: "diff", path: "src/x.ts", oldText: "a", newText: "b" },
  };
  const events: ControlEventDto[] = [
    { type: "turn-started", chatKey: "c", sessionAlias: "s" },
    { type: "tool-event", chatKey: "c", sessionAlias: "s", step },
    { type: "turn-thought", chatKey: "c", sessionAlias: "s", chunk: "x" },
    { type: "turn-finished", chatKey: "c", sessionAlias: "s", ok: false, cancelled: true },
  ];
  expect(events.length).toBe(4);
  expect(step.detail?.type).toBe("diff");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay-protocol/tool-step-dto.test.ts`
Expected: FAIL (types not exported).

- [ ] **Step 3: Implement**

In `packages/relay-protocol/src/dtos.ts`, add before the `ControlEventDto` block:

```ts
export type ToolStepStatus = "running" | "success" | "error";
export type ToolStepKind = "read" | "search" | "execute" | "edit" | "think" | "other";

/** Friendly, presentation-ready detail for one tool call (no raw JSON crosses the wire). */
export type ToolDetailDto =
  | { type: "diff"; path: string; oldText: string; newText: string }
  | { type: "read"; path: string; lines?: string; preview?: string }
  | { type: "command"; command: string; output?: string; exitCode?: number }
  | { type: "search"; query: string; output?: string }
  | { type: "text"; text: string }
  | { type: "fields"; fields: Array<{ label: string; value: string }>; output?: string };

/** One collapsed tool-call step, normalized at the connector from a core ToolUseEvent. */
export interface ToolStepDto {
  toolCallId: string;
  toolName: string;
  kind: ToolStepKind;
  status: ToolStepStatus;
  title: string;
  durationMs?: number;
  detail?: ToolDetailDto;
}
```

Replace the `ControlEventDto` union with:

```ts
/** Wire mirror of src/control ControlEvent (tool-event carries the NORMALIZED step). */
export type ControlEventDto =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-started"; chatKey: string; sessionAlias: string }
  | { type: "tool-event"; chatKey: string; sessionAlias: string; step: ToolStepDto }
  | { type: "turn-thought"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string; cancelled?: boolean }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };
```

Verify `ToolStepDto`/`ToolDetailDto` are re-exported from the package index. Check `packages/relay-protocol/src/index.ts`: if it uses `export * from "./dtos.js"` no change is needed; if it names exports explicitly, add `ToolStepDto, ToolDetailDto, ToolStepKind, ToolStepStatus` to the `dtos` export list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay-protocol/tool-step-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src/dtos.ts tests/unit/packages/relay-protocol/tool-step-dto.test.ts
git commit -m "feat(relay-protocol): add ToolStepDto/ToolDetailDto and turn-status event variants"
```

(If `index.ts` was edited, include it in the `git add`.)

---

## Task 4: Protocol web-dtos — validators + MessageRecordDto.structured

**Files:**
- Modify: `packages/relay-protocol/src/web-dtos.ts`
- Test: `tests/unit/packages/relay-protocol/web-dtos.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/packages/relay-protocol/web-dtos.test.ts`:

```ts
import { parseWebServerEvent, webEventEnvelope } from "../../../../packages/relay-protocol/src/web-dtos";

function roundtrip(event: any) {
  return parseWebServerEvent(webEventEnvelope(event));
}

test("accepts the new turn-status control events", () => {
  expect(roundtrip({ kind: "control-event", instanceId: "i1", event: { type: "turn-started", chatKey: "c", sessionAlias: "s" } })).not.toBeNull();
  expect(roundtrip({ kind: "control-event", instanceId: "i1", event: { type: "turn-thought", chatKey: "c", sessionAlias: "s", chunk: "x" } })).not.toBeNull();
  expect(roundtrip({
    kind: "control-event", instanceId: "i1",
    event: { type: "tool-event", chatKey: "c", sessionAlias: "s", step: { toolCallId: "t1", toolName: "Read", kind: "read", status: "running", title: "x" } },
  })).not.toBeNull();
});

test("rejects a malformed tool-event step", () => {
  expect(roundtrip({ kind: "control-event", instanceId: "i1", event: { type: "tool-event", chatKey: "c", sessionAlias: "s", step: { toolCallId: "t1" } } })).toBeNull();
});

test("rejects a tool-event step with an unknown detail tag", () => {
  expect(roundtrip({
    kind: "control-event", instanceId: "i1",
    event: { type: "tool-event", chatKey: "c", sessionAlias: "s", step: { toolCallId: "t1", toolName: "R", kind: "read", status: "running", title: "x", detail: { type: "bogus" } } },
  })).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay-protocol/web-dtos.test.ts`
Expected: FAIL (new types rejected by `CONTROL_EVENT_TYPES`).

- [ ] **Step 3: Implement**

In `packages/relay-protocol/src/web-dtos.ts`:

Add the import at the top (after the existing imports):

```ts
import type { ToolStepDto } from "./dtos.js";
```

Extend `MessageRecordDto`:

```ts
export interface MessageRecordDto {
  instanceId: string;
  sessionAlias: string;
  direction: MessageDirection;
  text: string;
  createdAt: string;
  /** Present on completed `out` turns: persisted tool steps + reasoning. */
  structured?: { toolSteps: ToolStepDto[]; reasoning?: string };
}
```

Extend `CONTROL_EVENT_TYPES`:

```ts
const CONTROL_EVENT_TYPES = new Set([
  "turn-output",
  "turn-started",
  "tool-event",
  "turn-thought",
  "turn-finished",
  "sessions-changed",
  "scheduled-changed",
  "orchestration-changed",
]);
```

Add a tool-step validator above `validControlEvent`:

```ts
const TOOL_STEP_KINDS = new Set(["read", "search", "execute", "edit", "think", "other"]);
const TOOL_STEP_STATUSES = new Set(["running", "success", "error"]);
const TOOL_DETAIL_TYPES = new Set(["diff", "read", "command", "search", "text", "fields"]);

function validToolStep(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const c = s as Record<string, unknown>;
  if (typeof c.toolCallId !== "string" || typeof c.toolName !== "string" || typeof c.title !== "string") return false;
  if (typeof c.kind !== "string" || !TOOL_STEP_KINDS.has(c.kind)) return false;
  if (typeof c.status !== "string" || !TOOL_STEP_STATUSES.has(c.status)) return false;
  if (c.detail !== undefined) {
    if (typeof c.detail !== "object" || c.detail === null) return false;
    const d = c.detail as Record<string, unknown>;
    if (typeof d.type !== "string" || !TOOL_DETAIL_TYPES.has(d.type)) return false;
  }
  return true;
}
```

Extend `validControlEvent` — add these branches before the final `return true;`:

```ts
  if (c.type === "turn-started")
    return typeof c.chatKey === "string" && typeof c.sessionAlias === "string";
  if (c.type === "turn-thought")
    return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && typeof c.chunk === "string";
  if (c.type === "tool-event")
    return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && validToolStep(c.step);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay-protocol/web-dtos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src/web-dtos.ts tests/unit/packages/relay-protocol/web-dtos.test.ts
git commit -m "feat(relay-protocol): validate turn-status events and add MessageRecordDto.structured"
```

---

## Task 5: Connector — tool-presentation normalizer

**Files:**
- Create: `packages/channel-relay/src/tool-presentation.ts`
- Test: `tests/unit/packages/channel-relay/tool-presentation.test.ts` (create)

Context (ground truth): `rawInput`/`content`/`rawOutput`/`locations` are forwarded verbatim and untyped. Edit payloads live in a `content` `diff` block `{type:"diff", path, oldText, newText}`. Two input dialects exist: structural (`command`, `file_path`, `pattern`, `description`, `subagent_type`) and Codex `parsed_cmd: [{type, cmd, name}]`. `content` may be a single block OR an array. `locations` items use `path ?? file`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/packages/channel-relay/tool-presentation.test.ts`:

```ts
import { expect, test } from "bun:test";
import { toolUseEventToStepDto } from "../../../../packages/channel-relay/src/tool-presentation";

test("edit reads the content diff block", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t1", toolName: "Edit", kind: "edit", status: "success", durationMs: 400,
    content: [{ type: "diff", path: "src/parser.ts", oldText: "const x = 1", newText: "const x = 2" }],
  });
  expect(step).toMatchObject({
    toolCallId: "t1", kind: "edit", status: "success", durationMs: 400, title: "src/parser.ts",
    detail: { type: "diff", path: "src/parser.ts", oldText: "const x = 1", newText: "const x = 2" },
  });
});

test("execute reads command + stdout + exit code", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t2", toolName: "Bash", kind: "execute", status: "success",
    rawInput: { command: "npm test", description: "run tests" },
    rawOutput: { stdout: "12 passed", exitCode: 0 },
  });
  expect(step.title).toBe("npm test");
  expect(step.detail).toEqual({ type: "command", command: "npm test", output: "12 passed", exitCode: 0 });
});

test("read derives path from file_path and a content array preview", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t3", toolName: "Read", kind: "read", status: "success",
    rawInput: { file_path: "src/a.ts" },
    content: { type: "text", text: "file contents" },
  });
  expect(step.title).toBe("src/a.ts");
  expect(step.detail).toMatchObject({ type: "read", path: "src/a.ts", preview: "file contents" });
});

test("search uses Codex parsed_cmd for the query", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t4", toolName: "Search", kind: "search", status: "success",
    rawInput: { parsed_cmd: [{ type: "search", cmd: "rg -n session src", name: "src" }] },
  });
  expect(step.detail).toMatchObject({ type: "search", query: "rg -n session src" });
});

test("unknown tool falls back to primitive fields only (no nested JSON)", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t5", toolName: "Mystery", kind: "other", status: "running",
    rawInput: { name: "thing", count: 3, nested: { a: 1 }, arr: [1, 2] },
  });
  expect(step.detail).toMatchObject({ type: "fields" });
  const fields = (step.detail as { type: "fields"; fields: Array<{ label: string; value: string }> }).fields;
  expect(fields).toEqual([{ label: "name", value: "thing" }, { label: "count", value: "3" }]);
});

test("caps long output with a truncated marker", () => {
  const big = "x".repeat(9000);
  const step = toolUseEventToStepDto({
    toolCallId: "t6", toolName: "Bash", kind: "execute", status: "success",
    rawInput: { command: "cat big" }, rawOutput: { stdout: big },
  });
  const out = (step.detail as { output: string }).output;
  expect(out.length).toBeLessThan(9000);
  expect(out.endsWith("…(truncated)")).toBe(true);
});

test("think uses description as prose text", () => {
  const step = toolUseEventToStepDto({
    toolCallId: "t7", toolName: "Task", kind: "think", status: "success",
    rawInput: { description: "Explore code", subagent_type: "Explore" },
  });
  expect(step.detail).toEqual({ type: "text", text: "Explore code" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/channel-relay/tool-presentation.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement**

Create `packages/channel-relay/src/tool-presentation.ts`:

```ts
import type { ToolUseEvent } from "xacpx/plugin-api";
import type { ToolStepDto, ToolDetailDto } from "@ganglion/xacpx-relay-protocol";

const TEXT_CAP = 8000;
const DIFF_CAP = 4000;

function cap(s: string, n = TEXT_CAP): string {
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}
function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function blocksOf(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter((b) => b && typeof b === "object") as Record<string, unknown>[];
  if (content && typeof content === "object") return [content as Record<string, unknown>];
  return [];
}
function textFromBlocks(blocks: Record<string, unknown>[]): string | undefined {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "content") {
      const t = asString(rec(b.content).text);
      if (t) parts.push(t);
    } else if (b.type === "text") {
      const t = asString(b.text);
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}
function diffBlock(blocks: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return blocks.find((b) => b.type === "diff");
}
function parsedCmd0(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const pc = input.parsed_cmd;
  if (Array.isArray(pc) && pc[0] && typeof pc[0] === "object") return pc[0] as Record<string, unknown>;
  return undefined;
}
function locationPath(event: ToolUseEvent): string | undefined {
  const locs = event.locations;
  if (Array.isArray(locs) && locs[0] && typeof locs[0] === "object") {
    const l = locs[0] as Record<string, unknown>;
    return asString(l.path) ?? asString(l.file);
  }
  return undefined;
}
function readLines(input: Record<string, unknown>): string | undefined {
  const { offset, limit } = input;
  if (typeof offset === "number" && typeof limit === "number") return `${offset}–${offset + limit}`;
  if (typeof limit === "number") return `first ${limit}`;
  return undefined;
}
function primitiveFields(input: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [label, v] of Object.entries(input)) {
    const value = asString(v);
    if (value !== undefined) out.push({ label, value: cap(value) });
  }
  return out;
}

/** Normalize a raw core ToolUseEvent into a friendly, capped, presentation-ready step. */
export function toolUseEventToStepDto(event: ToolUseEvent): ToolStepDto {
  const input = rec(event.rawInput);
  const blocks = blocksOf(event.content);
  const output = rec(event.rawOutput);
  const pc = parsedCmd0(input);
  const fallbackTitle = event.summary ?? event.toolName;
  const base: Omit<ToolStepDto, "title" | "detail"> = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    kind: event.kind,
    status: event.status,
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
  };

  if (event.kind === "edit") {
    const diff = diffBlock(blocks);
    if (diff) {
      const path = asString(diff.path) ?? locationPath(event) ?? asString(input.file_path) ?? asString(input.path) ?? fallbackTitle;
      const detail: ToolDetailDto = { type: "diff", path, oldText: cap(asString(diff.oldText) ?? "", DIFF_CAP), newText: cap(asString(diff.newText) ?? "", DIFF_CAP) };
      return { ...base, title: path, detail };
    }
    const path = locationPath(event) ?? asString(input.file_path) ?? asString(input.path) ?? fallbackTitle;
    return { ...base, title: path, detail: { type: "fields", fields: primitiveFields(input) } };
  }

  if (event.kind === "read") {
    const path = asString(input.file_path) ?? asString(input.path) ?? asString(pc?.name) ?? locationPath(event) ?? fallbackTitle;
    const lines = readLines(input);
    const preview = textFromBlocks(blocks) ?? asString(output.text);
    const detail: ToolDetailDto = { type: "read", path, ...(lines ? { lines } : {}), ...(preview ? { preview: cap(preview) } : {}) };
    return { ...base, title: path, detail };
  }

  if (event.kind === "execute") {
    const command = asString(input.command) ?? asString(input.cmd) ?? asString(pc?.cmd) ?? fallbackTitle;
    const out = asString(output.stdout) ?? textFromBlocks(blocks) ?? asString(output.text);
    const exitCode = typeof output.exitCode === "number" ? output.exitCode : undefined;
    const detail: ToolDetailDto = { type: "command", command, ...(out ? { output: cap(out) } : {}), ...(exitCode !== undefined ? { exitCode } : {}) };
    return { ...base, title: command, detail };
  }

  if (event.kind === "search") {
    const query = asString(input.query) ?? asString(input.pattern) ?? asString(input.search) ?? asString(input.command) ?? asString(pc?.cmd) ?? fallbackTitle;
    const out = textFromBlocks(blocks) ?? asString(output.stdout) ?? asString(output.text);
    const detail: ToolDetailDto = { type: "search", query, ...(out ? { output: cap(out) } : {}) };
    return { ...base, title: query, detail };
  }

  if (event.kind === "think") {
    const text = asString(input.description) ?? asString(input.prompt) ?? textFromBlocks(blocks) ?? "";
    return { ...base, title: fallbackTitle, detail: { type: "text", text: cap(text) } };
  }

  const out = textFromBlocks(blocks) ?? asString(output.stdout) ?? asString(output.text);
  return { ...base, title: fallbackTitle, detail: { type: "fields", fields: primitiveFields(input), ...(out ? { output: cap(out) } : {}) } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/channel-relay/tool-presentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/tool-presentation.ts tests/unit/packages/channel-relay/tool-presentation.test.ts
git commit -m "feat(channel-relay): normalize ToolUseEvent into friendly capped ToolStepDto"
```

---

## Task 6: Connector — map tool-event through the normalizer

**Files:**
- Modify: `packages/channel-relay/src/control-bridge.ts:160-167` (`subscribeControlEvents`)
- Test: `tests/unit/packages/channel-relay/control-bridge.test.ts` (append)

Context: `subscribeControlEvents` forwards each `ControlEvent` verbatim as `{ event }`. We intercept `tool-event` and replace its raw `event` with a normalized `step`; all other variants pass through unchanged. The core `ControlEvent` type and the protocol `ControlEventDto` differ only for `tool-event` (raw vs `step`), so we build the outgoing object explicitly.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/packages/channel-relay/control-bridge.test.ts` (add the import of `subscribeControlEvents` if not already present):

```ts
import { subscribeControlEvents } from "../../../../packages/channel-relay/src/control-bridge";
import { createControlEventBus } from "../../../../src/control/control-event-bus";

test("subscribeControlEvents normalizes tool-event into a step DTO", () => {
  const events = createControlEventBus();
  const sent: Array<{ type: string; payload: any }> = [];
  const control = { events } as never;
  const stop = subscribeControlEvents(control, (type, payload) => sent.push({ type, payload }));

  events.emit({ type: "turn-started", chatKey: "c", sessionAlias: "s" });
  events.emit({
    type: "tool-event", chatKey: "c", sessionAlias: "s",
    event: { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", rawInput: { command: "ls" } },
  });
  stop();

  expect(sent[0].payload.event).toEqual({ type: "turn-started", chatKey: "c", sessionAlias: "s" });
  const tool = sent[1].payload.event;
  expect(tool.type).toBe("tool-event");
  expect(tool.step).toMatchObject({ toolCallId: "t1", kind: "execute", title: "ls", detail: { type: "command", command: "ls" } });
  expect(tool.event).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/channel-relay/control-bridge.test.ts`
Expected: FAIL (`tool.step` undefined; raw `event` still present).

- [ ] **Step 3: Implement**

In `packages/channel-relay/src/control-bridge.ts`, add the import near the top:

```ts
import { toolUseEventToStepDto } from "./tool-presentation";
```

Replace `subscribeControlEvents` with:

```ts
export function subscribeControlEvents(
  control: ControlService,
  sendEvent: (type: string, payload: unknown) => void,
): () => void {
  return control.events.subscribe((event) => {
    if (event.type === "tool-event") {
      sendEvent(MSG.instanceEvent, {
        event: { type: "tool-event", chatKey: event.chatKey, sessionAlias: event.sessionAlias, step: toolUseEventToStepDto(event.event) },
      });
      return;
    }
    sendEvent(MSG.instanceEvent, { event });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/channel-relay/control-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/control-bridge.ts tests/unit/packages/channel-relay/control-bridge.test.ts
git commit -m "feat(channel-relay): forward tool-event as a normalized step over the wire"
```

---

## Task 7: Relay DB — migrate messages with a structured column

**Files:**
- Modify: `packages/relay/src/db.ts:45-91` (`initSchema`)
- Test: `tests/unit/packages/relay/db.test.ts` (append)

Context: `messages` is created via `CREATE TABLE IF NOT EXISTS`. Existing deployments already have the table without `structured`, so `IF NOT EXISTS` won't add the column — we need an idempotent `ALTER TABLE ADD COLUMN` guarded by a column check.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/packages/relay/db.test.ts`:

```ts
test("messages table has a structured column after initSchema", async () => {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const cols = db.all<{ name: string }>("PRAGMA table_info(messages)").map((c) => c.name);
  expect(cols).toContain("structured");
  db.close();
});

test("initSchema adds structured to a pre-existing messages table (migration)", async () => {
  const db = await createSqlDriver(":memory:");
  // Simulate an old deployment: messages table without the structured column.
  db.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT NOT NULL, session_alias TEXT NOT NULL,
    direction TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`);
  initSchema(db);
  const cols = db.all<{ name: string }>("PRAGMA table_info(messages)").map((c) => c.name);
  expect(cols).toContain("structured");
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/db.test.ts`
Expected: FAIL (no `structured` column).

- [ ] **Step 3: Implement**

In `packages/relay/src/db.ts`:

Add `structured TEXT` to the `CREATE TABLE IF NOT EXISTS messages` block (after `created_at TEXT NOT NULL,`):

```ts
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL REFERENCES instances(id),
      session_alias TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      structured TEXT
    );
```

After the `db.exec(\`...\`)` schema block (before the closing brace of `initSchema`), add the idempotent migration for pre-existing tables:

```ts
  // Migration: older deployments have `messages` without `structured`.
  const hasStructured = db
    .all<{ name: string }>("PRAGMA table_info(messages)")
    .some((c) => c.name === "structured");
  if (!hasStructured) {
    db.exec("ALTER TABLE messages ADD COLUMN structured TEXT");
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/db.test.ts`
Expected: PASS (both new tests + existing idempotency test).

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/db.ts tests/unit/packages/relay/db.test.ts
git commit -m "feat(relay): migrate messages table with a structured column"
```

---

## Task 8: Relay MessageStore — persist + project structured

**Files:**
- Modify: `packages/relay/src/stores/messages.ts`
- Test: `tests/unit/packages/relay/stores-messages.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Create/append `tests/unit/packages/relay/stores-messages.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { MessageStore } from "../../../../packages/relay/src/stores/messages";

async function seeded() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  db.run("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)", ["a1", "u", "h", "member", "t"]);
  db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i1", "a1", "pc", "h", "t"]);
  return db;
}

test("append + listBySession round-trips structured data", async () => {
  const db = await seeded();
  const store = new MessageStore(db);
  const structured = { toolSteps: [{ toolCallId: "t1", toolName: "Read", kind: "read", status: "success", title: "a.ts" }], reasoning: "thought" };
  store.append("i1", "backend", "out", "answer", structured as never);
  const rows = store.listBySession("a1", "i1", "backend");
  expect(rows[0]).toMatchObject({ direction: "out", text: "answer" });
  expect(rows[0].structured).toEqual(structured);
  db.close();
});

test("append without structured yields no structured field", async () => {
  const db = await seeded();
  const store = new MessageStore(db);
  store.append("i1", "backend", "in", "hi");
  const rows = store.listBySession("a1", "i1", "backend");
  expect(rows[0].structured).toBeUndefined();
  db.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/stores-messages.test.ts`
Expected: FAIL (`append` has no structured param; `structured` not projected).

- [ ] **Step 3: Implement**

In `packages/relay/src/stores/messages.ts`:

Add `structured` to the row interface and import the type:

```ts
import type { MessageDirection, MessageRecordDto } from "@ganglion/xacpx-relay-protocol";

import type { SqlDriver } from "../db.js";

type StructuredTurn = NonNullable<MessageRecordDto["structured"]>;

interface MessageRow {
  instance_id: string;
  session_alias: string;
  direction: MessageDirection;
  text: string;
  created_at: string;
  structured: string | null;
}
```

Replace `append`:

```ts
  append(instanceId: string, sessionAlias: string, direction: MessageDirection, text: string, structured?: StructuredTurn): void {
    this.db.run(
      "INSERT INTO messages (instance_id, session_alias, direction, text, created_at, structured) VALUES (?,?,?,?,?,?)",
      [instanceId, sessionAlias, direction, text, this.now().toISOString(), structured ? JSON.stringify(structured) : null],
    );
  }
```

Replace the `SELECT` column list and the row→DTO projection in `listBySession`:

```ts
    const rows = this.db.all<MessageRow>(
      `SELECT m.instance_id, m.session_alias, m.direction, m.text, m.created_at, m.structured
       FROM messages m JOIN instances i ON i.id = m.instance_id
       WHERE i.account_id = ? AND m.instance_id = ? AND m.session_alias = ?
       ORDER BY m.id DESC LIMIT ?`,
      [accountId, instanceId, sessionAlias, limit],
    );
    return rows.reverse().map((r) => ({
      instanceId: r.instance_id,
      sessionAlias: r.session_alias,
      direction: r.direction,
      text: r.text,
      createdAt: r.created_at,
      ...(r.structured ? { structured: JSON.parse(r.structured) as StructuredTurn } : {}),
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/stores-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/stores/messages.ts tests/unit/packages/relay/stores-messages.test.ts
git commit -m "feat(relay): persist and project per-turn structured data in MessageStore"
```

---

## Task 9: Relay server — accumulate tool/reasoning + persist on finish

**Files:**
- Modify: `packages/relay/src/server.ts:47-78`
- Test: `tests/unit/packages/relay/runtime-fanout.test.ts` (append)

Context: `turnBuffers: Map<string,string>` only accumulates text. Replace it with an accumulator holding `text`, a `Map<toolCallId, ToolStepDto>` (so repeated tool-events collapse to one row, capped at 200), and a capped `reasoning` string. On `turn-finished`, persist `messages.append(..., "out", text, structured)`. All events still broadcast to web generically.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/packages/relay/runtime-fanout.test.ts`:

```ts
test("accumulates tool steps + reasoning and persists structured on finish", async () => {
  const runtime = await seeded();
  const fire = (event: unknown) => runtime.gateway["deps"].onEvent!("i1", "a1", {
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: { event },
  });

  fire({ type: "turn-started", chatKey: "relay:a1", sessionAlias: "backend" });
  fire({ type: "tool-event", chatKey: "relay:a1", sessionAlias: "backend", step: { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "running", title: "ls" } });
  fire({ type: "tool-event", chatKey: "relay:a1", sessionAlias: "backend", step: { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "ls", durationMs: 5 } });
  fire({ type: "turn-thought", chatKey: "relay:a1", sessionAlias: "backend", chunk: "think " });
  fire({ type: "turn-thought", chatKey: "relay:a1", sessionAlias: "backend", chunk: "more" });
  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "done" });
  fire({ type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true });

  const cached = runtime.messages.listBySession("a1", "i1", "backend");
  expect(cached.length).toBe(1);
  expect(cached[0].text).toBe("done");
  expect(cached[0].structured?.reasoning).toBe("think more");
  expect(cached[0].structured?.toolSteps).toEqual([{ toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "ls", durationMs: 5 }]);
  runtime.close();
});

test("a finish with no text but with tool steps still persists a structured turn", async () => {
  const runtime = await seeded();
  const fire = (event: unknown) => runtime.gateway["deps"].onEvent!("i1", "a1", {
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: { event },
  });
  fire({ type: "turn-started", chatKey: "relay:a1", sessionAlias: "backend" });
  fire({ type: "tool-event", chatKey: "relay:a1", sessionAlias: "backend", step: { toolCallId: "t1", toolName: "Read", kind: "read", status: "success", title: "a.ts" } });
  fire({ type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true });
  const cached = runtime.messages.listBySession("a1", "i1", "backend");
  expect(cached.length).toBe(1);
  expect(cached[0].structured?.toolSteps.length).toBe(1);
  runtime.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/runtime-fanout.test.ts`
Expected: FAIL (tool/thought events not accumulated; structured not persisted; no-text turn persists nothing).

- [ ] **Step 3: Implement**

In `packages/relay/src/server.ts`:

Add to the protocol import on line 6-8 the `ToolStepDto` type:

```ts
import {
  MSG, type ControlEventDto, type InstanceEventPayload, type InstanceNoticePayload, type RelayEnvelope, type ToolStepDto,
} from "@ganglion/xacpx-relay-protocol";
```

Add a cap constant near `MAX_MESSAGES_PER_SESSION`:

```ts
const MAX_TOOL_STEPS = 200;
const REASONING_CAP = 16000;
```

Replace the `turnBuffers` declaration and the `onStatusChange`/`onEvent` bodies:

```ts
  // Accumulate streaming turn state per (instance, session); flush to history on finish.
  interface TurnAccumulator { text: string; steps: Map<string, ToolStepDto>; reasoning: string }
  const turnBuffers = new Map<string, TurnAccumulator>();
  const key = (instanceId: string, alias: string) => `${instanceId}\0${alias}`;
  const acc = (k: string): TurnAccumulator => {
    let a = turnBuffers.get(k);
    if (!a) { a = { text: "", steps: new Map(), reasoning: "" }; turnBuffers.set(k, a); }
    return a;
  };

  const gateway = new InstanceGateway({
    instances,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    onStatusChange: (instanceId, accountId, online) => {
      if (!online) {
        const prefix = `${instanceId}\0`;
        for (const k of turnBuffers.keys()) if (k.startsWith(prefix)) turnBuffers.delete(k);
      }
      webGateway.broadcast(accountId, { kind: "instance-status", instanceId, online });
    },
    onEvent: (instanceId, accountId, envelope: RelayEnvelope) => {
      if (envelope.type === MSG.instanceEvent) {
        const event = (envelope.payload as InstanceEventPayload).event as ControlEventDto;
        webGateway.broadcast(accountId, { kind: "control-event", instanceId, event });
        if (event.type === "turn-started") {
          turnBuffers.set(key(instanceId, event.sessionAlias), { text: "", steps: new Map(), reasoning: "" });
        } else if (event.type === "turn-output") {
          acc(key(instanceId, event.sessionAlias)).text += event.chunk;
        } else if (event.type === "tool-event") {
          const a = acc(key(instanceId, event.sessionAlias));
          if (a.steps.has(event.step.toolCallId) || a.steps.size < MAX_TOOL_STEPS) {
            a.steps.set(event.step.toolCallId, event.step);
          }
        } else if (event.type === "turn-thought") {
          const a = acc(key(instanceId, event.sessionAlias));
          a.reasoning = (a.reasoning + event.chunk).slice(0, REASONING_CAP);
        } else if (event.type === "turn-finished") {
          const k = key(instanceId, event.sessionAlias);
          const a = turnBuffers.get(k);
          turnBuffers.delete(k);
          if (!a) return;
          const steps = [...a.steps.values()];
          const hasStructured = steps.length > 0 || a.reasoning.length > 0;
          if (a.text || hasStructured) {
            const structured = hasStructured
              ? { toolSteps: steps, ...(a.reasoning ? { reasoning: a.reasoning } : {}) }
              : undefined;
            messages.append(instanceId, event.sessionAlias, "out", a.text, structured);
          }
        }
      } else if (envelope.type === MSG.instanceNotice) {
        webGateway.broadcast(accountId, { kind: "notice", instanceId, notice: envelope.payload as InstanceNoticePayload });
      }
    },
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay/runtime-fanout.test.ts`
Expected: PASS (new tests + the pre-existing `turn-output`/offline tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/server.ts tests/unit/packages/relay/runtime-fanout.test.ts
git commit -m "feat(relay): accumulate tool steps + reasoning and persist structured turns"
```

---

## Task 10: relay-web chat store — LiveTurn model + new-variant handling

**Files:**
- Modify: `packages/relay-web/src/stores/chat.ts`
- Test: `packages/relay-web/src/__tests__/chat.test.ts` (append + adjust)

Context: today `streamBuffers: Record<string,string>` holds only text and `streaming` is a string. We introduce a per-(instance,session) `LiveTurn` object. To avoid breaking the existing `MessageList`/`ChatPane` contracts in this task, keep `streaming` (computed text of the selected session's live turn) AND expose new getters `liveTurn` (selected session's full object or null) and `busy` (selected session has a non-terminal live turn). `applyEvent` populates the live turn from all variants and flushes a `ChatMessage` (with `structured` + terminal `status`) on finish.

- [ ] **Step 1: Write the failing test**

Append to `packages/relay-web/src/__tests__/chat.test.ts`:

```ts
test("live turn accumulates tool steps, reasoning, and flushes structured on finish", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-started", chatKey: "c", sessionAlias: "backend" } } as never);
  expect(store.busy).toBe(true);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "tool-event", chatKey: "c", sessionAlias: "backend", step: { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "running", title: "ls" } } } as never);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "tool-event", chatKey: "c", sessionAlias: "backend", step: { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "ls" } } } as never);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-thought", chatKey: "c", sessionAlias: "backend", chunk: "reasoning" } } as never);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "c", sessionAlias: "backend", chunk: "answer" } } as never);
  expect(store.liveTurn?.toolSteps.length).toBe(1);
  expect(store.liveTurn?.reasoning).toBe("reasoning");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-finished", chatKey: "c", sessionAlias: "backend", ok: true } } as never);
  expect(store.busy).toBe(false);
  expect(store.liveTurn).toBeNull();
  const last = store.messages.at(-1)!;
  expect(last).toMatchObject({ direction: "out", text: "answer", status: "done" });
  expect(last.structured?.toolSteps.length).toBe(1);
  expect(last.structured?.reasoning).toBe("reasoning");
});

test("a cancelled finish marks the turn stopped, not errored", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-started", chatKey: "c", sessionAlias: "backend" } } as never);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "c", sessionAlias: "backend", chunk: "partial" } } as never);
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-finished", chatKey: "c", sessionAlias: "backend", ok: false, cancelled: true } } as never);
  expect(store.error).toBe("");
  expect(store.messages.at(-1)).toMatchObject({ status: "cancelled", text: "partial" });
});
```

Also update the existing `"streaming turn output accumulates then commits on finish"` test: it sends a bare `turn-output` then `turn-finished` with no `turn-started`. Keep it working by making `applyEvent` lazily create the live turn on `turn-output` too (no `turn-started` required). No edit to that test is needed if the implementation below lazily creates the accumulator.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd packages/relay-web test -- chat`
Expected: FAIL (`busy`/`liveTurn`/`status`/`structured` undefined).

- [ ] **Step 3: Implement**

Replace `packages/relay-web/src/stores/chat.ts` with:

```ts
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { MessageRecordDto, ToolStepDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api, ApiError } from "../api/client";

export type TurnStatus = "working" | "streaming" | "done" | "cancelled" | "error";

export interface LiveTurn {
  text: string;
  toolSteps: ToolStepDto[];
  reasoning: string;
  status: "working" | "streaming";
  startedAt: number;
}

export interface ChatMessage extends MessageRecordDto {
  failed?: boolean;
  status?: TurnStatus;
}

export const useChatStore = defineStore("chat", () => {
  const instanceId = ref<string | null>(null);
  const sessionAlias = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const liveTurns = ref<Record<string, LiveTurn>>({});
  const bufKey = (instanceId: string, alias: string) => `${instanceId}\0${alias}`;

  const selectedKey = computed(() =>
    instanceId.value && sessionAlias.value ? bufKey(instanceId.value, sessionAlias.value) : null,
  );
  const liveTurn = computed<LiveTurn | null>(() =>
    selectedKey.value ? liveTurns.value[selectedKey.value] ?? null : null,
  );
  const streaming = computed(() => liveTurn.value?.text ?? "");
  const busy = computed(() => liveTurn.value !== null);

  const sending = ref(false);
  const error = ref("");

  function ensureTurn(k: string): LiveTurn {
    let t = liveTurns.value[k];
    if (!t) { t = { text: "", toolSteps: [], reasoning: "", status: "working", startedAt: Date.now() }; liveTurns.value[k] = t; }
    return t;
  }

  function select(id: string, alias: string): void {
    instanceId.value = id;
    sessionAlias.value = alias;
    messages.value = [];
    error.value = "";
  }

  async function loadHistory(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    const { messages: rows } = await api.get<{ messages: MessageRecordDto[] }>(
      `/api/instances/${instanceId.value}/sessions/${sessionAlias.value}/messages`,
    );
    messages.value = rows;
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind === "instance-status" && !event.online) {
      const prefix = `${event.instanceId}\0`;
      for (const k of Object.keys(liveTurns.value)) if (k.startsWith(prefix)) delete liveTurns.value[k];
      return;
    }
    if (event.kind !== "control-event") return;
    const e = event.event;
    if (e.type === "turn-started") {
      ensureTurn(bufKey(event.instanceId, e.sessionAlias));
    } else if (e.type === "turn-output") {
      const t = ensureTurn(bufKey(event.instanceId, e.sessionAlias));
      t.text += e.chunk;
      t.status = "streaming";
    } else if (e.type === "tool-event") {
      const t = ensureTurn(bufKey(event.instanceId, e.sessionAlias));
      const idx = t.toolSteps.findIndex((s) => s.toolCallId === e.step.toolCallId);
      if (idx >= 0) t.toolSteps[idx] = e.step; else t.toolSteps.push(e.step);
    } else if (e.type === "turn-thought") {
      ensureTurn(bufKey(event.instanceId, e.sessionAlias)).reasoning += e.chunk;
    } else if (e.type === "turn-finished") {
      const k = bufKey(event.instanceId, e.sessionAlias);
      const t = liveTurns.value[k];
      delete liveTurns.value[k];
      const selected = event.instanceId === instanceId.value && e.sessionAlias === sessionAlias.value;
      const status: TurnStatus = e.cancelled ? "cancelled" : e.ok ? "done" : "error";
      if (!e.ok && !e.cancelled && selected) error.value = e.errorMessage ?? "turn-failed";
      const hasContent = !!t && (t.text.length > 0 || t.toolSteps.length > 0 || t.reasoning.length > 0);
      if (hasContent && selected) {
        const structured =
          t!.toolSteps.length > 0 || t!.reasoning.length > 0
            ? { toolSteps: t!.toolSteps, ...(t!.reasoning ? { reasoning: t!.reasoning } : {}) }
            : undefined;
        messages.value.push({
          instanceId: event.instanceId,
          sessionAlias: e.sessionAlias,
          direction: "out",
          text: t!.text,
          createdAt: new Date().toISOString(),
          failed: status === "error",
          status,
          ...(structured ? { structured } : {}),
        });
      }
    }
  }

  async function send(text: string): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    error.value = "";
    sending.value = true;
    const optimistic: ChatMessage = { instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "in", text, createdAt: new Date().toISOString() };
    messages.value.push(optimistic);
    try {
      if (text.startsWith("/")) {
        const { output } = await api.rpc<{ output: string }>(instanceId.value, "control.command.execute", { sessionAlias: sessionAlias.value, text });
        messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "out", text: output, createdAt: new Date().toISOString() });
      } else {
        const res = await api.rpc<{ ok?: boolean; errorMessage?: string }>(instanceId.value, "control.prompt", { sessionAlias: sessionAlias.value, text });
        if (res && res.ok === false) {
          error.value = res.errorMessage ?? "prompt-failed";
          optimistic.failed = true;
        }
      }
    } catch (e) {
      const isTimeout = e instanceof ApiError && (e.status === 504 || e.code === "timeout");
      if (text.startsWith("/") || !isTimeout) {
        error.value = e instanceof ApiError ? e.code : "send-failed";
        optimistic.failed = true;
      }
    } finally {
      sending.value = false;
    }
  }

  async function cancel(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    try {
      await api.rpc(instanceId.value, "control.prompt.cancel", { sessionAlias: sessionAlias.value });
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "cancel-failed";
    }
  }

  return { instanceId, sessionAlias, messages, streaming, liveTurn, busy, sending, error, select, loadHistory, applyEvent, send, cancel };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --cwd packages/relay-web test -- chat`
Expected: PASS (new tests + all pre-existing chat tests, including the NUL-key, offline-drop, timeout, and cancel tests).

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/__tests__/chat.test.ts
git commit -m "feat(relay-web): live turn model with tool steps, reasoning, and terminal status"
```

---

## Task 11: relay-web ToolDetail — per-kind presenters

**Files:**
- Create: `packages/relay-web/src/components/ToolDetail.vue`
- Test: `packages/relay-web/src/__tests__/tooldetail.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/tooldetail.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolDetail from "../components/ToolDetail.vue";
import type { ToolDetailDto } from "@ganglion/xacpx-relay-protocol";

function render(detail: ToolDetailDto) {
  return mount(ToolDetail, { props: { detail } });
}

describe("ToolDetail", () => {
  it("renders a diff with added and removed lines", () => {
    const w = render({ type: "diff", path: "src/x.ts", oldText: "const a = 1", newText: "const a = 2" });
    expect(w.find('[data-test="diff-del"]').text()).toContain("const a = 1");
    expect(w.find('[data-test="diff-add"]').text()).toContain("const a = 2");
  });

  it("renders a command with a terminal output block and exit code", () => {
    const w = render({ type: "command", command: "npm test", output: "12 passed", exitCode: 0 });
    expect(w.find('[data-test="cmd-command"]').text()).toContain("npm test");
    expect(w.find('[data-test="cmd-output"]').text()).toContain("12 passed");
    expect(w.text()).toContain("exit 0");
  });

  it("renders a read with path and line range", () => {
    const w = render({ type: "read", path: "src/a.ts", lines: "1–20" });
    expect(w.find('[data-test="read-path"]').text()).toContain("src/a.ts");
    expect(w.text()).toContain("1–20");
  });

  it("renders search query and matches", () => {
    const w = render({ type: "search", query: "rg foo", output: "a.ts:1" });
    expect(w.find('[data-test="search-query"]').text()).toContain("rg foo");
    expect(w.find('[data-test="search-output"]').text()).toContain("a.ts:1");
  });

  it("renders fields as a labeled list, not JSON", () => {
    const w = render({ type: "fields", fields: [{ label: "name", value: "thing" }], output: "ok" });
    expect(w.find('[data-test="field-name"]').text()).toContain("thing");
    expect(w.html()).not.toContain("{");
  });

  it("renders text prose", () => {
    const w = render({ type: "text", text: "exploring the code" });
    expect(w.find('[data-test="tool-text"]').text()).toContain("exploring the code");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd packages/relay-web test -- tooldetail`
Expected: FAIL (component does not exist).

- [ ] **Step 3: Implement**

Create `packages/relay-web/src/components/ToolDetail.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { ToolDetailDto } from "@ganglion/xacpx-relay-protocol";

const props = defineProps<{ detail: ToolDetailDto }>();

// Split a diff body into rendered +/- lines.
const diffLines = computed(() => {
  if (props.detail.type !== "diff") return { del: [] as string[], add: [] as string[] };
  return { del: props.detail.oldText.split("\n"), add: props.detail.newText.split("\n") };
});
</script>

<template>
  <div class="mt-1 space-y-1 text-xs">
    <template v-if="detail.type === 'diff'">
      <div class="font-mono text-slate-500">📄 {{ detail.path }}</div>
      <div class="overflow-x-auto rounded bg-slate-50 p-2 font-mono">
        <div v-for="(l, i) in diffLines.del" :key="'d' + i" data-test="diff-del" class="whitespace-pre text-red-600">- {{ l }}</div>
        <div v-for="(l, i) in diffLines.add" :key="'a' + i" data-test="diff-add" class="whitespace-pre text-green-600">+ {{ l }}</div>
      </div>
    </template>

    <template v-else-if="detail.type === 'command'">
      <div data-test="cmd-command" class="font-mono text-slate-700">$ {{ detail.command }}</div>
      <pre v-if="detail.output" data-test="cmd-output" class="overflow-x-auto rounded bg-slate-900 p-2 font-mono text-slate-100 whitespace-pre-wrap">{{ detail.output }}</pre>
      <div v-if="detail.exitCode !== undefined" class="text-slate-500">exit {{ detail.exitCode }}</div>
    </template>

    <template v-else-if="detail.type === 'read'">
      <div data-test="read-path" class="font-mono text-slate-700">📄 {{ detail.path }}<span v-if="detail.lines" class="ml-2 text-slate-500">{{ detail.lines }}</span></div>
      <pre v-if="detail.preview" class="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-slate-600 whitespace-pre-wrap">{{ detail.preview }}</pre>
    </template>

    <template v-else-if="detail.type === 'search'">
      <div data-test="search-query" class="font-mono text-slate-700">🔍 {{ detail.query }}</div>
      <pre v-if="detail.output" data-test="search-output" class="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-slate-600 whitespace-pre-wrap">{{ detail.output }}</pre>
    </template>

    <template v-else-if="detail.type === 'fields'">
      <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        <template v-for="f in detail.fields" :key="f.label">
          <dt class="text-slate-500">{{ f.label }}</dt>
          <dd :data-test="'field-' + f.label" class="font-mono text-slate-700 break-all">{{ f.value }}</dd>
        </template>
      </dl>
      <pre v-if="detail.output" class="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-slate-600 whitespace-pre-wrap">{{ detail.output }}</pre>
    </template>

    <template v-else-if="detail.type === 'text'">
      <p data-test="tool-text" class="whitespace-pre-wrap text-slate-600">{{ detail.text }}</p>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --cwd packages/relay-web test -- tooldetail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/components/ToolDetail.vue packages/relay-web/src/__tests__/tooldetail.test.ts
git commit -m "feat(relay-web): per-kind friendly tool detail presenters"
```

---

## Task 12: relay-web ToolCallPanel + ReasoningPanel

**Files:**
- Create: `packages/relay-web/src/components/ToolCallPanel.vue`
- Create: `packages/relay-web/src/components/ReasoningPanel.vue`
- Test: `packages/relay-web/src/__tests__/toolcallpanel.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/toolcallpanel.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolCallPanel from "../components/ToolCallPanel.vue";
import ReasoningPanel from "../components/ReasoningPanel.vue";
import type { ToolStepDto } from "@ganglion/xacpx-relay-protocol";

const steps: ToolStepDto[] = [
  { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "npm test", durationMs: 400, detail: { type: "command", command: "npm test", output: "passed" } },
  { toolCallId: "t2", toolName: "Read", kind: "read", status: "running", title: "a.ts" },
];

describe("ToolCallPanel", () => {
  it("shows a count and one row per step", () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    expect(w.find('[data-test="tool-count"]').text()).toContain("2");
    expect(w.findAll('[data-test="tool-row"]').length).toBe(2);
  });

  it("expands a row to show its detail on click", async () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    expect(w.find('[data-test="cmd-output"]').exists()).toBe(false);
    await w.findAll('[data-test="tool-row"]')[0].trigger("click");
    expect(w.find('[data-test="cmd-output"]').text()).toContain("passed");
  });

  it("marks a running step distinctly from a successful one", () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    const rows = w.findAll('[data-test="tool-row"]');
    expect(rows[0].text()).toContain("✅");
    expect(rows[1].text()).toContain("⏳");
  });
});

describe("ReasoningPanel", () => {
  it("renders reasoning text inside a collapsible", () => {
    const w = mount(ReasoningPanel, { props: { reasoning: "step by step" } });
    expect(w.text()).toContain("Reasoning");
    expect(w.find('[data-test="reasoning-body"]').text()).toContain("step by step");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd packages/relay-web test -- toolcallpanel`
Expected: FAIL (components do not exist).

- [ ] **Step 3: Implement**

Create `packages/relay-web/src/components/ToolCallPanel.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import type { ToolStepDto } from "@ganglion/xacpx-relay-protocol";
import ToolDetail from "./ToolDetail.vue";

defineProps<{ steps: ToolStepDto[] }>();

const open = ref(true);
const expanded = ref<Set<string>>(new Set());
function toggleRow(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id);
  expanded.value = new Set(expanded.value);
}

const STATUS_ICON: Record<string, string> = { running: "⏳", success: "✅", error: "❌" };
const KIND_ICON: Record<string, string> = { read: "📖", search: "🔍", execute: "💻", edit: "✏️", think: "🧠", other: "🔧" };
function fmtDuration(ms?: number): string {
  if (ms === undefined) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
</script>

<template>
  <div class="mt-1 rounded border border-slate-200 text-xs">
    <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-left text-slate-600" @click="open = !open">
      <span>{{ open ? "▾" : "▸" }}</span>
      <span>🔧 Tool calls</span>
      <span data-test="tool-count" class="text-slate-400">({{ steps.length }})</span>
    </button>
    <ul v-if="open" class="divide-y divide-slate-100">
      <li v-for="s in steps" :key="s.toolCallId">
        <button type="button" data-test="tool-row" class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-slate-50" @click="toggleRow(s.toolCallId)">
          <span>{{ STATUS_ICON[s.status] }}</span>
          <span>{{ KIND_ICON[s.kind] }}</span>
          <span class="truncate font-mono text-slate-700">{{ s.title }}</span>
          <span v-if="s.durationMs !== undefined" class="ml-auto text-slate-400">{{ fmtDuration(s.durationMs) }}</span>
        </button>
        <div v-if="expanded.has(s.toolCallId) && s.detail" class="px-2 pb-2">
          <ToolDetail :detail="s.detail" />
        </div>
      </li>
    </ul>
  </div>
</template>
```

Create `packages/relay-web/src/components/ReasoningPanel.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
defineProps<{ reasoning: string }>();
const open = ref(false);
</script>

<template>
  <div class="mt-1 rounded border border-slate-200 text-xs">
    <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-left text-slate-600" @click="open = !open">
      <span>{{ open ? "▾" : "▸" }}</span>
      <span>🧠 Reasoning</span>
    </button>
    <p v-if="open" data-test="reasoning-body" class="whitespace-pre-wrap px-2 pb-2 text-slate-600">{{ reasoning }}</p>
  </div>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --cwd packages/relay-web test -- toolcallpanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/components/ToolCallPanel.vue packages/relay-web/src/components/ReasoningPanel.vue packages/relay-web/src/__tests__/toolcallpanel.test.ts
git commit -m "feat(relay-web): collapsible tool-call and reasoning panels"
```

---

## Task 13: relay-web wiring — MessageList panels, ChatPane HUD, PromptInput busy-guard

**Files:**
- Modify: `packages/relay-web/src/components/MessageList.vue`
- Modify: `packages/relay-web/src/components/ChatPane.vue`
- Modify: `packages/relay-web/src/components/PromptInput.vue`
- Test: `packages/relay-web/src/__tests__/messagelist.test.ts` (append), `packages/relay-web/src/__tests__/chatpane.test.ts` (create), `packages/relay-web/src/__tests__/chat.test.ts` (append PromptInput case)

Context: `MessageList` must render persisted `structured` panels under completed `out` messages AND the live tool/reasoning panels above the streaming bubble. `ChatPane` shows the status HUD with an elapsed timer driven by `chat.liveTurn`. `PromptInput` disables while a `busy` prop is true.

- [ ] **Step 1: Write the failing tests**

Append to `packages/relay-web/src/__tests__/messagelist.test.ts`:

```ts
import ToolCallPanel from "../components/ToolCallPanel.vue";

it("renders persisted tool steps under a completed out message", () => {
  const wrapper = mount(MessageList, {
    props: {
      messages: [msg({ direction: "out", text: "done", status: "done", structured: { toolSteps: [{ toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "ls" }] } })],
      streaming: "",
      liveTurn: null,
    },
  });
  expect(wrapper.findComponent(ToolCallPanel).exists()).toBe(true);
});

it("renders a cancelled marker on a stopped message", () => {
  const wrapper = mount(MessageList, {
    props: { messages: [msg({ direction: "out", text: "partial", status: "cancelled" })], streaming: "", liveTurn: null },
  });
  expect(wrapper.find('[data-test="msg-cancelled"]').exists()).toBe(true);
});

it("renders live tool panel above the streaming bubble", () => {
  const wrapper = mount(MessageList, {
    props: {
      messages: [], streaming: "thinking",
      liveTurn: { text: "thinking", toolSteps: [{ toolCallId: "t1", toolName: "R", kind: "read", status: "running", title: "a.ts" }], reasoning: "", status: "streaming", startedAt: 0 },
    },
  });
  expect(wrapper.findComponent(ToolCallPanel).exists()).toBe(true);
});
```

Note: update the existing `MessageList` mounts in that file to pass `liveTurn: null` (the new required prop). The `msg()` helper already spreads partials, so only the `mount` prop objects need `liveTurn: null` added.

Create `packages/relay-web/src/__tests__/chatpane.test.ts`:

```ts
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class extends Error { constructor(public code: string, public status: number) { super(code); } },
  api: { get: vi.fn(), rpc: vi.fn() },
}));

import ChatPane from "../components/ChatPane.vue";
import { useChatStore } from "../stores/chat";

beforeEach(() => setActivePinia(createPinia()));

it("shows a working HUD while a live turn is active", async () => {
  const chat = useChatStore();
  chat.select("i1", "backend");
  chat.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-started", chatKey: "c", sessionAlias: "backend" } } as never);
  const w = mount(ChatPane);
  await w.vm.$nextTick();
  expect(w.find('[data-test="turn-hud"]').exists()).toBe(true);
  expect(w.find('[data-test="turn-hud"]').text()).toContain("Working");
});

it("hides the HUD when no turn is active", () => {
  const chat = useChatStore();
  chat.select("i1", "backend");
  const w = mount(ChatPane);
  expect(w.find('[data-test="turn-hud"]').exists()).toBe(false);
});
```

Append a PromptInput busy case to `packages/relay-web/src/__tests__/chat.test.ts`:

```ts
test("PromptInput disables its textarea when busy", () => {
  const wrapper = mount(PromptInput, { props: { busy: true } });
  expect((wrapper.find("textarea").element as HTMLTextAreaElement).disabled).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run --cwd packages/relay-web test -- messagelist chatpane chat`
Expected: FAIL (new props/markup absent).

- [ ] **Step 3: Implement**

Replace `packages/relay-web/src/components/MessageList.vue`:

```vue
<script setup lang="ts">
import type { ChatMessage, LiveTurn } from "../stores/chat";
import StreamMarkdown from "./StreamMarkdown.vue";
import ToolCallPanel from "./ToolCallPanel.vue";
import ReasoningPanel from "./ReasoningPanel.vue";
defineProps<{ messages: ChatMessage[]; streaming: string; liveTurn: LiveTurn | null }>();
</script>

<template>
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.direction === 'in' ? 'justify-end' : 'justify-start'">
      <pre v-if="m.direction === 'in'" data-test="msg-in"
           class="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
           :class="m.failed ? 'ring-1 ring-red-400' : ''">{{ m.text }}<span v-if="m.failed" data-test="msg-failed" class="ml-2 text-xs text-red-400">failed</span></pre>
      <div v-else data-test="msg-out"
           class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2"
           :class="m.failed ? 'ring-1 ring-red-400' : ''">
        <ToolCallPanel v-if="m.structured?.toolSteps?.length" :steps="m.structured.toolSteps" />
        <ReasoningPanel v-if="m.structured?.reasoning" :reasoning="m.structured.reasoning" />
        <StreamMarkdown :text="m.text" />
        <span v-if="m.status === 'cancelled'" data-test="msg-cancelled" class="text-xs text-amber-600">⏹ Stopped</span>
        <span v-if="m.failed" data-test="msg-failed" class="text-xs text-red-400">failed</span>
      </div>
    </div>
    <div v-if="streaming || liveTurn?.toolSteps.length || liveTurn?.reasoning" class="flex justify-start">
      <div data-test="msg-streaming" class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 opacity-90">
        <ToolCallPanel v-if="liveTurn?.toolSteps.length" :steps="liveTurn.toolSteps" />
        <ReasoningPanel v-if="liveTurn?.reasoning" :reasoning="liveTurn.reasoning" />
        <StreamMarkdown v-if="streaming" :text="streaming" :streaming="true" />
      </div>
    </div>
  </div>
</template>
```

Replace `packages/relay-web/src/components/ChatPane.vue`:

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useChatStore } from "../stores/chat";
import MessageList from "./MessageList.vue";
import PromptInput from "./PromptInput.vue";

const chat = useChatStore();

// Live elapsed clock for the active turn HUD.
const nowMs = ref(Date.now());
const timer = setInterval(() => { nowMs.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(timer));

const elapsed = computed(() => {
  if (!chat.liveTurn) return "";
  const s = Math.max(0, Math.floor((nowMs.value - chat.liveTurn.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});
const runningTools = computed(() => chat.liveTurn?.toolSteps.filter((t) => t.status === "running").length ?? 0);
</script>

<template>
  <div class="flex h-full flex-1 flex-col">
    <div v-if="!chat.sessionAlias" class="flex flex-1 items-center justify-center text-slate-400">
      Select a session
    </div>
    <template v-else>
      <div class="border-b px-4 py-2 text-sm font-medium">{{ chat.sessionAlias }}</div>
      <div v-if="chat.error" data-test="chat-error" class="bg-red-50 px-4 py-1 text-xs text-red-700">
        {{ chat.error }}
        <button class="ml-2 underline" @click="chat.error = ''">dismiss</button>
      </div>
      <MessageList :messages="chat.messages" :streaming="chat.streaming" :live-turn="chat.liveTurn" />
      <div v-if="chat.busy" data-test="turn-hud" class="flex items-center gap-2 px-4 py-1 text-xs text-slate-500">
        <span class="animate-pulse">●</span>
        <span>Working… {{ elapsed }}</span>
        <span v-if="runningTools > 0">· 🔧 {{ runningTools }}</span>
        <button data-test="cancel-turn" class="ml-auto text-red-500 hover:underline" @click="chat.cancel">Cancel</button>
      </div>
      <PromptInput :busy="chat.busy" @send="chat.send" />
    </template>
  </div>
</template>
```

Replace `packages/relay-web/src/components/PromptInput.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const text = ref("");
function submit() {
  if (props.busy) return;
  const value = text.value.trim();
  if (!value) return;
  emit("send", value);
  text.value = "";
}
</script>

<template>
  <form class="border-t p-3" @submit.prevent="submit">
    <textarea v-model="text" rows="2" :disabled="busy"
              class="w-full resize-none rounded border px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
              :placeholder="busy ? 'Agent is working…' : 'Message, or /command'"
              @keydown.enter.exact.prevent="submit" />
  </form>
</template>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run --cwd packages/relay-web test -- messagelist chatpane chat`
Expected: PASS. Then run the full relay-web suite to catch any prop-contract regressions:
Run: `bun run --cwd packages/relay-web test`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/components/MessageList.vue packages/relay-web/src/components/ChatPane.vue packages/relay-web/src/components/PromptInput.vue packages/relay-web/src/__tests__/messagelist.test.ts packages/relay-web/src/__tests__/chatpane.test.ts packages/relay-web/src/__tests__/chat.test.ts
git commit -m "feat(relay-web): turn-status HUD, persisted+live panels, prompt busy-guard"
```

---

## Task 14: Full typecheck, build, and docs

**Files:**
- Modify: `docs/relay-module.md`
- Modify: `docs/relay-web-module.md`

- [ ] **Step 1: Typecheck the whole repo**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Fix any type mismatch surfaced across packages before proceeding.

- [ ] **Step 2: Build relay-web (proves Vue SFCs compile)**

Run: `bun run --cwd packages/relay-web build`
Expected: build succeeds.

- [ ] **Step 3: Update `docs/relay-module.md`**

Add a subsection under the control-event/turn documentation describing:
- the new control events `turn-started`, `tool-event` (carries a normalized `ToolStepDto`, not raw `ToolUseEvent`), `turn-thought`, and the `cancelled?` flag on `turn-finished`;
- connector-side normalization in `packages/channel-relay/src/tool-presentation.ts` with caps (`TEXT_CAP` 8000, `DIFF_CAP` 4000, reasoning 16000, ≤200 steps) so raw payloads never cross the wire;
- relay-server accumulation of `{ text, steps, reasoning }` per turn and persistence into the `messages.structured` JSON column on `turn-finished`;
- the `messages.structured` column + idempotent migration in `db.ts`.

- [ ] **Step 4: Update `docs/relay-web-module.md`**

Add a subsection describing:
- the `LiveTurn` model in `stores/chat.ts` (`text`, `toolSteps`, `reasoning`, `status`, `startedAt`) and the `liveTurn`/`busy` getters;
- `applyEvent` handling of `turn-started`/`tool-event`/`turn-thought` and the `done`/`cancelled`/`error` terminal flush into `ChatMessage.structured`;
- the components `ToolCallPanel`, `ReasoningPanel`, `ToolDetail` (per-kind friendly renderers — diff/command/read/search/text/fields, no raw JSON), the `ChatPane` status HUD with elapsed timer, and the `PromptInput` busy-guard;
- that persisted `structured` is rendered under completed `out` messages on reload.

- [ ] **Step 5: Commit**

```bash
git add docs/relay-module.md docs/relay-web-module.md
git commit -m "docs: document relay-web turn-status display end-to-end"
```

---

## Final verification (after all tasks)

Run the full affected suites and typecheck:

```bash
npx tsc --noEmit
node ./scripts/run-tests.mjs tests/unit/control
node ./scripts/run-tests.mjs tests/unit/packages/relay-protocol
node ./scripts/run-tests.mjs tests/unit/packages/channel-relay
node ./scripts/run-tests.mjs tests/unit/packages/relay
bun run --cwd packages/relay-web test
bun run --cwd packages/relay-web build
```

All must pass. Then use **superpowers:finishing-a-development-branch** to complete the work.
