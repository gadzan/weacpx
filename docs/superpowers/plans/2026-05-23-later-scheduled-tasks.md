# `/later` Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/later` and `/lt` one-shot scheduled tasks that dispatch a normal prompt to the session that was current when the task was created.

**Architecture:** Store scheduled tasks in `AppState.scheduled_tasks`, manage them through a focused scheduled-task service, and expose chat commands through a small `/later` command handler. A runtime scheduler scans pending tasks every few seconds, sends the trigger notice through the existing channel route, then runs the scheduled prompt through the same channel/router path used by normal prompts so Weixin quota/final-message behavior remains centralized.

**Tech Stack:** TypeScript, Bun test runner, existing `CommandRouter`, `SessionService`, channel runtime interfaces, `StateStore`, `QuotaManager`.

---

## File Structure

Create:

- `src/scheduled/scheduled-types.ts` — task record/status types and constants.
- `src/scheduled/parse-later-time.ts` — deterministic whitelist parser for `/later <time> <message>`.
- `src/scheduled/scheduled-render.ts` — help, list, create/cancel/error renderers.
- `src/scheduled/scheduled-service.ts` — create/list/cancel/claim/mark state transitions.
- `src/scheduled/scheduled-scheduler.ts` — runtime loop that scans due tasks and dispatches them.
- `src/commands/handlers/later-handler.ts` — command handler glue between router, sessions, and scheduled service.
- `tests/unit/scheduled/parse-later-time.test.ts`
- `tests/unit/scheduled/scheduled-service.test.ts`
- `tests/unit/scheduled/scheduled-render.test.ts`
- `tests/unit/scheduled/scheduled-scheduler.test.ts`

Modify:

- `src/state/types.ts` — add `scheduled_tasks` to app state.
- `src/state/state-store.ts` — parse and validate persisted scheduled tasks.
- `src/commands/parse-command.ts` — parse `/later` and `/lt` command forms.
- `src/commands/command-list.ts` — recognize `/later` and `/lt`.
- `src/commands/command-policy.ts` — gate create/list/cancel in groups; allow help publicly.
- `src/commands/command-router.ts` — route later commands.
- `src/commands/router-types.ts` — add scheduled service dependency and synthetic dispatch types.
- `src/commands/help/help-registry.ts` and `src/commands/handlers/later-handler.ts` — expose `/help later`.
- `src/channels/types.ts` — add a generic scheduled/synthetic turn method to channel runtimes.
- `src/channels/channel-registry.ts` — route synthetic scheduled turns by `chatKey`.
- `src/channels/weixin-channel.ts` and Weixin messaging helpers — implement scheduled turn by reusing existing turn delivery/quota behavior.
- `src/main.ts` / `src/run-console.ts` — construct service, inject into router, start/stop scheduler with runtime.
- `docs/commands.md` — document `/later`.

## Task 1: State Model and Parsing

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/state-store.ts`
- Test: add focused cases to existing state-store tests or create `tests/unit/state/scheduled-state.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `tests/unit/state/scheduled-state.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createEmptyState } from "../../../src/state/types";
import { parseState } from "../../../src/state/state-store";

test("empty state includes scheduled_tasks", () => {
  expect(createEmptyState().scheduled_tasks).toEqual({});
});

test("parseState accepts scheduled task records", () => {
  const state = parseState({
    sessions: {},
    chat_contexts: {},
    orchestration: undefined,
    scheduled_tasks: {
      k8f2: {
        id: "k8f2",
        chat_key: "weixin:user-1",
        session_alias: "weixin:user-1:backend-codex",
        execute_at: "2026-05-23T13:30:00.000Z",
        message: "检查 CI",
        status: "pending",
        created_at: "2026-05-23T10:00:00.000Z",
        account_id: "wx-1",
        reply_context_token: "ctx-1",
      },
    },
  }, "state.json");

  expect(state.scheduled_tasks.k8f2?.status).toBe("pending");
});

test("parseState rejects malformed scheduled task records", () => {
  expect(() => parseState({
    sessions: {},
    chat_contexts: {},
    orchestration: undefined,
    scheduled_tasks: {
      bad: {
        id: "bad",
        chat_key: "weixin:user-1",
        session_alias: "alias",
        execute_at: "2026-05-23T13:30:00.000Z",
        message: "检查 CI",
        status: "unknown",
        created_at: "2026-05-23T10:00:00.000Z",
      },
    },
  }, "state.json")).toThrow(/malformed scheduled task record/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
rtk bun test tests/unit/state/scheduled-state.test.ts
```

Expected: compile/runtime failure because `scheduled_tasks` does not exist.

- [ ] **Step 3: Add scheduled task types**

In `src/state/types.ts`, import the new type and include the state field:

```ts
import { createEmptyOrchestrationState, type OrchestrationState } from "../orchestration/orchestration-types";
import type { ScheduledTaskRecord } from "../scheduled/scheduled-types";

export interface AppState {
  sessions: Record<string, LogicalSession>;
  chat_contexts: Record<string, ChatContextState>;
  orchestration: OrchestrationState;
  scheduled_tasks: Record<string, ScheduledTaskRecord>;
}

export function createEmptyState(): AppState {
  return {
    sessions: {},
    chat_contexts: {},
    orchestration: createEmptyOrchestrationState(),
    scheduled_tasks: {},
  };
}
```

Create `src/scheduled/scheduled-types.ts`:

```ts
export const LATER_MIN_DELAY_MS = 10_000;
export const LATER_MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const LATER_MESSAGE_PREVIEW_CHARS = 120;

export type ScheduledTaskStatus =
  | "pending"
  | "triggering"
  | "executed"
  | "cancelled"
  | "missed"
  | "failed";

export interface ScheduledTaskRecord {
  id: string;
  chat_key: string;
  session_alias: string;
  execute_at: string;
  message: string;
  status: ScheduledTaskStatus;
  created_at: string;
  account_id?: string;
  reply_context_token?: string;
  source_label?: string;
  triggered_at?: string;
  executed_at?: string;
  cancelled_at?: string;
  missed_at?: string;
  failed_at?: string;
  last_error?: string;
}
```

- [ ] **Step 4: Parse scheduled tasks in StateStore**

In `src/state/state-store.ts`, import the status type and add validators near session validators:

