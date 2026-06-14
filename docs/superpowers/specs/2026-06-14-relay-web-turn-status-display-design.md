# Relay-web Turn-Status Display — Design Spec

**Date:** 2026-06-14
**Status:** Approved (pending implementation plan)

## Goal

Give the relay-web chat the same per-turn status feedback the Feishu channel
has — and richer tool-call detail — so a user watching a remote agent session in
the browser sees, live: that the agent is working, an elapsed timer, the tool
calls it is making (collapsible, expandable to friendly per-tool detail), its
reasoning, and a clear terminal state (done / stopped / error). This state is
**persisted with the turn** so it survives a page reload.

## Background (current state)

- The relay control-event stream carries only `turn-output` (text chunks) and
  `turn-finished`. `ControlService.prompt` (`src/control/control-service.ts`)
  passes only a text `reply` sink to `agent.chat(...)` and **drops** the
  `onToolEvent` / `onThought` callbacks the transport already produces.
- The transport (`src/transport/streaming-prompt.ts`) already builds
  `ToolUseEvent`s and thought chunks for every turn — the same machinery Feishu
  consumes. The capability exists; the control path just doesn't subscribe.
- Message history is **SQLite-backed** (`packages/relay/src/db.ts` `messages`
  table; `packages/relay/src/stores/messages.ts`), one `out` record per turn,
  flushed on `turn-finished` from an in-memory text buffer in
  `packages/relay/src/server.ts`. Loaded on reload via
  `GET /api/instances/:id/sessions/:alias/messages` →
  `chat.loadHistory()`.
- relay-web today shows: a streaming text bubble, an error banner, a per-message
  `failed` badge, and a Cancel button. It has **no** "working" indicator, no
  tool-call/reasoning visibility, no explicit "cancelled" state, and the prompt
  input is not disabled during a turn.

## Approach (chosen)

**Approach A — typed event variants + connector-side normalization.**

1. `ControlService.prompt` subscribes the `onToolEvent`/`onThought` callbacks it
   currently drops and emits new typed events on the control event bus.
2. New events flow through the existing generic connector → relay-server → `/ws`
   pipeline. Tool events are **normalized into a small, presentation-ready DTO at
   the connector** (`packages/channel-relay/src/control-bridge.ts`, which already
   hosts `scheduledTaskToDto`/`orchestrationTaskToDto` mappers) so the
   dialect/diff/cap logic lives in one unit-tested place. The relay-server and
   relay-web stay generic / pure-render.
3. The relay-server accumulates per-turn structured state and persists it
   alongside the turn text. relay-web renders it live and reloads it from
   history.

Rejected alternatives: a single generic `turn-progress` variant (weaker typing,
same work); persist-and-replay only with no live events (defeats the live
progress goal).

## Event model

### Core control event bus (`src/control/control-event-bus.ts`)

Existing variants kept: `turn-output`, `turn-finished`, `sessions-changed`,
`scheduled-changed`, `orchestration-changed`.

New / changed variants:

```ts
// new
{ type: "turn-started";  chatKey: string; sessionAlias: string }
{ type: "tool-event";    chatKey: string; sessionAlias: string; event: ToolUseEvent }
{ type: "turn-thought";  chatKey: string; sessionAlias: string; chunk: string }

// changed: optional cancelled flag (distinct terminal state, not a generic error)
{ type: "turn-finished"; chatKey: string; sessionAlias: string;
  ok: boolean; errorMessage?: string; cancelled?: boolean }
```

- `tool-event` carries the **raw** `ToolUseEvent` (`src/channels/types.ts`) —
  faithful to core; normalization happens downstream at the connector.
- `turn-started` is emitted once, before `agent.chat(...)`.
- `cancelled: true` is set when the turn ends via `control.prompt.cancel`
  (the abort path), so the UI can render "Stopped" rather than an error.

### `ControlService.prompt` wiring (`src/control/control-service.ts`)

- Emit `turn-started` before the `agent.chat(...)` call.
- Pass `onToolEvent: (e) => emit({type:"tool-event", ..., event: e})` and
  `onThought: (chunk) => emit({type:"turn-thought", ..., chunk})` to
  `agent.chat(...)` (currently omitted).
- On the abort path, the resulting `turn-finished` carries `cancelled: true`.
  (Abort detection: the existing `this.inFlight` AbortController; when the turn
  ends because it was cancelled rather than failed, set the flag.)

## Normalization (connector — `packages/channel-relay/src/control-bridge.ts`)

A new unit-tested module `tool-presentation.ts` converts a raw `ToolUseEvent`
into a `ToolStepDto`. The connector's event-forwarding maps `tool-event` through
it; all other events forward verbatim.

### DTOs (`packages/relay-protocol/src/dtos.ts`)

