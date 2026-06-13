# Relay Hub Phase 4 — Task Panels, Settings & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the relay-web dashboard's phase-4 surface — right-column scheduler/orchestration task panels, a settings page (account invites + instance pairing + history-retention display), instance-notice rendering, and error-recovery polish — plus a server-side retention/GC maintenance subsystem and the four non-blocking findings carried over from phase 3.

**Architecture:** The scheduler/orchestration RPC seam (MSG constants, DTOs, `control-bridge` dispatch, `ControlService` methods) already exists end-to-end from phases 1–3, so the task panels are almost entirely frontend: a new Pinia `tasks` store calling `api.rpc(...)` plus right-column components, re-fetching on `scheduled-changed`/`orchestration-changed` events (events carry no task payload — they are bare "something changed" signals, mirroring how the `instances` store already reacts to `sessions-changed`). The only new backend is (1) persisting `control.command.execute` input+output to the `messages` cache and (2) a maintenance subsystem that prunes old messages and garbage-collects expired `web_sessions`/`invites`/`pairing_tokens`, exposed read-only to the settings page via `GET /api/config`.

**Tech Stack:** Backend — TypeScript, Hono, SQLite via `SqlDriver`, `bun test`. Frontend — Vue 3 + Pinia + vue-router + Tailwind, tested with Vitest + `@vue/test-utils` + jsdom.

---

## Scope & Design Decisions