```ts
import type { ScheduledTaskRecord, ScheduledTaskStatus } from "../scheduled/scheduled-types";

function isScheduledTaskStatus(value: unknown): value is ScheduledTaskStatus {
  return (
    value === "pending" ||
    value === "triggering" ||
    value === "executed" ||
    value === "cancelled" ||
    value === "missed" ||
    value === "failed"
  );
}

function isScheduledTaskRecord(value: unknown): value is ScheduledTaskRecord {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.chat_key) &&
    isString(value.session_alias) &&
    isString(value.execute_at) &&
    isString(value.message) &&
    isScheduledTaskStatus(value.status) &&
    isString(value.created_at) &&
    isOptionalString(value.account_id) &&
    isOptionalString(value.reply_context_token) &&
    isOptionalString(value.source_label) &&
    isOptionalString(value.triggered_at) &&
    isOptionalString(value.executed_at) &&
    isOptionalString(value.cancelled_at) &&
    isOptionalString(value.missed_at) &&
    isOptionalString(value.failed_at) &&
    isOptionalString(value.last_error)
  );
}

function parseScheduledTasks(raw: unknown, path: string): Record<string, ScheduledTaskRecord> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    throw new Error(`state file "${path}" must contain an object field "scheduled_tasks"`);
  }
  const tasks: Record<string, ScheduledTaskRecord> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isScheduledTaskRecord(value) || value.id !== id) {
      throw new Error(`state file "${path}" contains malformed scheduled task record "${id}"`);
    }
    tasks[id] = value;
  }
  return tasks;
}
```

Then return it from `parseState`:

```ts
return {
  sessions: parsedSessions,
  chat_contexts: parseChatContexts(chatContexts, path),
  orchestration,
  scheduled_tasks: parseScheduledTasks(raw.scheduled_tasks, path),
};
```

- [ ] **Step 5: Run state tests**

Run:

```bash
rtk bun test tests/unit/state/scheduled-state.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/state/types.ts src/state/state-store.ts src/scheduled/scheduled-types.ts tests/unit/state/scheduled-state.test.ts
rtk git commit -m "feat(scheduled): add scheduled task state"
```

## Task 2: Time Parser

**Files:**
- Create: `src/scheduled/parse-later-time.ts`
- Test: `tests/unit/scheduled/parse-later-time.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/unit/scheduled/parse-later-time.test.ts`:

```ts
import { expect, test } from "bun:test";

import { parseLaterTime } from "../../../src/scheduled/parse-later-time";

const now = new Date("2026-05-23T10:00:00+08:00"); // Saturday

function ok(tokens: string[]) {
  const result = parseLaterTime(tokens, now);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result;
}

test("parses relative English time", () => {
  const result = ok(["in", "2h", "检查", "CI"]);
  expect(result.executeAt.toISOString()).toBe("2026-05-23T04:00:00.000Z");
  expect(result.messageStartIndex).toBe(2);
});

test("parses relative Chinese time", () => {
  const result = ok(["30分钟后", "总结"]);
  expect(result.executeAt.toISOString()).toBe("2026-05-23T02:30:00.000Z");
  expect(result.messageStartIndex).toBe(1);
});

test("parses today tomorrow and weekday", () => {
  expect(ok(["at", "21:30", "继续"]).executeAt.toISOString()).toBe("2026-05-23T13:30:00.000Z");
  expect(ok(["明天", "09:00", "看", "PR"]).executeAt.toISOString()).toBe("2026-05-24T01:00:00.000Z");
  expect(ok(["周五", "09:00", "看", "PR"]).executeAt.toISOString()).toBe("2026-05-29T01:00:00.000Z");
  expect(ok(["friday", "09:00", "看", "PR"]).executeAt.toISOString()).toBe("2026-05-29T01:00:00.000Z");
});

test("rejects past today time, too soon, out of range, and unsupported natural language", () => {
  expect(parseLaterTime(["at", "09:00", "继续"], now)).toEqual({ ok: false, code: "past_today_time", value: "09:00" });
  expect(parseLaterTime(["in", "5s", "继续"], now)).toEqual({ ok: false, code: "unrecognized_time" });
  expect(parseLaterTime(["in", "8d", "继续"], now)).toEqual({ ok: false, code: "out_of_range" });
  expect(parseLaterTime(["半小时后", "继续"], now)).toEqual({ ok: false, code: "unrecognized_time" });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

```bash
rtk bun test tests/unit/scheduled/parse-later-time.test.ts
```

Expected: import failure because parser does not exist.

- [ ] **Step 3: Implement parser**

Create `src/scheduled/parse-later-time.ts` with a deterministic token parser. Use local time constructors so tests are stable in `Asia/Shanghai`; do not use NLP libraries.

```ts
import { LATER_MAX_DELAY_MS, LATER_MIN_DELAY_MS } from "./scheduled-types";

export type LaterTimeParseErrorCode =
  | "missing_time"
  | "unrecognized_time"
  | "missing_message"
  | "past_today_time"
  | "too_soon"
  | "out_of_range";

export type LaterTimeParseResult =
  | { ok: true; executeAt: Date; messageStartIndex: number }
  | { ok: false; code: LaterTimeParseErrorCode; value?: string };

const WEEKDAYS = new Map<string, number>([
  ["周日", 0], ["周天", 0], ["星期日", 0], ["星期天", 0], ["sun", 0], ["sunday", 0],
  ["周一", 1], ["星期一", 1], ["mon", 1], ["monday", 1],
  ["周二", 2], ["星期二", 2], ["tue", 2], ["tuesday", 2],
  ["周三", 3], ["星期三", 3], ["wed", 3], ["wednesday", 3],
  ["周四", 4], ["星期四", 4], ["thu", 4], ["thursday", 4],
  ["周五", 5], ["星期五", 5], ["fri", 5], ["friday", 5],
  ["周六", 6], ["星期六", 6], ["sat", 6], ["saturday", 6],
]);

export function parseLaterTime(tokens: string[], now = new Date()): LaterTimeParseResult {
  if (tokens.length === 0) return { ok: false, code: "missing_time" };

  const relative = parseRelative(tokens, now);
  if (relative) return validateResult(relative.executeAt, relative.messageStartIndex, tokens, now);

  const absolute = parseAbsolute(tokens, now);
  if (absolute) return validateResult(absolute.executeAt, absolute.messageStartIndex, tokens, now, absolute.pastTodayValue);

  return { ok: false, code: "unrecognized_time" };
}

function parseRelative(tokens: string[], now: Date): { executeAt: Date; messageStartIndex: number } | null {
  if (tokens[0] === "in" && tokens[1]) {
    const ms = parseDuration(tokens[1]);
    if (ms !== null) return { executeAt: new Date(now.getTime() + ms), messageStartIndex: 2 };
  }
  const zh = /^(\d+)(分钟|小时|天)后$/.exec(tokens[0] ?? "");
  if (zh) {
    const amount = Number(zh[1]);
    const unit = zh[2];
    const ms = unit === "分钟" ? amount * 60_000 : unit === "小时" ? amount * 3_600_000 : amount * 86_400_000;
    return { executeAt: new Date(now.getTime() + ms), messageStartIndex: 1 };
  }
  return null;
}