```ts
type ToolStepStatus = "running" | "success" | "error";
type ToolStepKind   = "read" | "search" | "execute" | "edit" | "think" | "other";

interface ToolStepDto {
  toolCallId: string;
  toolName: string;
  kind: ToolStepKind;
  status: ToolStepStatus;
  title: string;          // friendly headline (file path / command / query / summary)
  durationMs?: number;
  detail?: ToolDetailDto;
}

type ToolDetailDto =
  | { type: "diff";    path: string; oldText: string; newText: string }
  | { type: "read";    path: string; lines?: string; preview?: string }
  | { type: "command"; command: string; output?: string; exitCode?: number }
  | { type: "search";  query: string; output?: string }
  | { type: "text";    text: string }
  | { type: "fields";  fields: Array<{ label: string; value: string }>; output?: string };
```

### Normalizer rules (grounded in real fixtures)

Read all fields defensively (`unknown`), normalizing `content` to an array first
(it may arrive as a single block). Helpers: `normalizeContentBlocks(content)`,
`textFromContentBlocks(blocks)` (text/resource/resource_link), `pathFrom(...)`
(`path ?? file`).

- **edit** → find the `content` `diff` block `{type:"diff", path, oldText, newText}`
  → `detail = {type:"diff", path, oldText: oldText ?? "", newText}`.
  `title = diff.path ?? locations[0].path ?? rawInput.file_path`.
- **read** → `path = rawInput.file_path ?? rawInput.path ?? parsed_cmd[0].name
  ?? locations[0].path`; `lines` from `offset`/`limit` if present; `preview` from
  text content/`rawOutput` (capped). `detail = {type:"read", path, lines?, preview?}`.
  `title = path`.
- **execute** → `command = rawInput.command ?? rawInput.cmd ?? parsed_cmd[0].cmd`;
  `output = rawOutput.stdout ?? textFromContentBlocks(content) ?? rawOutput-as-text`;
  `exitCode = rawOutput.exitCode`. `detail = {type:"command", command, output?, exitCode?}`.
  `title = command`.
- **search** → `query = rawInput.query ?? rawInput.pattern ?? rawInput.search
  ?? rawInput.command ?? parsed_cmd[0].cmd`; `output = matches text`.
  `detail = {type:"search", query, output?}`. `title = query`.
- **think / task** → `text = rawInput.description ?? rawInput.prompt ??
  textFromContentBlocks(content)`. `detail = {type:"text", text}`.
  `title = summary ?? toolName`.
- **other / unknown** → `fields` = primitive (`string|number|boolean`) entries of
  `rawInput` only (nested objects/arrays skipped — never stringified to JSON);
  `output = textFromContentBlocks(content) ?? text(rawOutput)`.
  `detail = {type:"fields", fields, output?}`. `title = summary ?? toolName`.

Common: `title` falls back to `summary ?? toolName`; `status`/`kind`/`durationMs`
copied through.

### Caps (applied in the normalizer — DB and browser never see raw blobs)

- `TOOL_TEXT_CAP = 8000` chars per text field (`output`, `preview`, `fields[].value`).
- diff `oldText`/`newText` capped at `4000` each.
- `REASONING_CAP = 16000` chars (accumulated, server-side).
- `MAX_TOOL_STEPS = 200` per turn.
- Truncation appends a `…(truncated)` marker.

## Protocol validators

- `packages/relay-protocol/src/dtos.ts` — add `tool-event`, `turn-started`,
  `turn-thought` to `ControlEventDto`; add `cancelled?` to `turn-finished`;
  add `ToolStepDto` / `ToolDetailDto`.
- `packages/relay-protocol/src/web-dtos.ts` — add the new `type` strings to
  `CONTROL_EVENT_TYPES` and per-variant field checks in `validControlEvent`,
  or the `/ws` consumer drops them. Validate `ToolStepDto` minimally
  (toolCallId/kind/status/title present; `detail.type` is a known tag).
- `MessageRecordDto` gains `structured?: { toolSteps: ToolStepDto[]; reasoning?: string }`.

## Relay server (`packages/relay/src/server.ts`, `stores/messages.ts`, `db.ts`)

- `turnBuffers: Map<string,string>` → `Map<string, TurnAccumulator>` where
  `TurnAccumulator = { text: string; steps: Map<string, ToolStepDto>; reasoning: string }`.
- Event handling per `(instanceId, sessionAlias)` key:
  - `turn-started` → init accumulator.
  - `turn-output` → append `chunk` to `text`.
  - `tool-event` → upsert `step` into `steps` by `toolCallId` (later events with
    the same id replace, so start→update→end collapses to one row; cap at
    `MAX_TOOL_STEPS`).
  - `turn-thought` → append to `reasoning` (cap `REASONING_CAP`). Coalesced.
  - `turn-finished` → build `structured = { toolSteps: [...steps.values()],
    reasoning: reasoning || undefined }`; persist via extended
    `messages.append(instanceId, alias, "out", text, structured)`; clear key.
- All new variants are **broadcast to `/ws` generically** (existing fan-out, no
  change) so the live path works.
- **DB migration:** add nullable `structured TEXT` (JSON) column to `messages`
  (idempotent migration). `MessageStore.append` gains an optional `structured`
  arg (JSON-serialized on write). `MessageStore.listBySession` parses it back
  into `MessageRecordDto.structured`.