- **Branch:** `feat/relay-hub-phase4-task-panels`, stacked on phase-3 HEAD `9bdd806` (matches how phases 1–3 were left: unmerged/unpushed).
- **Task-panel scoping (important design call):**
  - **Scheduler** RPCs are chat-scoped: the relay stamps `chatKey = relay:<accountId>` server-side, so `control.scheduled.list` returns *all* scheduled tasks the relay account created across sessions. The right panel shows the **current session's** scheduled tasks by filtering the returned list client-side on `sessionAlias === <selected alias>`. Creating a task targets the selected session's alias.
  - **Orchestration** RPCs are NOT chat-scoped (they pass through the proxy unscoped) and `OrchestrationTaskDto` has no `sessionAlias`. Orchestration tasks are therefore shown at the **instance** level (all of the selected instance's orchestration tasks), not filtered by session. This is acceptable: a web user is owner of their account's instances (spec §7).
- **History retention** is server-configured (CLI flag `--history-retention-days`, default 30; plus a hard per-session row cap of 2000), pruned on an interval — NOT web-editable in v1. The settings page *displays* the active policy via `GET /api/config`. This keeps a config-write subsystem out of scope (YAGNI).
- **No new MSG constants, DTOs, bridge handlers, or ControlService methods** are needed — the scheduler/orchestration seam is complete. Verify, don't rebuild.
- **Verification commands** (root `tsc --noEmit` only covers `src/**`, so it will NOT catch package/test type errors — use the package builds):
  - Backend typecheck: `bun run build:relay` and `bun run build:relay-protocol`
  - Frontend typecheck + build: `bun run build:relay-web` (runs `vue-tsc --noEmit && vite build`)
  - Backend unit tests (per-file, never whole-dir): `bun test tests/unit/packages/relay/<file>.test.ts`
  - Frontend tests: `bun run test:web` (Vitest)
  - Full gate: `npm test` then `bun run build:relay-web`

---

## File Structure

**Backend (`packages/relay/`):**
- Modify `src/http/app.ts` — persist `command.execute` to messages; add `GET /api/config`.
- Modify `src/stores/messages.ts` — add `prune({ maxAgeMs?, maxPerSession? })`.
- Modify `src/stores/accounts.ts` — add `pruneExpired(now)` (web_sessions + invites).
- Modify `src/stores/instances.ts` — add `prunePairingTokens(now)`.
- Create `src/maintenance.ts` — `runMaintenance(runtime, opts)` + `startMaintenanceLoop(...)`.
- Modify `src/server.ts` — start the maintenance loop in `startRelayServer`; expose retention opts on `RelayRuntime`/`createApp`.
- Modify `src/cli.ts` — `--history-retention-days` flag, usage text.

**Frontend (`packages/relay-web/src/`):**
- Create `stores/tasks.ts` — scheduled + orchestration state/actions/applyEvent.
- Create `stores/notices.ts` — recent instance notices.
- Create `stores/connection.ts` — live `/ws` connection status.
- Create `components/TaskPanel.vue`, `components/ScheduledTasks.vue`, `components/OrchestrationTasks.vue`, `components/NoticeToast.vue`, `components/ConnectionBadge.vue`.
- Create `views/SettingsView.vue`.
- Modify `api/events.ts` — `connectEvents(onEvent, onStatus?)`.
- Modify `api/client.ts` — no change expected (rpc already generic); confirm only.
- Modify `stores/chat.ts` — per-session streaming buffer (finding #4); error surfacing.
- Modify `stores/instances.ts` — `.catch` on fire-and-forget `loadSessions` (finding #3).
- Modify `router/index.ts` — add `/settings` route.
- Modify `views/DashboardView.vue` — mount TaskPanel/NoticeToast/ConnectionBadge; dispatch `notice` + task events; settings nav link.

**Docs:**
- Modify `docs/relay-web-module.md`, `docs/relay-module.md`, `docs/superpowers/specs/2026-06-13-relay-hub-design.md` (§11 phase-4 status), `AGENTS.md` if a new nav entry is warranted.

---

### Task 1: Persist `command.execute` to the message cache (finding #2)

When a `/command` is run through the web input box, only the live output is shown — on reload it is lost because the RPC proxy persists `control.prompt` text but not `control.command.execute`. Persist both the command text (`in`) and its output (`out`) so reload shows it, exactly as prompt input is already echoed.

**Files:**
- Modify: `packages/relay/src/http/app.ts:163-169` (the `try` block in the `POST /api/instances/:id/rpc` handler)
- Test: `tests/unit/packages/relay/http-app.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/packages/relay/http-app.test.ts` (follow the existing harness in that file for building `createApp` deps + an authenticated cookie; mirror the existing prompt-echo test's setup). The gateway fake must return `{ output: "ran ok" }` for `control.command.execute`.

```ts
test("command.execute persists input and output to the message cache", async () => {
  const h = await makeHarness(); // existing helper: app + cookie + a paired online instance `inst`
  h.gateway.respondWith({ output: "ran ok" }); // command result

  const res = await h.app.request(`/api/instances/${h.instanceId}/rpc`, {
    method: "POST",
    headers: { cookie: h.cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "control.command.execute", payload: { sessionAlias: "backend", text: "/status" } }),
  });
  expect(res.status).toBe(200);

  const rows = h.messages.listBySession(h.accountId, h.instanceId, "backend");
  expect(rows.map((r) => [r.direction, r.text])).toEqual([
    ["in", "/status"],
    ["out", "ran ok"],
  ]);
});
```

If `http-app.test.ts` has no reusable harness, construct deps inline the same way the existing tests in that file do (real `createSqlDriver(":memory:")` + `initSchema` + `AccountStore`/`InstanceStore`/`MessageStore` + a fake `gateway`). Create the instance row so `getOwned` succeeds, and a login cookie. The command's `sessionAlias` must be readable from the payload to key the message rows.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/packages/relay/http-app.test.ts`
Expected: FAIL — the new test's `listBySession` returns `[]` (nothing persisted for command.execute).

- [ ] **Step 3: Implement persistence in the rpc handler**

In `packages/relay/src/http/app.ts`, extend the post-`sendRequest` echo block (currently only handles `MSG.prompt`). Replace lines 165-168:

```ts
      const result = await deps.gateway.sendRequest(instance.id, body.type, payload);
      if (body.type === MSG.prompt) {
        const p = payload as { sessionAlias?: string; text?: string };
        if (p.sessionAlias && p.text) deps.messages.append(instance.id, p.sessionAlias, "in", p.text);
      } else if (body.type === MSG.commandExecute) {
        const p = payload as { sessionAlias?: string; text?: string };
        const output = (result as { output?: string } | undefined)?.output;
        if (p.sessionAlias && p.text) deps.messages.append(instance.id, p.sessionAlias, "in", p.text);
        if (p.sessionAlias && typeof output === "string") deps.messages.append(instance.id, p.sessionAlias, "out", output);
      }
      return c.json({ result });
```

Note: `control.command.execute` is in `CHAT_SCOPED_TYPES`, so `sessionAlias` survives the chatKey stamping (the stamp spreads the existing payload, preserving `sessionAlias`). The web client already sends `sessionAlias` on command sends (see Task 8). If `sessionAlias` is absent, nothing is persisted (no crash).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/packages/relay/http-app.test.ts`
Expected: PASS (all tests in the file, including the existing prompt-echo test, still green).

- [ ] **Step 5: Typecheck**

Run: `bun run build:relay`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/http/app.ts tests/unit/packages/relay/http-app.test.ts
git commit -m "feat(relay): persist command.execute input/output to message cache"
```

---

### Task 2: Retention & GC maintenance subsystem (history retention + finding #5)

Add pruning so the `messages` cache and expired-token tables don't grow forever. Server-configured retention (age + per-session cap), expired-row GC for `web_sessions`/`invites`/`pairing_tokens`, a periodic loop, and a read-only `GET /api/config` for the settings page.

**Files:**
- Modify: `packages/relay/src/stores/messages.ts` (add `prune`)
- Modify: `packages/relay/src/stores/accounts.ts` (add `pruneExpired`)
- Modify: `packages/relay/src/stores/instances.ts` (add `prunePairingTokens`)
- Create: `packages/relay/src/maintenance.ts`
- Modify: `packages/relay/src/server.ts` (carry retention opts; start loop)
- Modify: `packages/relay/src/http/app.ts` (`GET /api/config`)
- Modify: `packages/relay/src/cli.ts` (`--history-retention-days`)
- Test: `tests/unit/packages/relay/maintenance.test.ts` (new), `tests/unit/packages/relay/http-app.test.ts` (config endpoint)

- [ ] **Step 1: Write the failing store-prune tests**

Create `tests/unit/packages/relay/maintenance.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";
import { MessageStore } from "../../../../packages/relay/src/stores/messages";
import { runMaintenance } from "../../../../packages/relay/src/maintenance";

async function freshDb() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  return db;
}

test("MessageStore.prune deletes rows older than maxAgeMs", async () => {
  const db = await freshDb();
  const acc = new AccountStore(db);
  const a = acc.createAccount("u", "p", "member");
  db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)",
    ["inst", a.id, "pc", "h", new Date("2020-01-01").toISOString()]);
  db.run("INSERT INTO messages (instance_id, session_alias, direction, text, created_at) VALUES (?,?,?,?,?)",
    ["inst", "s", "in", "old", new Date("2020-01-01").toISOString()]);
  db.run("INSERT INTO messages (instance_id, session_alias, direction, text, created_at) VALUES (?,?,?,?,?)",
    ["inst", "s", "in", "new", new Date("2020-06-01").toISOString()]);

  const messages = new MessageStore(db, () => new Date("2020-06-02"));
  const deleted = messages.prune({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 }); // 7 days
  expect(deleted).toBe(1);
  expect(messages.listBySession(a.id, "inst", "s").map((r) => r.text)).toEqual(["new"]);
});

test("MessageStore.prune enforces maxPerSession keeping newest", async () => {
  const db = await freshDb();
  const acc = new AccountStore(db);
  const a = acc.createAccount("u", "p", "member");
  db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)",
    ["inst", a.id, "pc", "h", new Date().toISOString()]);
  const messages = new MessageStore(db);
  for (let i = 0; i < 5; i++) messages.append("inst", "s", "in", `m${i}`);
  const deleted = messages.prune({ maxPerSession: 2 });
  expect(deleted).toBe(3);
  expect(messages.listBySession(a.id, "inst", "s").map((r) => r.text)).toEqual(["m3", "m4"]);
});

test("AccountStore.pruneExpired removes expired web sessions and invites", async () => {
  const db = await freshDb();
  const past = () => new Date("2020-01-01");
  const acc = new AccountStore(db, { now: past });
  const a = acc.createAccount("u", "p", "admin");
  acc.createWebSession(a.id, 1000);  // expires 2020-01-01T00:00:01Z
  acc.createInvite(a.id, 1000);
  const acc2 = new AccountStore(db, { now: () => new Date("2020-02-01") });
  const removed = acc2.pruneExpired(new Date("2020-02-01"));
  expect(removed).toBeGreaterThanOrEqual(2);
});

test("InstanceStore.prunePairingTokens removes expired tokens", async () => {
  const db = await freshDb();
  const acc = new AccountStore(db);
  const a = acc.createAccount("u", "p", "admin");
  // InstanceStore is (db, { now? }); prunePairingTokens takes the clock explicitly,
  // so seed an already-expired token (ttl 1000ms in the past relative to the prune time).
  const instances = new InstanceStore(db, { now: () => new Date("2020-01-01") });
  instances.issuePairingToken(a.id, "pc", 1000);
  const removed = instances.prunePairingTokens(new Date("2020-02-01"));
  expect(removed).toBe(1);
});

test("runMaintenance runs all prunes without throwing", async () => {
  const db = await freshDb();
  const acc = new AccountStore(db);
  const instances = new InstanceStore(db);
  const messages = new MessageStore(db);
  const summary = runMaintenance({ accounts: acc, instances, messages }, { historyRetentionDays: 30, maxPerSession: 2000, now: () => new Date() });
  expect(summary).toMatchObject({ messagesDeleted: expect.any(Number), sessionsDeleted: expect.any(Number), pairingTokensDeleted: expect.any(Number) });
});
```

Confirmed signatures (match exactly): `InstanceStore(db, options: { now?: () => Date } = {})`, `AccountStore(db, options: { now?: () => Date } = {})`, `MessageStore(db, now: () => Date = () => new Date())` (positional). `prunePairingTokens(now)` and `pruneExpired(now)` take the clock as an explicit argument, so the store's internal `now` is irrelevant for those calls — pass the comparison time directly.

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/packages/relay/maintenance.test.ts`
Expected: FAIL — `prune`/`pruneExpired`/`prunePairingTokens`/`runMaintenance` are undefined.

- [ ] **Step 3: Add `MessageStore.prune`**

In `packages/relay/src/stores/messages.ts`, add:

```ts
  /** Deletes messages older than maxAgeMs and/or beyond the newest maxPerSession per (instance, session). Returns rows deleted. */
  prune(opts: { maxAgeMs?: number; maxPerSession?: number }): number {
    let deleted = 0;
    if (opts.maxAgeMs !== undefined) {
      const cutoff = new Date(this.now().getTime() - opts.maxAgeMs).toISOString();
      const before = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE created_at < ?", [cutoff]);
      this.db.run("DELETE FROM messages WHERE created_at < ?", [cutoff]);
      deleted += before?.n ?? 0;
    }
    if (opts.maxPerSession !== undefined) {
      const groups = this.db.all<{ instance_id: string; session_alias: string }>(
        "SELECT instance_id, session_alias FROM messages GROUP BY instance_id, session_alias HAVING COUNT(*) > ?",
        [opts.maxPerSession],
      );
      for (const g of groups) {
        const before = this.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM messages WHERE instance_id = ? AND session_alias = ?",
          [g.instance_id, g.session_alias],
        );
        // Keep the newest maxPerSession rows (highest id); delete the rest.
        this.db.run(
          `DELETE FROM messages WHERE instance_id = ? AND session_alias = ? AND id NOT IN (
             SELECT id FROM messages WHERE instance_id = ? AND session_alias = ? ORDER BY id DESC LIMIT ?
           )`,
          [g.instance_id, g.session_alias, g.instance_id, g.session_alias, opts.maxPerSession],
        );
        deleted += Math.max(0, (before?.n ?? 0) - opts.maxPerSession);
      }
    }
    return deleted;
  }
```

- [ ] **Step 4: Add `AccountStore.pruneExpired`**

In `packages/relay/src/stores/accounts.ts`, add (uses the passed `now` so callers control the clock):

```ts
  /** Deletes expired web sessions and expired/used invites. Returns total rows removed. */
  pruneExpired(now: Date): number {
    const iso = now.toISOString();
    const ws = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM web_sessions WHERE expires_at <= ?", [iso]);
    this.db.run("DELETE FROM web_sessions WHERE expires_at <= ?", [iso]);
    const inv = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM invites WHERE expires_at <= ? OR used_by IS NOT NULL", [iso]);
    this.db.run("DELETE FROM invites WHERE expires_at <= ? OR used_by IS NOT NULL", [iso]);
    return (ws?.n ?? 0) + (inv?.n ?? 0);
  }
```

- [ ] **Step 5: Add `InstanceStore.prunePairingTokens`**

In `packages/relay/src/stores/instances.ts`, add (match the store's existing `now` handling):

```ts
  /** Deletes expired or already-used pairing tokens. Returns rows removed. */
  prunePairingTokens(now: Date): number {
    const iso = now.toISOString();
    const row = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pairing_tokens WHERE expires_at <= ? OR used_at IS NOT NULL", [iso]);
    this.db.run("DELETE FROM pairing_tokens WHERE expires_at <= ? OR used_at IS NOT NULL", [iso]);
    return row?.n ?? 0;
  }
```

- [ ] **Step 6: Create `packages/relay/src/maintenance.ts`**

```ts
import type { AccountStore } from "./stores/accounts.js";
import type { InstanceStore } from "./stores/instances.js";
import type { MessageStore } from "./stores/messages.js";

export interface MaintenanceStores {
  accounts: AccountStore;
  instances: InstanceStore;
  messages: MessageStore;
}

export interface MaintenanceOptions {
  historyRetentionDays: number;
  maxPerSession: number;
  now?: () => Date;
}

export interface MaintenanceSummary {
  messagesDeleted: number;
  sessionsDeleted: number;
  pairingTokensDeleted: number;
}

/** Runs one maintenance pass: prune old/excess messages, GC expired sessions/invites/pairing tokens. */
export function runMaintenance(stores: MaintenanceStores, opts: MaintenanceOptions): MaintenanceSummary {
  const now = (opts.now ?? (() => new Date()))();
  const messagesDeleted = stores.messages.prune({
    maxAgeMs: opts.historyRetentionDays * 24 * 60 * 60 * 1000,
    maxPerSession: opts.maxPerSession,
  });
  const sessionsDeleted = stores.accounts.pruneExpired(now);
  const pairingTokensDeleted = stores.instances.prunePairingTokens(now);
  return { messagesDeleted, sessionsDeleted, pairingTokensDeleted };
}

/** Starts a periodic maintenance loop. Returns a stop function. */
export function startMaintenanceLoop(
  stores: MaintenanceStores,
  opts: MaintenanceOptions,
  intervalMs: number,
  onError?: (err: unknown) => void,
): () => void {
  const tick = () => {
    try {
      runMaintenance(stores, opts);
    } catch (err) {
      onError?.(err);
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
  return () => clearInterval(timer);
}
```

- [ ] **Step 7: Run the maintenance tests to verify they pass**

Run: `bun test tests/unit/packages/relay/maintenance.test.ts`
Expected: PASS (5/5). If `MessageStore.prune`'s `now` default differs from what the test expects, reconcile (the store already accepts `now` via constructor — use it).

- [ ] **Step 8: Wire the loop + `GET /api/config`**

In `packages/relay/src/server.ts`: add `historyRetentionDays?: number` to `StartRelayOptions` (default 30) and a module const `MAX_MESSAGES_PER_SESSION = 2000`. In `startRelayServer`, after the runtime is built, start the loop and tear it down in `close()`:

```ts
  const retention = { historyRetentionDays: options.historyRetentionDays ?? 30, maxPerSession: MAX_MESSAGES_PER_SESSION };
  const stopMaintenance = startMaintenanceLoop(
    { accounts: runtime.accounts, instances: runtime.instances, messages: runtime.messages },
    retention,
    60 * 60 * 1000, // hourly
  );
```

Add `stopMaintenance()` at the start of the existing `close()` async. Import `startMaintenanceLoop` from `./maintenance.js`. Pass `retention` into `createRelayRuntime` options so `createApp` can expose it. Thread `retention` (or just the two numbers) through `CreateRuntimeOptions` → `AppDeps` as `historyRetentionDays`/`maxMessagesPerSession` (both optional, defaulting in `createApp`).

In `packages/relay/src/http/app.ts`, add an authenticated config endpoint (place it after `GET /api/me`):

```ts
  app.get("/api/config", (c) => {
    return c.json({
      historyRetention: {
        days: deps.historyRetentionDays ?? 30,
        maxPerSession: deps.maxMessagesPerSession ?? 2000,
      },
    });
  });
```

Add `historyRetentionDays?: number` and `maxMessagesPerSession?: number` to `AppDeps`.

- [ ] **Step 9: Add the `GET /api/config` test**

Add to `tests/unit/packages/relay/http-app.test.ts` (authenticated):

```ts
test("GET /api/config reports the retention policy", async () => {
  const h = await makeHarness({ historyRetentionDays: 14, maxMessagesPerSession: 500 });
  const res = await h.app.request("/api/config", { headers: { cookie: h.cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ historyRetention: { days: 14, maxPerSession: 500 } });
});
```

If the harness helper doesn't accept overrides, pass the two fields straight into `createApp({ ...deps, historyRetentionDays: 14, maxMessagesPerSession: 500 })` for this test.

- [ ] **Step 10: Add the CLI flag**

In `packages/relay/src/cli.ts`, in the `start` command read `historyRetentionDays: flag(args, "--history-retention-days")` (parse to number; ignore if NaN) and pass it into `startRelayServer`. Add `[--history-retention-days <n>]` to the USAGE string.

- [ ] **Step 11: Run full backend gate**

Run: `bun test tests/unit/packages/relay/maintenance.test.ts && bun test tests/unit/packages/relay/http-app.test.ts && bun run build:relay`
Expected: all PASS / exit 0.

- [ ] **Step 12: Commit**

```bash
git add packages/relay/src/maintenance.ts packages/relay/src/stores/messages.ts packages/relay/src/stores/accounts.ts packages/relay/src/stores/instances.ts packages/relay/src/server.ts packages/relay/src/http/app.ts packages/relay/src/cli.ts tests/unit/packages/relay/maintenance.test.ts tests/unit/packages/relay/http-app.test.ts
git commit -m "feat(relay): retention + expired-token GC maintenance loop and /api/config"
```

---

### Task 3: Frontend `tasks` store (scheduler + orchestration)

A Pinia store holding the selected instance/session's scheduled + orchestration tasks, calling the existing generic `api.rpc`. Re-fetches on `scheduled-changed`/`orchestration-changed` deltas.

**Files:**
- Create: `packages/relay-web/src/stores/tasks.ts`
- Test: `packages/relay-web/src/__tests__/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/tasks.test.ts`. Mirror the mocking style of the existing `instances.test.ts` (which mocks `../api/client`). Mock `api.rpc` and assert load/create/cancel + `applyEvent` re-fetch.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../api/client", () => ({
  api: { rpc: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "../api/client";
import { useTasksStore } from "../stores/tasks";

const rpc = api.rpc as unknown as ReturnType<typeof vi.fn>;

describe("tasks store", () => {
  beforeEach(() => { setActivePinia(createPinia()); rpc.mockReset(); });

  it("loadScheduled stores only the current session's tasks", async () => {
    rpc.mockResolvedValueOnce({ tasks: [
      { id: "1", sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "a", status: "pending", createdAt: "x" },
      { id: "2", sessionAlias: "frontend", executeAt: "2030-01-01T00:00:00Z", message: "b", status: "pending", createdAt: "x" },
    ]});
    const store = useTasksStore();
    await store.loadScheduled("inst", "backend");
    expect(rpc).toHaveBeenCalledWith("inst", "control.scheduled.list");
    expect(store.scheduled.map((t) => t.id)).toEqual(["1"]);
  });

  it("loadOrchestration stores all instance tasks", async () => {
    rpc.mockResolvedValueOnce({ tasks: [{ taskId: "t1", status: "running", targetAgent: "claude", workspace: "/w", task: "x", summary: "", createdAt: "x", updatedAt: "x" }] });
    const store = useTasksStore();
    await store.loadOrchestration("inst");
    expect(rpc).toHaveBeenCalledWith("inst", "control.orchestration.list");
    expect(store.orchestration).toHaveLength(1);
  });

  it("createScheduled posts then reloads", async () => {
    rpc.mockResolvedValueOnce({}); // create
    rpc.mockResolvedValueOnce({ tasks: [] }); // reload
    const store = useTasksStore();
    await store.createScheduled("inst", "backend", "2030-01-01T00:00:00Z", "do it");
    expect(rpc).toHaveBeenNthCalledWith(1, "inst", "control.scheduled.create", { sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "do it" });
    expect(rpc).toHaveBeenNthCalledWith(2, "inst", "control.scheduled.list");
  });

  it("cancelScheduled posts then reloads", async () => {
    rpc.mockResolvedValueOnce({ cancelled: true });
    rpc.mockResolvedValueOnce({ tasks: [] });
    const store = useTasksStore();
    store.scope = { instanceId: "inst", sessionAlias: "backend" };
    await store.cancelScheduled("9");
    expect(rpc).toHaveBeenNthCalledWith(1, "inst", "control.scheduled.cancel", { id: "9" });
  });

  it("applyEvent reloads scheduled for the scoped instance on scheduled-changed", async () => {
    rpc.mockResolvedValue({ tasks: [] });
    const store = useTasksStore();
    store.scope = { instanceId: "inst", sessionAlias: "backend" };
    store.applyEvent({ kind: "control-event", instanceId: "inst", event: { type: "scheduled-changed", chatKey: "relay:a" } });
    expect(rpc).toHaveBeenCalledWith("inst", "control.scheduled.list");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `../stores/tasks` does not exist.

- [ ] **Step 3: Implement the store**

Create `packages/relay-web/src/stores/tasks.ts`:

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import type { OrchestrationTaskDto, ScheduledTaskDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api } from "../api/client";

export interface TasksScope {
  instanceId: string;
  sessionAlias: string;
}

export const useTasksStore = defineStore("tasks", () => {
  const scheduled = ref<ScheduledTaskDto[]>([]);
  const orchestration = ref<OrchestrationTaskDto[]>([]);
  const scope = ref<TasksScope | null>(null);

  async function loadScheduled(instanceId: string, sessionAlias: string): Promise<void> {
    const { tasks } = await api.rpc<{ tasks: ScheduledTaskDto[] }>(instanceId, "control.scheduled.list");
    scheduled.value = tasks.filter((t) => t.sessionAlias === sessionAlias);
  }

  async function loadOrchestration(instanceId: string): Promise<void> {
    const { tasks } = await api.rpc<{ tasks: OrchestrationTaskDto[] }>(instanceId, "control.orchestration.list");
    orchestration.value = tasks;
  }

  async function loadFor(instanceId: string, sessionAlias: string): Promise<void> {
    scope.value = { instanceId, sessionAlias };
    await Promise.all([
      loadScheduled(instanceId, sessionAlias).catch(() => { scheduled.value = []; }),
      loadOrchestration(instanceId).catch(() => { orchestration.value = []; }),
    ]);
  }

  async function createScheduled(instanceId: string, sessionAlias: string, executeAt: string, message: string): Promise<void> {
    await api.rpc(instanceId, "control.scheduled.create", { sessionAlias, executeAt, message });
    await loadScheduled(instanceId, sessionAlias);
  }

  async function cancelScheduled(id: string): Promise<void> {
    const s = scope.value;
    if (!s) return;
    await api.rpc(s.instanceId, "control.scheduled.cancel", { id });
    await loadScheduled(s.instanceId, s.sessionAlias);
  }

  async function cancelOrchestration(taskId: string): Promise<void> {
    const s = scope.value;
    if (!s) return;
    await api.rpc(s.instanceId, "control.orchestration.cancel", { taskId });
    await loadOrchestration(s.instanceId);
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "control-event") return;
    const s = scope.value;
    if (!s || event.instanceId !== s.instanceId) return;
    if (event.event.type === "scheduled-changed") void loadScheduled(s.instanceId, s.sessionAlias).catch(() => {});
    else if (event.event.type === "orchestration-changed") void loadOrchestration(s.instanceId).catch(() => {});
  }

  return { scheduled, orchestration, scope, loadScheduled, loadOrchestration, loadFor, createScheduled, cancelScheduled, cancelOrchestration, applyEvent };
});
```

Note: `cancelScheduled` sends only `{ id }`; the relay stamps `chatKey` server-side (scheduled.cancel is chat-scoped). The test for `cancelScheduled` sets `store.scope` directly — confirm the store exposes `scope` as a writable ref (it does, returned above).

- [ ] **Step 4: Run to verify pass**

Run: `bun run --cwd packages/relay-web test`
Expected: PASS (the 5 new tests plus the existing suites).

- [ ] **Step 5: Typecheck/build**

Run: `bun run build:relay-web`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/stores/tasks.ts packages/relay-web/src/__tests__/tasks.test.ts
git commit -m "feat(relay-web): tasks store for scheduler and orchestration"
```

---

### Task 4: Right-column task panel components + DashboardView wiring

Render the scheduler (list/create/cancel) and orchestration (list/cancel) sections in the right column, scoped to the selected session, and dispatch task deltas. The column shows an empty hint when no session is selected.

**Files:**
- Create: `packages/relay-web/src/components/ScheduledTasks.vue`, `OrchestrationTasks.vue`, `TaskPanel.vue`
- Modify: `packages/relay-web/src/views/DashboardView.vue`
- Test: `packages/relay-web/src/__tests__/taskpanel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/taskpanel.test.ts`. Use `@vue/test-utils` `mount` with a real pinia (as `dashboard.test.ts` does). Pre-seed the tasks store, mount `TaskPanel`, assert rows render and that the cancel button calls the store action (spy on it).

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TaskPanel from "../components/TaskPanel.vue";
import { useTasksStore } from "../stores/tasks";
import { useChatStore } from "../stores/chat";

describe("TaskPanel", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows a hint when no session is selected", () => {
    const w = mount(TaskPanel);
    expect(w.text()).toContain("No session selected");
  });

  it("renders scheduled and orchestration rows for the selected session", async () => {
    const chat = useChatStore();
    chat.select("inst", "backend");
    const tasks = useTasksStore();
    tasks.scope = { instanceId: "inst", sessionAlias: "backend" };
    tasks.scheduled = [{ id: "1", sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "ping", status: "pending", createdAt: "x" }] as never;
    tasks.orchestration = [{ taskId: "t1", status: "running", targetAgent: "claude", workspace: "/w", task: "build", summary: "", createdAt: "x", updatedAt: "x" }] as never;
    const w = mount(TaskPanel);
    await w.vm.$nextTick();
    expect(w.text()).toContain("ping");
    expect(w.text()).toContain("build");
  });

  it("cancel button invokes cancelScheduled", async () => {
    const chat = useChatStore();
    chat.select("inst", "backend");
    const tasks = useTasksStore();
    tasks.scope = { instanceId: "inst", sessionAlias: "backend" };
    tasks.scheduled = [{ id: "9", sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "ping", status: "pending", createdAt: "x" }] as never;
    const spy = vi.spyOn(tasks, "cancelScheduled").mockResolvedValue();
    const w = mount(TaskPanel);
    await w.find('[data-test="cancel-scheduled"]').trigger("click");
    expect(spy).toHaveBeenCalledWith("9");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `../components/TaskPanel.vue` does not exist.

- [ ] **Step 3: Implement `ScheduledTasks.vue`**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useTasksStore } from "../stores/tasks";
import { useChatStore } from "../stores/chat";

const tasks = useTasksStore();
const chat = useChatStore();
const executeAt = ref("");
const message = ref("");

async function create() {
  if (!chat.instanceId || !chat.sessionAlias || !executeAt.value || !message.value) return;
  // datetime-local yields "YYYY-MM-DDTHH:mm"; send as ISO.
  const iso = new Date(executeAt.value).toISOString();
  await tasks.createScheduled(chat.instanceId, chat.sessionAlias, iso, message.value);
  executeAt.value = "";
  message.value = "";
}
</script>

<template>
  <div class="border-b p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Scheduled</h3>
    <ul class="space-y-1">
      <li v-for="t in tasks.scheduled" :key="t.id" class="flex items-center justify-between text-sm">
        <span class="truncate"><span class="text-slate-400">{{ new Date(t.executeAt).toLocaleString() }}</span> {{ t.message }}</span>
        <button data-test="cancel-scheduled" class="ml-2 text-xs text-red-500 hover:underline" @click="tasks.cancelScheduled(t.id)">cancel</button>
      </li>
      <li v-if="tasks.scheduled.length === 0" class="text-xs text-slate-400">No scheduled tasks.</li>
    </ul>
    <form class="mt-2 space-y-1" @submit.prevent="create">
      <input v-model="executeAt" type="datetime-local" class="w-full rounded border px-1 py-0.5 text-xs" />
      <input v-model="message" placeholder="message" class="w-full rounded border px-1 py-0.5 text-xs" />
      <button type="submit" class="w-full rounded bg-slate-700 px-2 py-1 text-xs text-white">Schedule</button>
    </form>
  </div>
</template>
```

- [ ] **Step 4: Implement `OrchestrationTasks.vue`**

```vue
<script setup lang="ts">
import { useTasksStore } from "../stores/tasks";

const tasks = useTasksStore();
</script>

<template>
  <div class="p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Orchestration</h3>
    <ul class="space-y-1">
      <li v-for="t in tasks.orchestration" :key="t.taskId" class="flex items-center justify-between text-sm">
        <span class="truncate">{{ t.task }} <span class="text-xs text-slate-400">({{ t.status }})</span></span>
        <button data-test="cancel-orchestration" class="ml-2 text-xs text-red-500 hover:underline" @click="tasks.cancelOrchestration(t.taskId)">cancel</button>
      </li>
      <li v-if="tasks.orchestration.length === 0" class="text-xs text-slate-400">No orchestration tasks.</li>
    </ul>
  </div>
</template>
```

- [ ] **Step 5: Implement `TaskPanel.vue`**

```vue
<script setup lang="ts">
import { watch } from "vue";
import { useChatStore } from "../stores/chat";
import { useTasksStore } from "../stores/tasks";
import ScheduledTasks from "./ScheduledTasks.vue";
import OrchestrationTasks from "./OrchestrationTasks.vue";

const chat = useChatStore();
const tasks = useTasksStore();

watch(
  () => [chat.instanceId, chat.sessionAlias] as const,
  ([id, alias]) => { if (id && alias) void tasks.loadFor(id, alias); },
  { immediate: true },
);
</script>

<template>
  <div v-if="chat.instanceId && chat.sessionAlias">
    <ScheduledTasks />
    <OrchestrationTasks />
  </div>
  <div v-else class="p-4 text-sm text-slate-400">No session selected.</div>
</template>
```

- [ ] **Step 6: Wire into `DashboardView.vue`**

Replace the placeholder right column (lines 37-39) with `<TaskPanel />`, import it and `useTasksStore`, and dispatch task events. Update the `connectEvents` callback (lines 20-23) to also call `tasks.applyEvent(event)`:

```ts
import TaskPanel from "../components/TaskPanel.vue";
import { useTasksStore } from "../stores/tasks";
// ...
const tasks = useTasksStore();
// in onMounted connectEvents callback:
disconnect = connectEvents((event) => {
  instances.applyEvent(event);
  chat.applyEvent(event);
  tasks.applyEvent(event);
});
```

Right column template:

```html
    <div data-test="column" class="hidden w-72 shrink-0 border-l bg-white lg:block">
      <TaskPanel />
    </div>
```

- [ ] **Step 7: Run to verify pass**

Run: `bun run --cwd packages/relay-web test`
Expected: PASS (new taskpanel tests + existing dashboard tests). If the existing `dashboard.test.ts` asserts on the placeholder text "Tasks panel — phase 4", update that assertion to the new "No session selected." hint.

- [ ] **Step 8: Build**

Run: `bun run build:relay-web`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/relay-web/src/components/ScheduledTasks.vue packages/relay-web/src/components/OrchestrationTasks.vue packages/relay-web/src/components/TaskPanel.vue packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/taskpanel.test.ts packages/relay-web/src/__tests__/dashboard.test.ts
git commit -m "feat(relay-web): right-column scheduler + orchestration task panel"
```

---

### Task 5: Instance-notice rendering (finding: notice variant unrendered)

The `notice` web-event variant is produced, fanned out, and parsed, but no frontend consumer renders it. Add a `notices` store and a `NoticeToast` that surfaces the most recent notices, dispatched from DashboardView.

**Files:**
- Create: `packages/relay-web/src/stores/notices.ts`, `packages/relay-web/src/components/NoticeToast.vue`
- Modify: `packages/relay-web/src/views/DashboardView.vue`
- Test: `packages/relay-web/src/__tests__/notices.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/notices.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNoticesStore } from "../stores/notices";

describe("notices store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("appends notice events and caps the list at 20", () => {
    const store = useNoticesStore();
    for (let i = 0; i < 25; i++) {
      store.applyEvent({ kind: "notice", instanceId: "inst", notice: { kind: "task-completion", text: `done ${i}` } });
    }
    expect(store.items).toHaveLength(20);
    expect(store.items[0].text).toBe("done 24"); // newest first
  });

  it("ignores non-notice events", () => {
    const store = useNoticesStore();
    store.applyEvent({ kind: "instance-status", instanceId: "inst", online: true });
    expect(store.items).toHaveLength(0);
  });

  it("dismiss removes a notice by id", () => {
    const store = useNoticesStore();
    store.applyEvent({ kind: "notice", instanceId: "inst", notice: { kind: "task-progress", text: "x" } });
    const id = store.items[0].id;
    store.dismiss(id);
    expect(store.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `../stores/notices` does not exist.

- [ ] **Step 3: Implement the store**

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import type { WebServerEvent } from "@ganglion/xacpx-relay-protocol";

export interface NoticeItem {
  id: number;
  instanceId: string;
  kind: string;
  text: string;
}

const MAX = 20;

export const useNoticesStore = defineStore("notices", () => {
  const items = ref<NoticeItem[]>([]);
  let seq = 0;

  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "notice") return;
    items.value.unshift({ id: ++seq, instanceId: event.instanceId, kind: event.notice.kind, text: event.notice.text });
    if (items.value.length > MAX) items.value.length = MAX;
  }

  function dismiss(id: number): void {
    items.value = items.value.filter((n) => n.id !== id);
  }

  return { items, applyEvent, dismiss };
});
```

Note: do not use `Date.now()` for ids (kept deterministic and lint-safe) — a monotonic `seq` counter is sufficient and test-friendly.

- [ ] **Step 4: Implement `NoticeToast.vue`**

```vue
<script setup lang="ts">
import { useNoticesStore } from "../stores/notices";

const notices = useNoticesStore();
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
    <div
      v-for="n in notices.items.slice(0, 4)"
      :key="n.id"
      data-test="notice"
      class="pointer-events-auto rounded bg-slate-800 px-3 py-2 text-sm text-white shadow"
    >
      <div class="flex items-start justify-between gap-2">
        <span><span class="text-xs uppercase text-slate-400">{{ n.kind }}</span><br />{{ n.text }}</span>
        <button class="text-xs text-slate-400 hover:text-white" @click="notices.dismiss(n.id)">×</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Dispatch from `DashboardView.vue`**

Import `useNoticesStore` + `NoticeToast`, add `const notices = useNoticesStore();`, call `notices.applyEvent(event)` in the `connectEvents` callback, and add `<NoticeToast />` at the end of the root template div.

- [ ] **Step 6: Run + build**

Run: `bun run --cwd packages/relay-web test && bun run build:relay-web`
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-web/src/stores/notices.ts packages/relay-web/src/components/NoticeToast.vue packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/notices.test.ts
git commit -m "feat(relay-web): render instance notices as toasts"
```

---

### Task 6: Settings view (invites + pairing + retention display)

A `/settings` route with three sections: generate account invite (admin only), generate instance pairing token (shows the `xacpx channel add relay` command), and a read-only history-retention summary from `GET /api/config`. Reuses existing endpoints; only retention display is new.

**Files:**
- Create: `packages/relay-web/src/views/SettingsView.vue`
- Modify: `packages/relay-web/src/router/index.ts`
- Modify: `packages/relay-web/src/views/DashboardView.vue` (a nav link to settings + logout)
- Test: `packages/relay-web/src/__tests__/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/settings.test.ts`. Mock `../api/client` (`api.get`/`api.post`), seed auth store role, mount `SettingsView`, assert: retention loads on mount; pairing button shows a token + the install command; the invite section is hidden for members and visible for admins.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "../api/client";
import SettingsView from "../views/SettingsView.vue";
import { useAuthStore } from "../stores/auth";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

describe("SettingsView", () => {
  beforeEach(() => { setActivePinia(createPinia()); get.mockReset(); post.mockReset(); });

  it("loads and shows the retention policy", async () => {
    get.mockResolvedValueOnce({ historyRetention: { days: 30, maxPerSession: 2000 } });
    const w = mount(SettingsView, { global: { stubs: { "router-link": true } } });
    await flushPromises();
    expect(get).toHaveBeenCalledWith("/api/config");
    expect(w.text()).toContain("30");
  });

  it("hides the invite section for members", async () => {
    get.mockResolvedValueOnce({ historyRetention: { days: 30, maxPerSession: 2000 } });
    const auth = useAuthStore();
    auth.account = { username: "m", role: "member" };
    const w = mount(SettingsView, { global: { stubs: { "router-link": true } } });
    await flushPromises();
    expect(w.find('[data-test="invite-section"]').exists()).toBe(false);
  });

  it("admin can generate an invite", async () => {
    get.mockResolvedValueOnce({ historyRetention: { days: 30, maxPerSession: 2000 } });
    post.mockResolvedValueOnce({ invite: "INV123", expiresAt: "2030-01-01T00:00:00Z" });
    const auth = useAuthStore();
    auth.account = { username: "a", role: "admin" };
    const w = mount(SettingsView, { global: { stubs: { "router-link": true } } });
    await flushPromises();
    await w.find('[data-test="gen-invite"]').trigger("click");
    await flushPromises();
    expect(post).toHaveBeenCalledWith("/api/invites");
    expect(w.text()).toContain("INV123");
  });

  it("generates a pairing token and shows the install command", async () => {
    get.mockResolvedValueOnce({ historyRetention: { days: 30, maxPerSession: 2000 } });
    post.mockResolvedValueOnce({ token: "PAIR9", expiresAt: "2030-01-01T00:00:00Z" });
    const auth = useAuthStore();
    auth.account = { username: "a", role: "admin" };
    const w = mount(SettingsView, { global: { stubs: { "router-link": true } } });
    await flushPromises();
    await w.find('[data-test="gen-pairing"]').trigger("click");
    await flushPromises();
    expect(post).toHaveBeenCalledWith("/api/instances/pairing-token", { name: "" });
    expect(w.text()).toContain("PAIR9");
    expect(w.text()).toContain("channel add relay");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `../views/SettingsView.vue` does not exist.

- [ ] **Step 3: Implement `SettingsView.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const retention = ref<{ days: number; maxPerSession: number } | null>(null);
const invite = ref("");
const pairing = ref("");
const pairingName = ref("");

onMounted(async () => {
  try {
    const cfg = await api.get<{ historyRetention: { days: number; maxPerSession: number } }>("/api/config");
    retention.value = cfg.historyRetention;
  } catch { /* leave null; UI shows a dash */ }
});

async function genInvite() {
  const r = await api.post<{ invite: string }>("/api/invites");
  invite.value = r.invite;
}

async function genPairing() {
  const r = await api.post<{ token: string }>("/api/instances/pairing-token", { name: pairingName.value });
  pairing.value = r.token;
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-6">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-lg font-semibold">Settings</h1>
      <router-link to="/" class="text-sm text-slate-500 hover:underline">← Back</router-link>
    </header>

    <section class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-slate-500">Add an instance</h2>
      <div class="flex gap-2">
        <input v-model="pairingName" placeholder="instance name (optional)" class="flex-1 rounded border px-2 py-1 text-sm" />
        <button data-test="gen-pairing" class="rounded bg-slate-700 px-3 py-1 text-sm text-white" @click="genPairing">Generate token</button>
      </div>
      <div v-if="pairing" class="mt-2 rounded bg-slate-100 p-2 text-xs">
        <div>Run on the xacpx host:</div>
        <code class="block break-all">xacpx channel add relay --url &lt;this-relay-ws-url&gt; --token {{ pairing }}</code>
      </div>
    </section>

    <section v-if="auth.account?.role === 'admin'" data-test="invite-section" class="mb-8">
      <h2 class="mb-2 text-sm font-semibold uppercase text-slate-500">Invite an account</h2>
      <button data-test="gen-invite" class="rounded bg-slate-700 px-3 py-1 text-sm text-white" @click="genInvite">Generate invite</button>
      <div v-if="invite" class="mt-2 rounded bg-slate-100 p-2 text-xs break-all">Invite token: <code>{{ invite }}</code></div>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase text-slate-500">History retention</h2>
      <p class="text-sm text-slate-600">
        Keeps the newest <strong>{{ retention?.maxPerSession ?? "—" }}</strong> messages per session,
        for up to <strong>{{ retention?.days ?? "—" }}</strong> days. Configured server-side.
      </p>
    </section>
  </div>
</template>
```

- [ ] **Step 4: Add the route**

In `packages/relay-web/src/router/index.ts`, add to `routes`:

```ts
  { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
```

The existing `beforeEach` guard already protects any route that isn't `login`, so `/settings` is auth-gated automatically.

- [ ] **Step 5: Add a nav link in `DashboardView.vue`**

Add a small top bar or a link in the left column header to `/settings` and a logout action. Minimal approach — add above `<InstanceTree />` in the left column:

```html
      <div class="flex items-center justify-between border-b p-2 text-xs">
        <router-link to="/settings" class="text-slate-500 hover:underline">Settings</router-link>
        <button class="text-slate-500 hover:underline" @click="onLogout">Logout</button>
      </div>
```

Add to the script: `import { useRouter } from "vue-router"; import { useAuthStore } from "../stores/auth";` and:

```ts
const auth = useAuthStore();
const router = useRouter();
async function onLogout() { await auth.logout(); router.push({ name: "login" }); }
```

If `dashboard.test.ts` mounts `DashboardView` without a router, add `global: { stubs: { "router-link": true } }` and/or a `useRouter` mock there (update that test as needed — keep it green).

- [ ] **Step 6: Run + build**

Run: `bun run --cwd packages/relay-web test && bun run build:relay-web`
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-web/src/views/SettingsView.vue packages/relay-web/src/router/index.ts packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/settings.test.ts packages/relay-web/src/__tests__/dashboard.test.ts
git commit -m "feat(relay-web): settings page for invites, pairing, and retention"
```

---

### Task 7: Error-recovery polish (connection status + error surfacing + finding #3)

Surface connection loss/restore, surface RPC errors in chat, and add the missing `.catch` on fire-and-forget `loadSessions`.

**Files:**
- Modify: `packages/relay-web/src/api/events.ts` (add `onStatus`)
- Create: `packages/relay-web/src/stores/connection.ts`
- Create: `packages/relay-web/src/components/ConnectionBadge.vue`
- Modify: `packages/relay-web/src/stores/chat.ts` (error surfacing)
- Modify: `packages/relay-web/src/stores/instances.ts` (`.catch` finding #3)
- Modify: `packages/relay-web/src/views/DashboardView.vue` (pass onStatus; mount badge)
- Test: `packages/relay-web/src/__tests__/connection.test.ts`, extend `chat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/relay-web/src/__tests__/connection.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../stores/connection";

describe("connection store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("defaults to disconnected then reflects status", () => {
    const s = useConnectionStore();
    expect(s.online).toBe(false);
    s.setOnline(true);
    expect(s.online).toBe(true);
    s.setOnline(false);
    expect(s.online).toBe(false);
  });
});
```

Add to `packages/relay-web/src/__tests__/chat.test.ts` a case asserting a failed send sets `chat.error` and clears `sending` (mock `api.rpc` to reject with `ApiError`):

```ts
it("surfaces an error when send fails", async () => {
  rpc.mockRejectedValueOnce(new ApiError("instance-offline", 503));
  const chat = useChatStore();
  chat.select("inst", "backend");
  await chat.send("hello");
  expect(chat.error).toBe("instance-offline");
  expect(chat.sending).toBe(false);
});
```

(Import `ApiError` from the mocked client — ensure the existing `chat.test.ts` mock exports an `ApiError` class.)

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `../stores/connection` missing; `chat.error` undefined.

- [ ] **Step 3: Implement the connection store**

```ts
import { defineStore } from "pinia";
import { ref } from "vue";

export const useConnectionStore = defineStore("connection", () => {
  const online = ref(false);
  function setOnline(v: boolean): void { online.value = v; }
  return { online, setOnline };
});
```

- [ ] **Step 4: Add `onStatus` to `connectEvents`**

In `packages/relay-web/src/api/events.ts`, change the signature to `connectEvents(onEvent, onStatus?: (online: boolean) => void)`; call `onStatus?.(true)` in `socket.onopen` and `onStatus?.(false)` in `socket.onclose` (before scheduling the retry). Keep auto-reconnect intact.

- [ ] **Step 5: Implement `ConnectionBadge.vue`**

```vue
<script setup lang="ts">
import { useConnectionStore } from "../stores/connection";
const conn = useConnectionStore();
</script>

<template>
  <div v-if="!conn.online" data-test="conn-badge" class="bg-amber-100 px-3 py-1 text-center text-xs text-amber-800">
    Reconnecting…
  </div>
</template>
```

- [ ] **Step 6: Error surfacing in `chat.ts`**

Add `const error = ref("");` to the store state; in `send`, wrap the rpc calls so a thrown `ApiError` sets `error.value = e.code` (else `"send-failed"`); clear `error.value = ""` at the start of `send`. Return `error` from the store. Keep the optimistic in-message push, but on failure you may append a system note — minimum requirement is setting `error`.

- [ ] **Step 7: `.catch` on fire-and-forget loadSessions (finding #3)**

In `packages/relay-web/src/stores/instances.ts` `applyEvent`, change `void loadSessions(event.instanceId);` to `void loadSessions(event.instanceId).catch(() => {});`. Also in `DashboardView.onSelect`, `void chat.loadHistory();` → add `.catch(() => {})`.

- [ ] **Step 8: Wire status + badge in `DashboardView.vue`**

Import `useConnectionStore` + `ConnectionBadge`; pass the status callback: `connectEvents((event) => {...}, (online) => conn.setOnline(online))`; render `<ConnectionBadge />` at the top of the root template (above the columns).

- [ ] **Step 9: Run + build**

Run: `bun run --cwd packages/relay-web test && bun run build:relay-web`
Expected: PASS / exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/relay-web/src/api/events.ts packages/relay-web/src/stores/connection.ts packages/relay-web/src/components/ConnectionBadge.vue packages/relay-web/src/stores/chat.ts packages/relay-web/src/stores/instances.ts packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/connection.test.ts packages/relay-web/src/__tests__/chat.test.ts
git commit -m "feat(relay-web): connection status badge and chat error surfacing"
```

---

### Task 8: Per-session streaming buffer (finding #4)

`chat.streaming` is a single string, so switching sessions mid-stream drops the live stream. Key the streaming buffer by `(instanceId, sessionAlias)` so the in-progress turn for the selected session is preserved across switches. Also ensure command sends carry `sessionAlias` (needed by Task 1's persistence).

**Files:**
- Modify: `packages/relay-web/src/stores/chat.ts`
- Test: extend `packages/relay-web/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `chat.test.ts`:

```ts
it("keeps a per-session streaming buffer across selection changes", () => {
  const chat = useChatStore();
  chat.select("inst", "A");
  chat.applyEvent({ kind: "control-event", instanceId: "inst", event: { type: "turn-output", chatKey: "relay:x", sessionAlias: "A", chunk: "partial-A" } });
  // switch to B then back to A; the in-progress A stream must survive
  chat.select("inst", "B");
  expect(chat.streaming).toBe("");
  chat.select("inst", "A");
  expect(chat.streaming).toBe("partial-A");
});
```

Also assert command send includes sessionAlias:

```ts
it("command send carries sessionAlias", async () => {
  rpc.mockResolvedValueOnce({ output: "ok" });
  const chat = useChatStore();
  chat.select("inst", "backend");
  await chat.send("/status");
  expect(rpc).toHaveBeenCalledWith("inst", "control.command.execute", { sessionAlias: "backend", text: "/status" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --cwd packages/relay-web test`
Expected: FAIL — `select("inst","B")` then back to `"A"` loses the buffer (current code resets `streaming` to `""` on select); command send omits `sessionAlias`.

- [ ] **Step 3: Refactor streaming to a keyed map + computed**

In `packages/relay-web/src/stores/chat.ts`:
- Replace `const streaming = ref("")` with a buffer map and a computed for the current selection:

```ts
import { computed, ref } from "vue";
// ...
const streamBuffers = ref<Record<string, string>>({});
const streaming = computed(() => {
  if (!instanceId.value || !sessionAlias.value) return "";
  return streamBuffers.value[`${instanceId.value} ${sessionAlias.value}`] ?? "";
});
```

- In `select`, do NOT clear the buffer for other sessions; only reset `messages`. Remove the `streaming.value = ""` line (it's now computed). Keep `messages.value = []`.
- In `applyEvent`, write to the keyed buffer instead of the scalar. For `turn-output`: `const k = \`${event.instanceId} ${e.sessionAlias}\`; streamBuffers.value[k] = (streamBuffers.value[k] ?? "") + e.chunk;` — and drop the `event.instanceId !== instanceId.value` early-return for buffering so background sessions still accumulate (but keep the message-push behavior). For `turn-finished`: read the keyed buffer, push the completed message into `messages` only if it is the currently selected session, then delete the key. (Background completed turns are re-fetched via `loadHistory` when selected.)
- Update `send` for command: `await api.rpc(instanceId.value, "control.command.execute", { sessionAlias: sessionAlias.value, text });`
- Keep returning `streaming` (now a computed) from the store.

Reference implementation of the new `applyEvent`:

```ts
  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "control-event") return;
    const e = event.event;
    if (e.type === "turn-output") {
      const k = `${event.instanceId} ${e.sessionAlias}`;
      streamBuffers.value[k] = (streamBuffers.value[k] ?? "") + e.chunk;
    } else if (e.type === "turn-finished") {
      const k = `${event.instanceId} ${e.sessionAlias}`;
      const text = streamBuffers.value[k];
      delete streamBuffers.value[k];
      if (text && event.instanceId === instanceId.value && e.sessionAlias === sessionAlias.value) {
        messages.value.push({ instanceId: event.instanceId, sessionAlias: e.sessionAlias, direction: "out", text, createdAt: new Date().toISOString() });
      }
    }
  }
```

Note: `new Date().toISOString()` runs in the browser (Vitest/jsdom) — it is fine here; the Workflow-script `Date` restriction does NOT apply to app/runtime code.

- [ ] **Step 4: Run to verify pass**

Run: `bun run --cwd packages/relay-web test`
Expected: PASS (new + existing chat tests). Confirm the existing turn-output/turn-finished tests still pass with the keyed buffer.

- [ ] **Step 5: Build**

Run: `bun run build:relay-web`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/__tests__/chat.test.ts
git commit -m "fix(relay-web): per-session streaming buffer; command send carries sessionAlias"
```

---

### Task 9: Docs, spec status & memory

Document the new surface and mark phase 4 done.

**Files:**
- Modify: `docs/relay-web-module.md` (task panel, notices, settings, connection, per-session streaming)
- Modify: `docs/relay-module.md` (maintenance loop, `/api/config`, command-echo persistence)
- Modify: `docs/superpowers/specs/2026-06-13-relay-hub-design.md` (§11 phase-4 → implemented; note retention is server-config-only)
- Modify: `AGENTS.md` only if a genuinely new nav entry is needed (the relay-web doc link already exists — likely no change). Do NOT edit `CLAUDE.md` (symlink).
- Memory: update `project_relay_hub_multiphase.md`.

- [ ] **Step 1: Update `docs/relay-web-module.md`**

Add sections describing: `stores/tasks.ts` (scheduler chat-scoped + session-filtered, orchestration instance-level), `stores/notices.ts` + `NoticeToast`, `stores/connection.ts` + `ConnectionBadge`, `views/SettingsView.vue` (+ `/settings` route), per-session streaming buffer, and the DashboardView event-dispatch fan-out (instances/chat/tasks/notices + onStatus). Note the design decision that scheduler is session-filtered and orchestration is instance-level.

- [ ] **Step 2: Update `docs/relay-module.md`**

Document: the maintenance loop (`src/maintenance.ts`, hourly, `--history-retention-days`, 2000/session cap, expired web_sessions/invites/pairing_tokens GC), `GET /api/config`, and that `control.command.execute` input+output is now echoed into the `messages` cache (alongside the existing `control.prompt` echo).

- [ ] **Step 3: Update spec §11**

Change the phase-4 line from `【待做】` to implemented, listing what shipped (task panels, settings, notices, connection recovery, retention/GC) and noting history-retention is server-configured (not web-editable) in v1.

- [ ] **Step 4: Update memory `project_relay_hub_multiphase.md`**

Update the frontmatter `description` and body: phase 4 complete on stacked branch `feat/relay-hub-phase4-task-panels`; list deliverables; mark the four non-blocking findings resolved; note the orchestration-scoping design decision; keep the release prerequisite (core must ship 0.11.0 to carry phases 1–4). Update the `MEMORY.md` index hook line accordingly.

- [ ] **Step 5: Commit**

```bash
git add docs/relay-web-module.md docs/relay-module.md docs/superpowers/specs/2026-06-13-relay-hub-design.md
git commit -m "docs(relay): phase-4 task panels, settings, maintenance, /api/config"
```

(Memory files live outside the repo working tree under `~/.claude/...`; update them with the Write tool, not via git.)

---

## Final Review

After all tasks: dispatch a whole-branch code review (most capable model) covering security (no identity forgery via the new RPCs; admin-only invite still enforced; `/api/config` leaks no secrets), correctness (prune SQL keeps newest rows; per-session streaming buffer has no leak across instance offline), and spec compliance (§11 phase-4 scope). Then run the full gate:

```bash
npm test && bun run build:relay-protocol && bun run build:relay && bun run build:relay-web
```

Expected: all green / exit 0. Finish via superpowers:finishing-a-development-branch (the user keeps phase branches unmerged/unpushed, matching phases 1–3).