function parseDuration(value: string): number | null {
  const match = /^(\d+)(m|min|minute|minutes|h|hour|hours|d|day|days)$/.exec(value.toLowerCase());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "m" || unit === "min" || unit === "minute" || unit === "minutes") return amount * 60_000;
  if (unit === "h" || unit === "hour" || unit === "hours") return amount * 3_600_000;
  return amount * 86_400_000;
}

function parseAbsolute(tokens: string[], now: Date): { executeAt: Date; messageStartIndex: number; pastTodayValue?: string } | null {
  if (tokens[0] === "at" && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    const executeAt = atLocalDate(now, 0, parsed.hour, parsed.minute);
    if (executeAt.getTime() <= now.getTime()) return { executeAt, messageStartIndex: 2, pastTodayValue: tokens[1] };
    return { executeAt, messageStartIndex: 2 };
  }

  const dayWord = tokens[0]?.toLowerCase();
  const dayOffset = dayWord === "today" || dayWord === "今天" ? 0
    : dayWord === "tomorrow" || dayWord === "明天" ? 1
      : dayWord === "后天" ? 2
        : null;
  if (dayOffset !== null && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    const executeAt = atLocalDate(now, dayOffset, parsed.hour, parsed.minute);
    if (dayOffset === 0 && executeAt.getTime() <= now.getTime()) return { executeAt, messageStartIndex: 2, pastTodayValue: tokens[1] };
    return { executeAt, messageStartIndex: 2 };
  }

  const weekday = WEEKDAYS.get(tokens[0]?.toLowerCase() ?? "");
  if (weekday !== undefined && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    let days = (weekday - now.getDay() + 7) % 7;
    let executeAt = atLocalDate(now, days, parsed.hour, parsed.minute);
    if (days === 0 && executeAt.getTime() <= now.getTime()) {
      days = 7;
      executeAt = atLocalDate(now, days, parsed.hour, parsed.minute);
    }
    return { executeAt, messageStartIndex: 2 };
  }

  return null;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function atLocalDate(now: Date, dayOffset: number, hour: number, minute: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);
}

function validateResult(
  executeAt: Date,
  messageStartIndex: number,
  tokens: string[],
  now: Date,
  pastTodayValue?: string,
): LaterTimeParseResult {
  if (pastTodayValue) return { ok: false, code: "past_today_time", value: pastTodayValue };
  if (tokens.slice(messageStartIndex).join(" ").trim().length === 0) return { ok: false, code: "missing_message" };
  const delta = executeAt.getTime() - now.getTime();
  if (delta < LATER_MIN_DELAY_MS) return { ok: false, code: "too_soon" };
  if (delta > LATER_MAX_DELAY_MS) return { ok: false, code: "out_of_range" };
  return { ok: true, executeAt, messageStartIndex };
}
```

- [ ] **Step 4: Run parser tests**

```bash
rtk bun test tests/unit/scheduled/parse-later-time.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/scheduled/parse-later-time.ts tests/unit/scheduled/parse-later-time.test.ts
rtk git commit -m "feat(scheduled): parse later time expressions"
```

## Task 3: Scheduled Service and Renderers

**Files:**
- Create: `src/scheduled/scheduled-service.ts`
- Create: `src/scheduled/scheduled-render.ts`
- Test: `tests/unit/scheduled/scheduled-service.test.ts`, `tests/unit/scheduled/scheduled-render.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/unit/scheduled/scheduled-service.test.ts`:

```ts
import { expect, test } from "bun:test";

import { ScheduledTaskService } from "../../../src/scheduled/scheduled-service";
import { createEmptyState, type AppState } from "../../../src/state/types";

class MemoryStore {
  saves = 0;
  async save(_state: AppState): Promise<void> { this.saves += 1; }
}

test("creates task with collision-checked lowercase id", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.abcd = {
    id: "abcd",
    chat_key: "weixin:user-1",
    session_alias: "alias",
    execute_at: "2026-05-23T10:00:00.000Z",
    message: "old",
    status: "pending",
    created_at: "2026-05-23T09:00:00.000Z",
  };
  const store = new MemoryStore();
  const service = new ScheduledTaskService(state, store, {
    now: () => new Date("2026-05-23T09:00:00.000Z"),
    generateId: (() => {
      const ids = ["abcd", "ef12"];
      return () => ids.shift() ?? "zz99";
    })(),
  });

  const task = await service.createTask({
    chatKey: "weixin:user-1",
    sessionAlias: "internal-alias",
    executeAt: new Date("2026-05-23T10:00:00.000Z"),
    message: "检查 CI",
    accountId: "wx-1",
    replyContextToken: "ctx-1",
  });

  expect(task.id).toBe("ef12");
  expect(state.scheduled_tasks.ef12?.session_alias).toBe("internal-alias");
  expect(store.saves).toBe(1);
});

test("lists pending tasks ordered by execute_at and cancels by #id case-insensitively", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.bbbb = {
    id: "bbbb", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T12:00:00.000Z", message: "later", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  state.scheduled_tasks.aaaa = {
    id: "aaaa", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T10:00:00.000Z", message: "soon", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  const store = new MemoryStore();
  const service = new ScheduledTaskService(state, store);

  expect(service.listPending().map((task) => task.id)).toEqual(["aaaa", "bbbb"]);
  expect(await service.cancelPending("#AAAA")).toBe(true);
  expect(state.scheduled_tasks.aaaa?.status).toBe("cancelled");
});

test("claims due tasks and marks old pending tasks missed", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.due1 = {
    id: "due1", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T09:59:00.000Z", message: "due", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  state.scheduled_tasks.future = {
    id: "future", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T10:01:00.000Z", message: "future", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  const service = new ScheduledTaskService(state, new MemoryStore(), { now: () => new Date("2026-05-23T10:00:00.000Z") });

  expect((await service.claimDueTasks()).map((task) => task.id)).toEqual(["due1"]);
  expect(state.scheduled_tasks.due1?.status).toBe("triggering");
  expect(state.scheduled_tasks.future?.status).toBe("pending");

  await service.markStartupMissed();
  expect(state.scheduled_tasks.due1?.status).toBe("triggering");
});
```

- [ ] **Step 2: Write failing renderer tests**

Create `tests/unit/scheduled/scheduled-render.test.ts`:

```ts
import { expect, test } from "bun:test";

import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../../src/scheduled/scheduled-render";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const task: ScheduledTaskRecord = {
  id: "k8f2",
  chat_key: "weixin:user-1",
  session_alias: "internal",
  execute_at: "2026-05-23T13:30:00.000Z",
  message: "检查 CI 是否恢复",
  status: "pending",
  created_at: "2026-05-23T10:00:00.000Z",
};