- Caps already enforced upstream (connector), so the column stays small;
  `MAX_MESSAGES_PER_SESSION` pruning is unchanged.

## relay-web

### Store (`packages/relay-web/src/stores/chat.ts`)

- Per-session live state: `streamBuffers: Record<string,string>` →
  `liveTurns: Record<string, LiveTurn>` where
  ```ts
  interface LiveTurn {
    text: string;
    toolSteps: ToolStepDto[];     // collapsed by toolCallId
    reasoning: string;
    status: "working" | "streaming" | "done" | "cancelled" | "error";
    startedAt: number;            // Date.now() at turn-started, for elapsed timer
  }
  ```
- `applyEvent` handles new variants:
  - `turn-started` → create `LiveTurn` (status `working`, `startedAt`).
  - `turn-output` → append text, status → `streaming`.
  - `tool-event` → upsert step by `toolCallId`.
  - `turn-thought` → append reasoning.
  - `turn-finished` → flush `LiveTurn` into a `ChatMessage` carrying
    `structured` + terminal status (`cancelled` → cancelled; `!ok` → error;
    else done); delete the live turn.
- `ChatMessage` extends `MessageRecordDto` (already has `failed?`); now also
  surfaces `structured` (from live flush *and* from `loadHistory`, so reloaded
  and just-streamed turns render identically).
- Cancel keeps firing `control.prompt.cancel`; the resulting
  `turn-finished cancelled:true` drives the "Stopped" state. The existing
  non-fatal prompt-RPC-timeout behavior is preserved.

### Components

- **`ToolCallPanel.vue`** — collapsible "🔧 Tool calls (N)". Each row: status
  badge (⏳ running / ✅ success / ❌ error) + kind icon (read 📖, search 🔍,
  execute 💻, edit ✏️, think 🧠, other 🔧) + `title` + duration. Click a row to
  expand its detail.
- **`ToolDetail.vue`** — dispatches on `detail.type` to a presenter:
  - `diff` → red/green line diff of `oldText`→`newText`.
  - `read` → 📄 `path` + line range + optional preview (monospace).
  - `command` → `$ command` + terminal-style `output` block + exit code.
  - `search` → query + match lines.
  - `text` → rendered prose.
  - `fields` → labeled key→value list + optional output block.
  - No raw JSON anywhere.
- **`ReasoningPanel.vue`** — collapsible "🧠 Reasoning"; renders accumulated
  reasoning prose.
- **Status HUD** (in `ChatPane.vue`, above the streaming bubble) — `● Working… m:ss`
  with a live elapsed timer (browser interval off `startedAt`) + running-tool
  count; terminal states render done / `⏹ Stopped` / error (error keeps the
  existing banner + per-message `failed` badge).
- **`PromptInput.vue`** — disabled while the selected session has an active
  (`working`/`streaming`) live turn (busy-guard).
- `MessageList.vue` renders persisted `structured` (tool panel + reasoning panel,
  collapsed) under completed `out` messages.

## Error / cancel / volume handling

- Cancel → `control.prompt.cancel` → `turn-finished cancelled:true` → "Stopped".
- Field caps enforced at the connector (source of truth); DB cannot bloat.
- Thought chunks coalesced server-side (accumulator) and capped.
- Unknown/malformed control events ignored gracefully; validator rejects
  malformed variants. Defensive reads throughout the normalizer.

## Testing

- **Core** (`tests/unit/control/...`): bus carries new variants; `prompt`
  emits `turn-started`, wires `onToolEvent`/`onThought`, sets `cancelled` on the
  abort path.
- **Connector** (`tests/unit/packages/channel-relay/...`): `tool-presentation`
  normalizer for each kind using the real fixtures (edit-diff from content,
  execute command+output, read path, search query, Codex `parsed_cmd`, unknown →
  fields-with-primitives-only); cap enforcement; single-block vs array `content`.
- **Protocol** (`tests/unit/packages/relay-protocol/...`): validator accepts new
  variants and `ToolStepDto`/`detail` tags; rejects malformed.
- **Relay server** (`tests/unit/packages/relay/...`): accumulator collapses tool
  steps by id, caps, persists `structured`; DB migration adds the column
  idempotently; `listBySession` projects `structured` back.
- **relay-web** (Vitest + @vue/test-utils): `applyEvent` for each variant;
  `ToolCallPanel` expand/collapse; each `ToolDetail` presenter renders without
  JSON; `ReasoningPanel`; elapsed timer; cancelled/error terminal states;
  `PromptInput` busy-guard; `loadHistory` renders persisted `structured`.

## Scope / decomposition

One cohesive vertical feature spanning core → protocol → connector →
relay-server (incl. a DB migration) → relay-web. Kept as a single spec/plan with
task groups in that order. Out of scope: changing the Feishu renderer; any
non-relay channel; auth/permission UI.

## Docs to update

- `docs/relay-module.md` — new control-event variants, connector normalization,
  server accumulation + `structured` persistence/migration.
- `docs/relay-web-module.md` — live turn model, tool/reasoning panels, status
  HUD, busy-guard.