test("renders help", () => {
  expect(renderLaterHelp()).toContain("/lt in 2h 检查 CI");
});

test("renders created task and list with display session", () => {
  expect(renderTaskCreated(task, "backend-codex")).toContain("#k8f2");
  expect(renderTaskCreated(task, "backend-codex")).toContain("会话：backend-codex");
  expect(renderLaterList([task], (alias) => alias === "internal" ? "backend-codex" : alias)).toContain("检查 CI 是否恢复");
});
```

- [ ] **Step 3: Run tests and verify failure**

```bash
rtk bun test tests/unit/scheduled/scheduled-service.test.ts tests/unit/scheduled/scheduled-render.test.ts
```

Expected: import failures.

- [ ] **Step 4: Implement service**

Create `src/scheduled/scheduled-service.ts`:

```ts
import type { StateStore } from "../state/state-store";
import type { AppState } from "../state/types";
import type { ScheduledTaskRecord } from "./scheduled-types";

export interface CreateScheduledTaskInput {
  chatKey: string;
  sessionAlias: string;
  executeAt: Date;
  message: string;
  accountId?: string;
  replyContextToken?: string;
  sourceLabel?: string;
}

export interface ScheduledTaskServiceOptions {
  now?: () => Date;
  generateId?: () => string;
}

export class ScheduledTaskService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(
    private readonly state: AppState,
    private readonly stateStore: Pick<StateStore, "save">,
    options?: ScheduledTaskServiceOptions,
  ) {
    this.now = options?.now ?? (() => new Date());
    this.generateId = options?.generateId ?? (() => Math.random().toString(36).slice(2, 6));
  }

  async createTask(input: CreateScheduledTaskInput): Promise<ScheduledTaskRecord> {
    const id = this.nextId();
    const task: ScheduledTaskRecord = {
      id,
      chat_key: input.chatKey,
      session_alias: input.sessionAlias,
      execute_at: input.executeAt.toISOString(),
      message: input.message,
      status: "pending",
      created_at: this.now().toISOString(),
      ...(input.accountId ? { account_id: input.accountId } : {}),
      ...(input.replyContextToken ? { reply_context_token: input.replyContextToken } : {}),
      ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
    };
    this.state.scheduled_tasks[id] = task;
    await this.save();
    return task;
  }

  listPending(): ScheduledTaskRecord[] {
    return Object.values(this.state.scheduled_tasks)
      .filter((task) => task.status === "pending")
      .sort((left, right) => left.execute_at.localeCompare(right.execute_at));
  }

  async cancelPending(inputId: string): Promise<boolean> {
    const id = normalizeId(inputId);
    const task = this.state.scheduled_tasks[id];
    if (!task || task.status !== "pending") return false;
    task.status = "cancelled";
    task.cancelled_at = this.now().toISOString();
    await this.save();
    return true;
  }

  async markStartupMissed(): Promise<void> {
    const nowMs = this.now().getTime();
    let changed = false;
    for (const task of Object.values(this.state.scheduled_tasks)) {
      if (task.status === "pending" && Date.parse(task.execute_at) < nowMs) {
        task.status = "missed";
        task.missed_at = this.now().toISOString();
        changed = true;
      }
      if (task.status === "triggering") {
        task.status = "failed";
        task.failed_at = this.now().toISOString();
        task.last_error = "process stopped while task was triggering";
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async claimDueTasks(): Promise<ScheduledTaskRecord[]> {
    const nowMs = this.now().getTime();
    const due = this.listPending().filter((task) => Date.parse(task.execute_at) <= nowMs);
    if (due.length === 0) return [];
    const at = this.now().toISOString();
    for (const task of due) {
      task.status = "triggering";
      task.triggered_at = at;
    }
    await this.save();
    return due.map((task) => ({ ...task }));
  }

  async markExecuted(id: string): Promise<void> {
    const task = this.state.scheduled_tasks[normalizeId(id)];
    if (!task) return;
    task.status = "executed";
    task.executed_at = this.now().toISOString();
    await this.save();
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    const task = this.state.scheduled_tasks[normalizeId(id)];
    if (!task) return;
    task.status = "failed";
    task.failed_at = this.now().toISOString();
    task.last_error = error instanceof Error ? error.message : String(error);
    await this.save();
  }

  private nextId(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = normalizeId(this.generateId()).replace(/[^0-9a-z]/g, "").slice(0, 6);
      if (id.length >= 4 && !this.state.scheduled_tasks[id]) return id;
    }
    throw new Error("failed to generate unique scheduled task id");
  }

  private async save(): Promise<void> {
    await this.stateStore.save(this.state);
  }
}

export function normalizeId(input: string): string {
  return input.trim().replace(/^#/, "").toLowerCase();
}
```

- [ ] **Step 5: Implement renderers**

Create `src/scheduled/scheduled-render.ts`:

```ts
import type { ScheduledTaskRecord } from "./scheduled-types";
import { LATER_MESSAGE_PREVIEW_CHARS } from "./scheduled-types";

export function renderLaterHelp(): string {
  return [
    "定时任务用法：",
    "",
    "创建：",
    "/lt in 2h 检查 CI",
    "/lt 30分钟后 总结进展",
    "/lt tomorrow 09:00 看 PR",
    "/lt 周五 09:00 继续处理",
    "",
    "查看：",
    "/lt list",
    "",
    "取消：",
    "/lt cancel <id>",
    "",
    "说明：",
    "- 只支持一次性任务",
    "- 时间必须在 10 秒之后、7 天之内",
    "- 到点后会把消息发送到创建时绑定的会话",
    "- 触发通知和 agent 回复复用现有频道路由；微信回复额度由现有路由控制",
    "- 不支持延迟执行 / 开头的 weacpx 命令",
  ].join("\n");
}

export function renderTaskCreated(task: ScheduledTaskRecord, displaySession: string): string {
  return [
    `已创建定时任务 #${task.id}`,
    `执行时间：${formatLocalDateTime(new Date(task.execute_at))}`,
    `会话：${displaySession}`,
    `内容：${preview(task.message)}`,
  ].join("\n");
}

export function renderLaterList(tasks: ScheduledTaskRecord[], displaySession: (internalAlias: string) => string): string {
  if (tasks.length === 0) return "当前没有待执行定时任务。";
  return [
    "待执行定时任务：",
    "",
    ...tasks.flatMap((task) => [
      `#${task.id}  ${formatLocalDateTime(new Date(task.execute_at))}  会话：${displaySession(task.session_alias)}`,
      preview(task.message),
      "",
    ]),
  ].join("\n").trimEnd();
}

export function preview(text: string): string {
  return text.length <= LATER_MESSAGE_PREVIEW_CHARS
    ? text
    : `${text.slice(0, LATER_MESSAGE_PREVIEW_CHARS - 1)}…`;
}

export function formatLocalDateTime(date: Date): string {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
```

- [ ] **Step 6: Run service and renderer tests**

```bash
rtk bun test tests/unit/scheduled/scheduled-service.test.ts tests/unit/scheduled/scheduled-render.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/scheduled/scheduled-service.ts src/scheduled/scheduled-render.ts tests/unit/scheduled/scheduled-service.test.ts tests/unit/scheduled/scheduled-render.test.ts
rtk git commit -m "feat(scheduled): manage scheduled task records"
```

## Task 4: Command Parsing and Policy

**Files:**
- Modify: `src/commands/parse-command.ts`
- Modify: `src/commands/command-list.ts`
- Modify: `src/commands/command-policy.ts`
- Test: `tests/unit/commands/parse-command.test.ts`, `tests/unit/commands/command-policy.test.ts`

- [ ] **Step 1: Add failing parse tests**

Append to `tests/unit/commands/parse-command.test.ts`:

```ts
test("parses later commands", () => {
  expect(parseCommand("/later")).toEqual({ kind: "later.help" });
  expect(parseCommand("/lt")).toEqual({ kind: "later.help" });
  expect(parseCommand("/lt list")).toEqual({ kind: "later.list" });
  expect(parseCommand("/later cancel #K8F2")).toEqual({ kind: "later.cancel", id: "#K8F2" });
  expect(parseCommand("/lt in 2h 检查 CI")).toEqual({
    kind: "later.create",
    tokens: ["in", "2h", "检查", "CI"],
  });
});
```

- [ ] **Step 2: Add failing policy tests**

Append to `tests/unit/commands/command-policy.test.ts`:

```ts
import { authorizeCommandForChat, renderCommandAccessDenied } from "../../../src/commands/command-policy";

test("allows later help in groups but gates later control commands to owner", () => {
  expect(authorizeCommandForChat({ kind: "later.help" }, { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat({ kind: "later.list" }, { chatType: "group", isOwner: false })).toEqual({ allowed: false, reason: "group-owner-required" });
  expect(authorizeCommandForChat({ kind: "later.cancel", id: "k8f2" }, { chatType: "group", isOwner: true })).toEqual({ allowed: true });
  expect(renderCommandAccessDenied({ kind: "later.cancel", id: "k8f2" })).toContain("/later cancel");
});
```

If the file already imports these symbols, merge imports instead of duplicating them.

- [ ] **Step 3: Run tests and verify failure**

```bash
rtk bun test tests/unit/commands/parse-command.test.ts tests/unit/commands/command-policy.test.ts
```

Expected: type/expectation failures for missing kinds.

- [ ] **Step 4: Implement parsing**

In `ParsedCommand` union in `src/commands/parse-command.ts`, add:

```ts
  | { kind: "later.help" }
  | { kind: "later.create"; tokens: string[] }
  | { kind: "later.list" }
  | { kind: "later.cancel"; id: string }
```

In `normalizeCommand`, add:

```ts
if (command === "/lt") return "/later";
```

Near the top-level command checks, add:

```ts
if (command === "/later") {
  if (parts.length === 1) return { kind: "later.help" };
  if (parts[1] === "list" && parts.length === 2) return { kind: "later.list" };
  if (parts[1] === "cancel" && parts[2] && parts.length === 3) {
    return { kind: "later.cancel", id: parts[2] };
  }
  return { kind: "later.create", tokens: parts.slice(1) };
}
```

- [ ] **Step 5: Add known command prefixes**

In `src/commands/command-list.ts`, add:

```ts
  "/later",
  "/lt",
```

- [ ] **Step 6: Implement policy labels**

In `src/commands/command-policy.ts`, add `"later.help"` to `GROUP_PUBLIC_COMMAND_KINDS`; do not add `later.create`, `later.list`, or `later.cancel`.

Add labels:

```ts
  "later.create": "/later",
  "later.list": "/later list",
  "later.cancel": "/later cancel",
```

- [ ] **Step 7: Run tests**

```bash
rtk bun test tests/unit/commands/parse-command.test.ts tests/unit/commands/command-policy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/commands/parse-command.ts src/commands/command-list.ts src/commands/command-policy.ts tests/unit/commands/parse-command.test.ts tests/unit/commands/command-policy.test.ts
rtk git commit -m "feat(commands): parse later commands"
```

## Task 5: `/later` Command Handler and Router Integration

**Files:**
- Create: `src/commands/handlers/later-handler.ts`
- Modify: `src/commands/command-router.ts`
- Modify: `src/commands/router-types.ts`
- Modify: `src/commands/help/help-registry.ts`
- Test: `tests/unit/commands/command-router-later.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `tests/unit/commands/command-router-later.test.ts` using existing test support. Test these cases:

```ts
import { expect, test } from "bun:test";

import { CommandRouter } from "../../../src/commands/command-router";
import { createConfig, createTransport, MemoryConfigStore, MemoryStateStore } from "./command-router-test-support";
import { createEmptyState } from "../../../src/state/types";
import { SessionService } from "../../../src/sessions/session-service";
import { ScheduledTaskService } from "../../../src/scheduled/scheduled-service";

function setup() {
  const config = createConfig();
  const state = createEmptyState();
  const store = new MemoryStateStore();
  const sessions = new SessionService(config, store, state);
  const scheduled = new ScheduledTaskService(state, store, {
    now: () => new Date("2026-05-23T10:00:00+08:00"),
    generateId: () => "k8f2",
  });
  const router = new CommandRouter(
    sessions,
    createTransport(),
    config,
    new MemoryConfigStore(config),
    undefined,
    undefined,
    undefined,
    undefined,
    scheduled,
  );
  return { router, sessions, state };
}

test("/later shows help", async () => {
  const { router } = setup();
  const result = await router.handle("weixin:user-1", "/lt");
  expect(result.text).toContain("定时任务用法");
});

test("/later creates task bound to current session", async () => {
  const { router, sessions, state } = setup();
  await sessions.createSession("weixin:user-1", "backend-codex", "codex", "backend", "transport-backend");
  await sessions.useSession("weixin:user-1", "backend-codex");

  const result = await router.handle("weixin:user-1", "/lt in 2h 检查 CI", undefined, "ctx-1", "wx-1");

  expect(result.text).toContain("已创建定时任务 #k8f2");
  expect(state.scheduled_tasks.k8f2?.session_alias).toBe("backend-codex");
  expect(state.scheduled_tasks.k8f2?.message).toBe("检查 CI");
});

test("/later rejects command-looking messages", async () => {
  const { router, sessions } = setup();
  await sessions.createSession("weixin:user-1", "backend-codex", "codex", "backend", "transport-backend");
  await sessions.useSession("weixin:user-1", "backend-codex");

  const result = await router.handle("weixin:user-1", "/lt in 2h /status");
  expect(result.text).toContain("不支持延迟执行 weacpx 命令");
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
rtk bun test tests/unit/commands/command-router-later.test.ts
```

Expected: constructor/signature or missing handler failures.

- [ ] **Step 3: Add scheduled dependency type**

In `src/commands/router-types.ts`:

```ts
import type { ScheduledTaskService } from "../scheduled/scheduled-service";

export type ScheduledRouterOps = Pick<
  ScheduledTaskService,
  "createTask" | "listPending" | "cancelPending"
>;

export interface CommandRouterContext {
  // existing fields...
  scheduled?: ScheduledRouterOps;
}
```

- [ ] **Step 4: Implement handler**

Create `src/commands/handlers/later-handler.ts` with functions:

```ts
import type { HelpTopicMetadata } from "../help/help-types";
import type { RouterResponse, ScheduledRouterOps } from "../router-types";
import type { SessionService } from "../../sessions/session-service";
import { isKnownWeacpxCommandText } from "../command-list";
import { parseLaterTime } from "../../scheduled/parse-later-time";
import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../scheduled/scheduled-render";

export const laterHelp: HelpTopicMetadata = {
  topic: "later",
  aliases: ["lt"],
  summary: "创建、查看和取消一次性定时任务。",
  commands: [
    { usage: "/later 或 /lt", description: "显示定时任务帮助" },
    { usage: "/lt <time> <message>", description: "创建一次性定时任务" },
    { usage: "/lt list", description: "查看全局待执行定时任务" },
    { usage: "/lt cancel <id>", description: "取消待执行定时任务" },
  ],
  examples: [
    "/lt in 2h 检查 CI",
    "/lt 30分钟后 总结进展",
    "/lt tomorrow 09:00 看 PR",
    "/lt 周五 09:00 继续处理",
  ],
};

export async function handleLaterHelp(): Promise<RouterResponse> {
  return { text: renderLaterHelp() };
}

export async function handleLaterList(scheduled: ScheduledRouterOps | undefined): Promise<RouterResponse> {
  if (!scheduled) return { text: "定时任务服务未启用。" };
  return { text: renderLaterList(scheduled.listPending(), (alias) => alias) };
}

export async function handleLaterCancel(scheduled: ScheduledRouterOps | undefined, id: string): Promise<RouterResponse> {
  if (!scheduled) return { text: "定时任务服务未启用。" };
  const ok = await scheduled.cancelPending(id);
  const cleanId = id.trim().replace(/^#/, "").toLowerCase();
  return ok
    ? { text: `已取消定时任务 #${cleanId}。` }
    : { text: `没有找到待执行定时任务 #${cleanId}。\n\n可以用 /lt list 查看当前待执行任务。` };
}

export async function handleLaterCreate(input: {
  scheduled: ScheduledRouterOps | undefined;
  sessions: SessionService;
  chatKey: string;
  tokens: string[];
  replyContextToken?: string;
  accountId?: string;
  now?: Date;
}): Promise<RouterResponse> {
  if (!input.scheduled) return { text: "定时任务服务未启用。" };
  const parsed = parseLaterTime(input.tokens, input.now ?? new Date());
  if (!parsed.ok) return { text: renderLaterTimeError(parsed) };

  const message = input.tokens.slice(parsed.messageStartIndex).join(" ").trim();
  if (isKnownWeacpxCommandText(message)) {
    return { text: "定时任务只支持发送普通消息给当前会话，不支持延迟执行 weacpx 命令。\n\n如果你想让 agent 讨论这段命令，请把它写成普通句子，例如：\n/lt in 1h 请解释 /status 的作用" };
  }

  const session = await input.sessions.getCurrentSession(input.chatKey);
  if (!session) {
    return { text: "当前没有会话，无法创建定时任务。\n\n请先创建或切换会话，例如：\n/ss codex --ws backend\n/use backend-codex" };
  }

  const task = await input.scheduled.createTask({
    chatKey: input.chatKey,
    sessionAlias: session.alias,
    executeAt: parsed.executeAt,
    message,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.replyContextToken ? { replyContextToken: input.replyContextToken } : {}),
  });
  return { text: renderTaskCreated(task, session.alias) };
}

function renderLaterTimeError(error: Exclude<ReturnType<typeof parseLaterTime>, { ok: true }>): string {
  if (error.code === "missing_message") return "缺少要发送给当前会话的消息。\n\n例如：\n/lt in 2h 检查 CI 是否通过";
  if (error.code === "too_soon") return "定时时间太近了。请至少设置到 10 秒之后。";
  if (error.code === "out_of_range") return "定时时间超出范围。目前只支持未来 7 天内的一次性任务。\n\n例如：\n/lt in 3d 检查\n/lt 周五 09:00 看 PR";
  if (error.code === "past_today_time") return `${error.value} 今天已经过去了。\n\n请使用更明确的时间，例如：\n/lt tomorrow ${error.value} 继续处理\n/lt in 2h 继续处理`;
  return "没能识别定时时间。\n\n请使用这些格式之一：\n\n1. 相对时间：\n/lt in 2h 检查 CI\n/lt 30分钟后 总结进展\n\n2. 指定日期词：\n/lt today 21:30 继续处理\n/lt tomorrow 09:00 看 PR\n/lt 明天 09:00 看 PR\n\n3. 星期几：\n/lt 周五 09:00 看 PR\n/lt friday 09:00 看 PR\n\n限制：只支持 10 秒之后、7 天之内的一次性定时任务。";
}
```

- [ ] **Step 5: Route commands**

In `src/commands/command-router.ts`:

- Import later handlers.
- Add constructor parameter `private readonly scheduled?: ScheduledRouterOps` after `quota?: QuotaManager`.
- Add switch cases:

```ts
case "later.help":
  return await handleLaterHelp();
case "later.list":
  return await handleLaterList(this.scheduled);
case "later.cancel":
  return await handleLaterCancel(this.scheduled, command.id);
case "later.create":
  return await handleLaterCreate({
    scheduled: this.scheduled,
    sessions: this.sessions,
    chatKey,
    tokens: command.tokens,
    ...(replyContextToken ? { replyContextToken } : {}),
    ...(accountId ? { accountId } : {}),
  });
```

- [ ] **Step 6: Register help**

In `src/commands/help/help-registry.ts`, import and include `laterHelp` before orchestration or near session help.

- [ ] **Step 7: Run router tests**

```bash
rtk bun test tests/unit/commands/command-router-later.test.ts tests/unit/commands/parse-command.test.ts tests/unit/commands/command-policy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/commands/handlers/later-handler.ts src/commands/command-router.ts src/commands/router-types.ts src/commands/help/help-registry.ts tests/unit/commands/command-router-later.test.ts
rtk git commit -m "feat(commands): add later command handler"
```

## Task 6: Channel Synthetic Scheduled Turn

**Files:**
- Modify: `src/channels/types.ts`
- Modify: `src/channels/channel-registry.ts`
- Modify: `src/channels/weixin-channel.ts`
- Create or modify: `src/weixin/messaging/scheduled-turn.ts`
- Test: `tests/unit/channels/weixin-channel.test.ts` or `tests/unit/scheduled/scheduled-channel-turn.test.ts`

- [ ] **Step 1: Write failing channel test**

Create `tests/unit/scheduled/scheduled-channel-turn.test.ts` with injected fake sender dependencies if `WeixinChannel` is difficult to instantiate. The expected behavior is:

```ts
import { expect, mock, test } from "bun:test";

import { runScheduledWeixinTurn } from "../../../src/weixin/messaging/scheduled-turn";
import type { Agent } from "../../../src/weixin/agent/interface";

test("scheduled turn sends notice then runs agent through existing reply path", async () => {
  const sent: string[] = [];
  const agent: Agent = {
    async chat(request) {
      expect(request.conversationId).toBe("weixin:user-1");
      expect(request.text).toBe("检查 CI");
      await request.reply?.("stream chunk");
      return { text: "final answer" };
    },
  };

  await runScheduledWeixinTurn({
    agent,
    input: {
      chatKey: "weixin:user-1",
      accountId: "wx-1",
      replyContextToken: "ctx-1",
      noticeText: "执行定时任务 #k8f2",
      promptText: "检查 CI",
    },
    deps: {
      sendText: mock(async (text: string) => { sent.push(text); }),
      reserveMidSegment: () => true,
      reserveFinal: () => true,
      finalRemaining: () => 4,
      enqueuePendingFinal: () => {},
      logger: { error: async () => {}, info: async () => {}, debug: async () => {}, warn: async () => {} },
    },
  });

  expect(sent).toEqual(["执行定时任务 #k8f2", "stream chunk", "final answer"]);
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
rtk bun test tests/unit/scheduled/scheduled-channel-turn.test.ts
```

Expected: import failure.

- [ ] **Step 3: Extend channel interface**

In `src/channels/types.ts`:

```ts
export interface ScheduledChannelMessageInput {
  chatKey: string;
  accountId?: string;
  replyContextToken?: string;
  noticeText: string;
  promptText: string;
}

export interface MessageChannelRuntime {
  // existing methods...
  sendScheduledMessage?(input: ScheduledChannelMessageInput): Promise<void>;
}
```

In `src/channels/channel-registry.ts`:

```ts
async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void> {
  const channel = this.requireByChatKey(input.chatKey);
  if (!channel.sendScheduledMessage) {
    throw new Error(`channel "${channel.id}" does not support scheduled messages`);
  }
  await channel.sendScheduledMessage(input);
}
```

- [ ] **Step 4: Implement Weixin scheduled turn helper**

Create `src/weixin/messaging/scheduled-turn.ts`. This helper should reuse `executeChatTurn` and the same quota split concepts as `handle-weixin-message-turn.ts`; if code duplication grows, extract shared final-message sending helpers from `handle-weixin-message-turn.ts` in this task.

Minimum implementation shape:

```ts
import type { Agent } from "../agent/interface";
import { executeChatTurn } from "./execute-chat-turn";

export interface ScheduledWeixinTurnInput {
  chatKey: string;
  accountId?: string;
  replyContextToken?: string;
  noticeText: string;
  promptText: string;
}

export interface ScheduledWeixinTurnDeps {
  sendText: (text: string, tier: "mid" | "final") => Promise<void>;
  reserveMidSegment: (chatKey: string) => boolean;
  reserveFinal: (chatKey: string) => boolean;
  finalRemaining: (chatKey: string) => number;
  enqueuePendingFinal: (chatKey: string, chunks: Array<{ text: string; seq: number; total: number; contextToken?: string; accountId?: string }>) => void;
  logger: { error(event: string, message: string, context?: Record<string, unknown>): Promise<void> | void };
}

export async function runScheduledWeixinTurn(params: {
  agent: Agent;
  input: ScheduledWeixinTurnInput;
  deps: ScheduledWeixinTurnDeps;
}): Promise<void> {
  const { agent, input, deps } = params;
  await deps.sendText(input.noticeText, "final");
  const turn = await executeChatTurn({
    agent,
    request: {
      conversationId: input.chatKey,
      text: input.promptText,
      accountId: input.accountId,
      replyContextToken: input.replyContextToken,
      metadata: { channel: "weixin" },
    },
    onReplySegment: async (text) => {
      if (!deps.reserveMidSegment(input.chatKey)) return false;
      await deps.sendText(text, "mid");
      return true;
    },
  });
  if (turn.text && turn.text.trim().length > 0) {
    if (!deps.reserveFinal(input.chatKey)) {
      await deps.logger.error("scheduled.final.dropped", "scheduled turn final text dropped because final quota is exhausted", { chatKey: input.chatKey });
      return;
    }
    await deps.sendText(turn.text, "final");
  }
}
```

During implementation, replace this minimum final-text handling with existing chunking/pending-final behavior if the shared helper is easy to extract from `handle-weixin-message-turn.ts`. Do not invent a second quota policy.

- [ ] **Step 5: Store agent/deps in WeixinChannel and implement method**

In `src/channels/weixin-channel.ts`:

- Store `agent`, `quota`, and logger from `start()`.
- Implement `sendScheduledMessage(input)` by resolving context token through `getContextToken` with fallback to `input.replyContextToken`, then calling `runScheduledWeixinTurn`.
- Use `sendMessageWeixin` for actual text sends, but only through the helper so quota behavior remains centralized.

- [ ] **Step 6: Run channel test**

```bash
rtk bun test tests/unit/scheduled/scheduled-channel-turn.test.ts tests/unit/channels/weixin-channel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/channels/types.ts src/channels/channel-registry.ts src/channels/weixin-channel.ts src/weixin/messaging/scheduled-turn.ts tests/unit/scheduled/scheduled-channel-turn.test.ts
rtk git commit -m "feat(channels): route scheduled turns through channels"
```

## Task 7: Scheduler Runtime

**Files:**
- Create: `src/scheduled/scheduled-scheduler.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/scheduled/scheduled-scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Create `tests/unit/scheduled/scheduled-scheduler.test.ts`:

```ts
import { expect, mock, test } from "bun:test";

import { ScheduledTaskScheduler } from "../../../src/scheduled/scheduled-scheduler";
import { ScheduledTaskService } from "../../../src/scheduled/scheduled-service";
import { createEmptyState, type AppState } from "../../../src/state/types";

class MemoryStore { async save(_state: AppState): Promise<void> {} }

test("scheduler marks due task executed after dispatch", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.k8f2 = {
    id: "k8f2",
    chat_key: "weixin:user-1",
    session_alias: "backend-codex",
    execute_at: "2026-05-23T02:00:00.000Z",
    message: "检查 CI",
    status: "pending",
    created_at: "2026-05-23T01:00:00.000Z",
  };
  const service = new ScheduledTaskService(state, new MemoryStore(), { now: () => new Date("2026-05-23T02:00:01.000Z") });
  const dispatch = mock(async () => {});
  const scheduler = new ScheduledTaskScheduler(service, { dispatchTask: dispatch, intervalMs: 1000 });

  await scheduler.tick();

  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(state.scheduled_tasks.k8f2?.status).toBe("executed");
});

test("scheduler marks dispatch failures failed", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.k8f2 = {
    id: "k8f2",
    chat_key: "weixin:user-1",
    session_alias: "backend-codex",
    execute_at: "2026-05-23T02:00:00.000Z",
    message: "检查 CI",
    status: "pending",
    created_at: "2026-05-23T01:00:00.000Z",
  };
  const service = new ScheduledTaskService(state, new MemoryStore(), { now: () => new Date("2026-05-23T02:00:01.000Z") });
  const scheduler = new ScheduledTaskScheduler(service, { dispatchTask: async () => { throw new Error("no route"); }, intervalMs: 1000 });

  await scheduler.tick();

  expect(state.scheduled_tasks.k8f2?.status).toBe("failed");
  expect(state.scheduled_tasks.k8f2?.last_error).toContain("no route");
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
rtk bun test tests/unit/scheduled/scheduled-scheduler.test.ts
```

Expected: import failure.

- [ ] **Step 3: Implement scheduler class**

Create `src/scheduled/scheduled-scheduler.ts`:

```ts
import type { AppLogger } from "../logging/app-logger";
import { createNoopAppLogger } from "../logging/app-logger";
import type { ScheduledTaskRecord } from "./scheduled-types";
import type { ScheduledTaskService } from "./scheduled-service";

export interface ScheduledTaskSchedulerDeps {
  dispatchTask: (task: ScheduledTaskRecord) => Promise<void>;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: AppLogger;
}

export class ScheduledTaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private readonly intervalMs: number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly logger: AppLogger;

  constructor(private readonly service: ScheduledTaskService, private readonly deps: ScheduledTaskSchedulerDeps) {
    this.intervalMs = deps.intervalMs ?? 5_000;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.logger = deps.logger ?? createNoopAppLogger();
  }

  async start(): Promise<void> {
    await this.service.markStartupMissed();
    this.timer = this.setIntervalFn(() => {
      void this.tick();
    }, this.intervalMs);
    await this.tick();
  }

  stop(): void {
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runTick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runTick(): Promise<void> {
    const tasks = await this.service.claimDueTasks();
    for (const task of tasks) {
      try {
        await this.deps.dispatchTask(task);
        await this.service.markExecuted(task.id);
      } catch (error) {
        await this.logger.error("scheduled.dispatch_failed", "failed to dispatch scheduled task", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.service.markFailed(task.id, error);
      }
    }
  }
}
```

- [ ] **Step 4: Add main runtime dispatch**

In `src/main.ts`, construct `ScheduledTaskService` after state load. Define `dispatchTask` that:

1. Resolves the stored internal `session_alias` through `sessions.getSession(task.session_alias)` or equivalent.
2. Builds notice text with `renderScheduledTaskNotice(task, displayAlias)`.
3. Calls `channelRegistry.sendScheduledMessage({ chatKey: task.chat_key, accountId: task.account_id, replyContextToken: task.reply_context_token, noticeText, promptText: task.message })`.

Do not call `transport.prompt` directly from scheduler. The channel method should call the `ConsoleAgent`/router path so normal prompt routing and quota behavior apply.

- [ ] **Step 5: Start and stop scheduler**

In runtime startup after channels are ready, call `scheduledScheduler.start()`. In cleanup, call `scheduledScheduler.stop()` before disposing stores.

- [ ] **Step 6: Run scheduler tests**

```bash
rtk bun test tests/unit/scheduled/scheduled-scheduler.test.ts tests/unit/main.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/scheduled/scheduled-scheduler.ts src/main.ts src/run-console.ts tests/unit/scheduled/scheduled-scheduler.test.ts tests/unit/main.test.ts
rtk git commit -m "feat(scheduled): dispatch due scheduled tasks"
```

## Task 8: Documentation and Full Verification

**Files:**
- Modify: `docs/commands.md`

- [ ] **Step 1: Update command docs**

In `docs/commands.md`:

- Add `/later` and `/lt` to quick index.
- Add a “定时任务” section with examples from the design spec.
- Mention: one-shot only, 10 seconds to 7 days, bound to creation-time current session, global list, trusted-channel cancel model, no slash-command delayed execution.

- [ ] **Step 2: Run focused unit tests**

```bash
rtk bun test tests/unit/scheduled tests/unit/commands/parse-command.test.ts tests/unit/commands/command-policy.test.ts tests/unit/commands/command-router-later.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript typecheck**

```bash
rtk npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Run full unit suite**

```bash
rtk npm test
```

Expected: exit 0.

- [ ] **Step 5: Build**

```bash
rtk bun run build
```

Expected: exit 0 and `dist/cli.js` plus bridge outputs generated.

- [ ] **Step 6: Commit docs and final fixes**

```bash
rtk git add docs/commands.md
rtk git commit -m "docs: document later scheduled tasks"
```

If verification required code fixes, include those changed files in the same final commit with message:

```bash
rtk git add <files>
rtk git commit -m "fix(scheduled): complete scheduled task verification"
```

---

## Self-Review Notes

Spec coverage mapping:

- Command surface `/later` and `/lt`: Task 4 and Task 5.
- Time whitelist, 10 seconds to 7 days, weekdays, no complex NL: Task 2.
- State model, internal alias, short ID collision checks, statuses: Task 1 and Task 3.
- List/cancel global pending tasks, trusted-channel permission model: Task 3, Task 4, Task 5.
- Trigger notice, existing channel route/quota reuse, executed definition: Task 6 and Task 7.
- Scheduler tick, startup missed, triggering recovery: Task 7.
- Docs and help: Task 5 and Task 8.

Implementation guardrails:

- Use the existing `HelpTopicMetadata` shape: `{ topic, aliases, summary, commands, examples }`.
- Use `SessionService.getSession(alias)` for resolving stored internal aliases during scheduled dispatch.
- Keep Weixin quota behavior single-sourced: factor reusable helpers out of `handle-weixin-message-turn.ts` before copying large final-message delivery blocks.
