# Relay Hub Phase 3 — Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `relay-web` Vue 3 dashboard (login + left instance/session tree + middle chat flow) plus the relay-server seams it needs — a web-facing WebSocket event fan-out, a chat-history cache table, and the web↔relay protocol DTOs.

**Architecture:** Phase 2 already exposes the instance gateway, the HTTP API (`/api/login`, `/api/instances`, `/api/instances/:id/rpc` with server-side identity stamping), and a declared-but-unwired `InstanceGateway.onEvent` hook. Phase 3 wires that hook so control events from instances (a) get cached as chat history and (b) fan out over a new authenticated `/ws` endpoint to the account's browser clients. The `relay-web` SPA consumes the existing REST API for snapshots/commands and the new `/ws` stream for live updates, assembling a "snapshot + event delta" model in Pinia stores.

**Tech Stack:** Backend — TypeScript, Hono, `ws`, `@hono/node-server`, `node:sqlite`/`bun:sqlite` via the existing `SqlDriver`. Frontend — Vue 3 + Vite + Pinia + vue-router + Tailwind CSS v3; tested with Vitest + `@vue/test-utils` + jsdom.

**Scope (per spec §11):** Phase 3 is **login + left session tree + middle chat flow** only. The right-column task panels (scheduled/orchestration), the settings page, and the instance-pairing UI are **phase 4**. Instances are paired via the existing phase-2 CLI (`xacpx channel add relay`); the dashboard only lists/uses instances that already exist.

---

## Context for the implementer (read before starting)

You are extending an existing monorepo. Key existing files you will touch or depend on:

- `packages/relay-protocol/src/dtos.ts` — wire DTOs (`SessionDto`, `ScheduledTaskDto`, `OrchestrationTaskDto`, `ControlEventDto`). **Keep this package free of any `xacpx`/`weacpx` imports — it is zero-dependency.**
- `packages/relay-protocol/src/messages.ts` — `MSG` consts (instance↔relay), `errorPayload`, payload/result interfaces, `InstanceNoticePayload`.
- `packages/relay-protocol/src/envelope.ts` — `RelayEnvelope`, `RELAY_PROTOCOL_VERSION`, `encodeEnvelope`, `decodeEnvelope`.
- `packages/relay/src/db.ts` — `SqlDriver`, `createSqlDriver`, `initSchema` (5 tables; **no `messages` table yet**).
- `packages/relay/src/stores/instances.ts` — `InstanceStore` with `getOwned(id, accountId)`, `listByAccount`, `touch`.
- `packages/relay/src/gateway/instance-gateway.ts` — `InstanceGateway`, `GatewaySocket`, `InstanceGatewayDeps { instances, requestTimeoutMs?, onEvent? }`.
- `packages/relay/src/http/app.ts` — `createApp(deps)`, `AppDeps`, `CHAT_SCOPED_TYPES`, the rpc proxy.
- `packages/relay/src/server.ts` — `createRelayRuntime(dbPath)`, `startRelayServer(options)`, `RelayRuntime`.
- `packages/relay/src/cli.ts` — `runRelayCli(args, io)`.
- `tests/unit/packages/relay/integration.test.ts` — the end-to-end harness pattern (real runtime + real `ws` + fake control). Model new integration tests on this.

**Conventions that MUST hold:**
- snake_case in SQL rows → camelCase in wire DTOs (mapping lives in the relay package, never leaks `chat_key`/secrets).
- Server stamps identity (`chatKey`/`senderId`/`isOwner`) — clients never forge it. Web clients are already authenticated by cookie; the rpc proxy already stamps. Do not weaken this.
- All instance/session/message queries are account-scoped.
- Tests run via `npm test` (`scripts/run-tests.mjs`): `tsc --noEmit` then per-file `bun test`. **Never** run a whole-directory `bun test` (module-state leak false failures). Frontend Vitest runs separately (Task 8 wires it in).
- Subagent git hygiene: stage exact paths only. **Never** `git add -A`/`git add .`. Never stage `bun.lock` except the legitimate dependency-install tasks called out below (Tasks 8). Never stage build artifacts (`dist/`, `packages/relay-web/dist/`).
- Build a package's protocol dep before its tests: `scripts/run-tests.mjs` already prebuilds `relay-protocol` dist, so importing `@ganglion/xacpx-relay-protocol` works in tests.

---

## File Structure

**relay-protocol (new + modified):**
- Create `packages/relay-protocol/src/web-dtos.ts` — web↔relay DTOs: `WebServerEvent` union, `MessageDirection`, `MessageRecordDto`, `WEB_EVENT_TYPE`, `webEventEnvelope()`, `parseWebServerEvent()`.
- Modify `packages/relay-protocol/src/index.ts` — re-export `web-dtos.js`.

**relay server (new + modified):**
- Create `packages/relay/src/stores/messages.ts` — `MessageStore` (append/listBySession), account-scoped via join to `instances`.
- Create `packages/relay/src/gateway/web-gateway.ts` — `WebGateway` (per-account web-socket registry + fan-out).
- Modify `packages/relay/src/db.ts` — add the `messages` table to `initSchema`.
- Modify `packages/relay/src/gateway/instance-gateway.ts` — add `onStatusChange` to deps; fire on connect/disconnect.
- Modify `packages/relay/src/http/app.ts` — chat-history endpoint, prompt echo, optional static SPA hosting.
- Modify `packages/relay/src/server.ts` — wire `onEvent`/`onStatusChange` → messages + web fan-out; `/ws` upgrade with cookie auth.
- Modify `packages/relay/src/cli.ts` — `start` accepts `--web-root`.

**relay-web (new package):**
- `packages/relay-web/package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.gitignore`.
- `src/main.ts`, `src/App.vue`, `src/style.css`, `src/router/index.ts`.
- `src/api/client.ts` (REST), `src/api/events.ts` (WS).
- `src/stores/auth.ts`, `src/stores/instances.ts`, `src/stores/chat.ts`.
- `src/views/LoginView.vue`, `src/views/DashboardView.vue`.
- `src/components/InstanceTree.vue`, `src/components/ChatPane.vue`, `src/components/MessageList.vue`, `src/components/PromptInput.vue`.
- `src/__tests__/*.test.ts` — store + component tests.

**root + docs:**
- Modify root `package.json` — `build:relay-web`, `clean:relay-web`, `test:web` scripts.
- Modify `scripts/run-tests.mjs` — run web Vitest as a final step for the unit root.
- Create `docs/relay-web-module.md`; modify `docs/relay-module.md`, `AGENTS.md`.

---

## Task 1: relay-protocol — web↔relay DTOs

**Files:**
- Create: `packages/relay-protocol/src/web-dtos.ts`
- Modify: `packages/relay-protocol/src/index.ts`
- Test: `tests/unit/packages/relay-protocol/web-dtos.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay-protocol/web-dtos.test.ts
import { expect, test } from "bun:test";
import {
  WEB_EVENT_TYPE,
  decodeEnvelope,
  encodeEnvelope,
  parseWebServerEvent,
  webEventEnvelope,
  type WebServerEvent,
} from "../../../../packages/relay-protocol/src/index";

test("webEventEnvelope wraps an event and round-trips through encode/decode", () => {
  const event: WebServerEvent = {
    kind: "control-event",
    instanceId: "i1",
    event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hi" },
  };
  const wire = encodeEnvelope(webEventEnvelope(event));
  const decoded = decodeEnvelope(wire);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.envelope.type).toBe(WEB_EVENT_TYPE);
  expect(parseWebServerEvent(decoded.envelope)).toEqual(event);
});

test("parseWebServerEvent rejects non-web envelopes", () => {
  expect(parseWebServerEvent({ protocolVersion: 1, kind: "event", type: "instance.event", payload: {} } as never)).toBeNull();
});

test("instance-status and notice events are representable", () => {
  const status: WebServerEvent = { kind: "instance-status", instanceId: "i1", online: false };
  const notice: WebServerEvent = { kind: "notice", instanceId: "i1", notice: { kind: "task-completion", text: "done" } };
  expect(parseWebServerEvent(decodeOk(status))).toEqual(status);
  expect(parseWebServerEvent(decodeOk(notice))).toEqual(notice);
});

function decodeOk(event: WebServerEvent) {
  const decoded = decodeEnvelope(encodeEnvelope(webEventEnvelope(event)));
  if (!decoded.ok) throw new Error("decode failed");
  return decoded.envelope;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay-protocol/web-dtos.test.ts`
Expected: FAIL — `web-dtos` exports not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/relay-protocol/src/web-dtos.ts
import { RELAY_PROTOCOL_VERSION, type RelayEnvelope } from "./envelope.js";
import type { ControlEventDto } from "./dtos.js";
import type { InstanceNoticePayload } from "./messages.js";

/** Envelope `type` for every relay→web push. */
export const WEB_EVENT_TYPE = "web.event";

export type MessageDirection = "in" | "out";

/** A cached chat line echoed to the web client. */
export interface MessageRecordDto {
  instanceId: string;
  sessionAlias: string;
  direction: MessageDirection;
  text: string;
  createdAt: string;
}

/** Server→web push payloads (tagged with the originating instance). */
export type WebServerEvent =
  | { kind: "instance-status"; instanceId: string; online: boolean }
  | { kind: "control-event"; instanceId: string; event: ControlEventDto }
  | { kind: "notice"; instanceId: string; notice: InstanceNoticePayload };

export function webEventEnvelope(event: WebServerEvent): RelayEnvelope {
  return { protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: WEB_EVENT_TYPE, payload: event };
}

export function parseWebServerEvent(envelope: RelayEnvelope): WebServerEvent | null {
  if (envelope.kind !== "event" || envelope.type !== WEB_EVENT_TYPE) return null;
  const payload = envelope.payload as Partial<WebServerEvent> | undefined;
  if (!payload || typeof payload !== "object" || typeof (payload as { kind?: unknown }).kind !== "string") return null;
  return payload as WebServerEvent;
}
```

```ts
// packages/relay-protocol/src/index.ts  (add the line)
export * from "./web-dtos.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay-protocol/web-dtos.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src/web-dtos.ts packages/relay-protocol/src/index.ts tests/unit/packages/relay-protocol/web-dtos.test.ts
git commit -m "feat(relay-protocol): web event and message-record DTOs"
```

---

## Task 2: relay — messages cache table + MessageStore

**Files:**
- Modify: `packages/relay/src/db.ts` (add `messages` table)
- Create: `packages/relay/src/stores/messages.ts`
- Test: `tests/unit/packages/relay/stores/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay/stores/messages.test.ts
import { expect, test } from "bun:test";
import { createSqlDriver, initSchema } from "../../../../../packages/relay/src/db";
import { MessageStore } from "../../../../../packages/relay/src/stores/messages";

async function freshDb() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  // Two accounts, each owning one instance.
  db.run("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)", ["a1", "u1", "h", "member", "t"]);
  db.run("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)", ["a2", "u2", "h", "member", "t"]);
  db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i1", "a1", "pc", "h", "t"]);
  db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i2", "a2", "pc", "h", "t"]);
  return db;
}

test("append then listBySession returns rows oldest-first as DTOs", async () => {
  const db = await freshDb();
  let clock = 1000;
  const store = new MessageStore(db, () => new Date(clock));
  store.append("i1", "backend", "in", "hello");
  clock = 2000;
  store.append("i1", "backend", "out", "world");
  const rows = store.listBySession("a1", "i1", "backend");
  expect(rows.map((r) => [r.direction, r.text])).toEqual([["in", "hello"], ["out", "world"]]);
  expect(rows[0]?.instanceId).toBe("i1");
  expect(rows[0]?.createdAt).toBe(new Date(1000).toISOString());
});

test("listBySession is account-scoped: foreign account sees nothing", async () => {
  const db = await freshDb();
  const store = new MessageStore(db);
  store.append("i1", "backend", "in", "secret");
  expect(store.listBySession("a2", "i1", "backend")).toEqual([]);
});

test("listBySession honors the limit, keeping the most recent", async () => {
  const db = await freshDb();
  let clock = 0;
  const store = new MessageStore(db, () => new Date((clock += 1000)));
  for (let i = 0; i < 5; i++) store.append("i1", "backend", "in", `m${i}`);
  const rows = store.listBySession("a1", "i1", "backend", 2);
  expect(rows.map((r) => r.text)).toEqual(["m3", "m4"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay/stores/messages.test.ts`
Expected: FAIL — `MessageStore` not found / no `messages` table.

- [ ] **Step 3: Add the table to `initSchema`**

In `packages/relay/src/db.ts`, append this table inside the `initSchema` `db.exec(...)` template (after the `instances` table):

```sql
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL REFERENCES instances(id),
      session_alias TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (instance_id, session_alias, id);
```

- [ ] **Step 4: Implement MessageStore**

```ts
// packages/relay/src/stores/messages.ts
import type { MessageDirection, MessageRecordDto } from "@ganglion/xacpx-relay-protocol";

import type { SqlDriver } from "../db.js";

interface MessageRow {
  instance_id: string;
  session_alias: string;
  direction: MessageDirection;
  text: string;
  created_at: string;
}

export class MessageStore {
  constructor(private readonly db: SqlDriver, private readonly now: () => Date = () => new Date()) {}

  append(instanceId: string, sessionAlias: string, direction: MessageDirection, text: string): void {
    this.db.run(
      "INSERT INTO messages (instance_id, session_alias, direction, text, created_at) VALUES (?,?,?,?,?)",
      [instanceId, sessionAlias, direction, text, this.now().toISOString()],
    );
  }

  /** Most recent `limit` rows for one session, oldest-first, scoped to the owning account. */
  listBySession(accountId: string, instanceId: string, sessionAlias: string, limit = 100): MessageRecordDto[] {
    const rows = this.db.all<MessageRow>(
      `SELECT m.instance_id, m.session_alias, m.direction, m.text, m.created_at
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
    }));
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/stores/messages.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/db.ts packages/relay/src/stores/messages.ts tests/unit/packages/relay/stores/messages.test.ts
git commit -m "feat(relay): messages cache table and account-scoped MessageStore"
```

---

## Task 3: relay — InstanceGateway online/offline callback

**Files:**
- Modify: `packages/relay/src/gateway/instance-gateway.ts`
- Test: `tests/unit/packages/relay/gateway/instance-gateway-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay/gateway/instance-gateway-status.test.ts
import { expect, test } from "bun:test";
import { MSG, RELAY_PROTOCOL_VERSION, encodeEnvelope } from "../../../../../packages/relay-protocol/src/index";
import { InstanceGateway } from "../../../../../packages/relay/src/gateway/instance-gateway";

class FakeSocket {
  sent: string[] = [];
  listeners: Record<string, ((data?: unknown) => void)[]> = {};
  send(data: string) { this.sent.push(data); }
  close() { this.emit("close"); }
  on(event: string, listener: (data?: unknown) => void) { (this.listeners[event] ??= []).push(listener); return this; }
  emit(event: string, data?: unknown) { (this.listeners[event] ?? []).forEach((l) => l(data)); }
}

test("onStatusChange fires online on auth and offline on close", async () => {
  const events: Array<[string, string, boolean]> = [];
  const gateway = new InstanceGateway({
    instances: {
      redeemPairingToken: () => null,
      verifyCredential: () => ({ id: "i1", accountId: "a1" }),
      touch: () => {},
    } as never,
    onStatusChange: (instanceId, accountId, online) => events.push([instanceId, accountId, online]),
  });
  const socket = new FakeSocket();
  gateway.handleConnection(socket as never);
  socket.emit("message", encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "h1", type: MSG.instanceAuth,
    payload: { instanceId: "i1", credential: "c" },
  }));
  expect(events).toEqual([["i1", "a1", true]]);
  socket.close();
  expect(events).toEqual([["i1", "a1", true], ["i1", "a1", false]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay/gateway/instance-gateway-status.test.ts`
Expected: FAIL — `onStatusChange` not invoked.

- [ ] **Step 3: Implement**

In `packages/relay/src/gateway/instance-gateway.ts`:

Add to `InstanceGatewayDeps`:
```ts
  onStatusChange?: (instanceId: string, accountId: string, online: boolean) => void;
```

In `handleConnection`, where the connection is registered, fire online:
```ts
      if (!authed) {
        authed = this.handleHandshake(socket, envelope);
        if (authed) {
          this.connections.set(authed.instanceId, { socket, accountId: authed.accountId });
          this.deps.onStatusChange?.(authed.instanceId, authed.accountId, true);
        }
        return;
      }
```

In the `socket.on("close", ...)` handler, fire offline:
```ts
    socket.on("close", () => {
      if (authed) {
        this.connections.delete(authed.instanceId);
        this.deps.onStatusChange?.(authed.instanceId, authed.accountId, false);
      }
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/gateway/instance-gateway-status.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/gateway/instance-gateway.ts tests/unit/packages/relay/gateway/instance-gateway-status.test.ts
git commit -m "feat(relay): emit instance online/offline status changes from the gateway"
```

---

## Task 4: relay — WebGateway (per-account web-socket fan-out)

**Files:**
- Create: `packages/relay/src/gateway/web-gateway.ts`
- Test: `tests/unit/packages/relay/gateway/web-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay/gateway/web-gateway.test.ts
import { expect, test } from "bun:test";
import { decodeEnvelope, parseWebServerEvent, type WebServerEvent } from "../../../../../packages/relay-protocol/src/index";
import { WebGateway } from "../../../../../packages/relay/src/gateway/web-gateway";

class FakeSocket {
  sent: string[] = [];
  closeListeners: (() => void)[] = [];
  send(data: string) { this.sent.push(data); }
  on(event: string, listener: () => void) { if (event === "close") this.closeListeners.push(listener); return this; }
  close() { this.closeListeners.forEach((l) => l()); }
}

const evt = (online: boolean): WebServerEvent => ({ kind: "instance-status", instanceId: "i1", online });

test("broadcast reaches only that account's sockets", () => {
  const gw = new WebGateway();
  const a = new FakeSocket(); const b = new FakeSocket(); const other = new FakeSocket();
  gw.register("a1", a as never); gw.register("a1", b as never); gw.register("a2", other as never);
  gw.broadcast("a1", evt(true));
  expect(a.sent.length).toBe(1);
  expect(b.sent.length).toBe(1);
  expect(other.sent.length).toBe(0);
  const decoded = decodeEnvelope(a.sent[0]!);
  expect(decoded.ok && parseWebServerEvent(decoded.envelope)).toEqual(evt(true));
});

test("closed sockets are dropped from the account set", () => {
  const gw = new WebGateway();
  const a = new FakeSocket();
  gw.register("a1", a as never);
  a.close();
  gw.broadcast("a1", evt(false));
  expect(a.sent.length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay/gateway/web-gateway.test.ts`
Expected: FAIL — `WebGateway` not found.

- [ ] **Step 3: Implement**

```ts
// packages/relay/src/gateway/web-gateway.ts
import { encodeEnvelope, webEventEnvelope, type WebServerEvent } from "@ganglion/xacpx-relay-protocol";

export interface WebSocketLike {
  send(data: string): void;
  on(event: "close", listener: () => void): unknown;
}

/** Tracks authenticated browser sockets per account and fans events out to them. */
export class WebGateway {
  private readonly byAccount = new Map<string, Set<WebSocketLike>>();

  register(accountId: string, socket: WebSocketLike): void {
    const set = this.byAccount.get(accountId) ?? new Set<WebSocketLike>();
    set.add(socket);
    this.byAccount.set(accountId, set);
    socket.on("close", () => {
      set.delete(socket);
      if (set.size === 0) this.byAccount.delete(accountId);
    });
  }

  broadcast(accountId: string, event: WebServerEvent): void {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    const data = encodeEnvelope(webEventEnvelope(event));
    for (const socket of set) socket.send(data);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/gateway/web-gateway.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/gateway/web-gateway.ts tests/unit/packages/relay/gateway/web-gateway.test.ts
git commit -m "feat(relay): per-account web-socket fan-out gateway"
```

---

## Task 5: relay — runtime wiring (events → history cache + web fan-out)

**Files:**
- Modify: `packages/relay/src/server.ts` (`createRelayRuntime`)
- Test: `tests/unit/packages/relay/runtime-fanout.test.ts`

This wires `InstanceGateway.onEvent`/`onStatusChange` into `MessageStore` + `WebGateway`. Turn-output chunks are buffered per `(instanceId, sessionAlias)` and flushed to one cached `out` message on `turn-finished`; every control event is also broadcast live.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay/runtime-fanout.test.ts
import { expect, test } from "bun:test";
import {
  MSG, RELAY_PROTOCOL_VERSION, decodeEnvelope, parseWebServerEvent,
} from "../../../../packages/relay-protocol/src/index";
import { createRelayRuntime } from "../../../../packages/relay/src/server";

class FakeSocket {
  sent: string[] = [];
  on() { return this; }
  send(data: string) { this.sent.push(data); }
}

async function seeded() {
  const runtime = await createRelayRuntime(":memory:");
  runtime.db.run("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)", ["a1", "u", "h", "member", "t"]);
  runtime.db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i1", "a1", "pc", "h", "t"]);
  return runtime;
}

test("control events broadcast to web sockets and turn output is cached on finish", async () => {
  const runtime = await seeded();
  const web = new FakeSocket();
  runtime.webGateway.register("a1", web as never);

  const fire = (event: unknown) => runtime.gateway["deps"].onEvent!("i1", "a1", {
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: { event },
  });

  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" });
  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "lo" });
  fire({ type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true });

  // three live broadcasts
  expect(web.sent.length).toBe(3);
  const first = decodeEnvelope(web.sent[0]!);
  expect(first.ok && parseWebServerEvent(first.envelope)).toEqual({
    kind: "control-event", instanceId: "i1",
    event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" },
  });

  // buffered output flushed to one cached "out" message
  const cached = runtime.messages.listBySession("a1", "i1", "backend");
  expect(cached.map((m) => [m.direction, m.text])).toEqual([["out", "hello"]]);

  runtime.close();
});

test("status changes broadcast instance-status events", async () => {
  const runtime = await seeded();
  const web = new FakeSocket();
  runtime.webGateway.register("a1", web as never);
  runtime.gateway["deps"].onStatusChange!("i1", "a1", false);
  const decoded = decodeEnvelope(web.sent[0]!);
  expect(decoded.ok && parseWebServerEvent(decoded.envelope)).toEqual({ kind: "instance-status", instanceId: "i1", online: false });
  runtime.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay/runtime-fanout.test.ts`
Expected: FAIL — `runtime.webGateway` / `runtime.messages` undefined.

- [ ] **Step 3: Implement in `server.ts`**

Update imports and `RelayRuntime`, and rewrite `createRelayRuntime`:

```ts
import {
  MSG, type ControlEventDto, type InstanceEventPayload, type InstanceNoticePayload, type RelayEnvelope,
} from "@ganglion/xacpx-relay-protocol";

import { createSqlDriver, initSchema, type SqlDriver } from "./db.js";
import { AccountStore } from "./stores/accounts.js";
import { InstanceStore } from "./stores/instances.js";
import { MessageStore } from "./stores/messages.js";
import { InstanceGateway } from "./gateway/instance-gateway.js";
import { WebGateway } from "./gateway/web-gateway.js";
import { createApp } from "./http/app.js";

export interface RelayRuntime {
  db: SqlDriver;
  accounts: AccountStore;
  instances: InstanceStore;
  messages: MessageStore;
  gateway: InstanceGateway;
  webGateway: WebGateway;
  app: ReturnType<typeof createApp>;
  close(): void;
}

export interface CreateRuntimeOptions {
  webRoot?: string;
}

export async function createRelayRuntime(dbPath: string, options: CreateRuntimeOptions = {}): Promise<RelayRuntime> {
  const db = await createSqlDriver(dbPath);
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const messages = new MessageStore(db);
  const webGateway = new WebGateway();

  // Accumulate streaming turn output per (instance, session); flush to history on finish.
  const turnBuffers = new Map<string, string>();
  const key = (instanceId: string, alias: string) => `${instanceId} ${alias}`;

  const gateway = new InstanceGateway({
    instances,
    onStatusChange: (instanceId, accountId, online) =>
      webGateway.broadcast(accountId, { kind: "instance-status", instanceId, online }),
    onEvent: (instanceId, accountId, envelope: RelayEnvelope) => {
      if (envelope.type === MSG.instanceEvent) {
        const event = (envelope.payload as InstanceEventPayload).event as ControlEventDto;
        webGateway.broadcast(accountId, { kind: "control-event", instanceId, event });
        if (event.type === "turn-output") {
          const k = key(instanceId, event.sessionAlias);
          turnBuffers.set(k, (turnBuffers.get(k) ?? "") + event.chunk);
        } else if (event.type === "turn-finished") {
          const k = key(instanceId, event.sessionAlias);
          const text = turnBuffers.get(k);
          turnBuffers.delete(k);
          if (text) messages.append(instanceId, event.sessionAlias, "out", text);
        }
      } else if (envelope.type === MSG.instanceNotice) {
        webGateway.broadcast(accountId, { kind: "notice", instanceId, notice: envelope.payload as InstanceNoticePayload });
      }
    },
  });

  const app = createApp({ accounts, instances, messages, gateway, webRoot: options.webRoot });
  return { db, accounts, instances, messages, gateway, webGateway, app, close: () => db.close() };
}
```

> Note: `createApp` gains `messages` and `webRoot` deps in Task 6 — that task lands the `AppDeps` change. If you implement Task 5 before Task 6, temporarily extend `AppDeps` with `messages: MessageStore; webRoot?: string;` here and complete the wiring in Task 6. (Subagent-driven execution runs tasks in order, so `createApp` will accept these by the time the suite is green; ensure `tsc --noEmit` passes at the end of whichever task lands last.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/runtime-fanout.test.ts`
Expected: PASS. (Full-suite `tsc` settles once Task 6 lands the `AppDeps` fields.)

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/server.ts tests/unit/packages/relay/runtime-fanout.test.ts
git commit -m "feat(relay): fan control events to web clients and cache turn output as history"
```

---

## Task 6: relay — HTTP chat-history endpoint, prompt echo, static SPA hosting

**Files:**
- Modify: `packages/relay/src/http/app.ts`
- Test: `tests/unit/packages/relay/http/messages-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/packages/relay/http/messages-endpoint.test.ts
import { expect, test } from "bun:test";
import { MSG } from "../../../../../packages/relay-protocol/src/index";
import { createRelayRuntime } from "../../../../../packages/relay/src/server";

async function loggedIn() {
  const runtime = await createRelayRuntime(":memory:");
  runtime.accounts.createAccount("admin", "pw", "admin");
  const res = await runtime.app.request("/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "pw" }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  const account = runtime.accounts.findByUsername("admin")!;
  runtime.db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i1", account.id, "pc", "h", "t"]);
  return { runtime, cookie };
}

test("GET messages returns cached history for an owned session", async () => {
  const { runtime, cookie } = await loggedIn();
  runtime.messages.append("i1", "backend", "in", "hi");
  runtime.messages.append("i1", "backend", "out", "hello");
  const res = await runtime.app.request("/api/instances/i1/sessions/backend/messages", { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { messages: Array<{ direction: string; text: string }> };
  expect(body.messages.map((m) => [m.direction, m.text])).toEqual([["in", "hi"], ["out", "hello"]]);
  runtime.close();
});

test("GET messages for an unowned instance is 404", async () => {
  const { runtime, cookie } = await loggedIn();
  const res = await runtime.app.request("/api/instances/ghost/sessions/backend/messages", { headers: { cookie } });
  expect(res.status).toBe(404);
  runtime.close();
});

test("rpc prompt echoes the user message into history", async () => {
  const { runtime, cookie } = await loggedIn();
  // stub the gateway so the prompt "succeeds" without a real instance
  (runtime.gateway as unknown as { sendRequest: () => Promise<unknown> }).sendRequest = async () => ({ ok: true });
  await runtime.app.request("/api/instances/i1/rpc", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.prompt, payload: { sessionAlias: "backend", text: "do it" } }),
  });
  const cached = runtime.messages.listBySession(runtime.accounts.findByUsername("admin")!.id, "i1", "backend");
  expect(cached.map((m) => [m.direction, m.text])).toEqual([["in", "do it"]]);
  runtime.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay/http/messages-endpoint.test.ts`
Expected: FAIL — endpoint missing / `messages` not on `AppDeps`.

- [ ] **Step 3: Implement in `app.ts`**

Add to `AppDeps`:
```ts
  messages: MessageStore;
  webRoot?: string;
```
Import:
```ts
import { serveStatic } from "@hono/node-server/serve-static";
import type { MessageStore } from "../stores/messages.js";
```

Add the history endpoint (after the existing instances routes, before the rpc route):
```ts
  app.get("/api/instances/:id/sessions/:alias/messages", (c) => {
    const account = c.get("account");
    const instance = deps.instances.getOwned(c.req.param("id"), account.id);
    if (!instance) return c.json({ error: "not-found" }, 404);
    const messages = deps.messages.listBySession(account.id, instance.id, c.req.param("alias"));
    return c.json({ messages });
  });
```

In the rpc route, echo the prompt into history on a successful `control.prompt`:
```ts
    try {
      const result = await deps.gateway.sendRequest(instance.id, body.type, payload);
      if (body.type === MSG.prompt) {
        const p = payload as { sessionAlias?: string; text?: string };
        if (p.sessionAlias && p.text) deps.messages.append(instance.id, p.sessionAlias, "in", p.text);
      }
      return c.json({ result });
    } catch (error) {
```

At the very end of `createApp`, before `return app;`, mount static SPA hosting when configured:
```ts
  if (deps.webRoot) {
    const root = deps.webRoot;
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({ path: "index.html", root })); // SPA fallback
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/http/messages-endpoint.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean (the `messages`/`webRoot` deps from Task 5 now resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/http/app.ts tests/unit/packages/relay/http/messages-endpoint.test.ts
git commit -m "feat(relay): chat-history endpoint, prompt echo, and optional SPA hosting"
```

---

## Task 7: relay — `/ws` upgrade with cookie auth + CLI `--web-root` + integration test

**Files:**
- Modify: `packages/relay/src/server.ts` (`startRelayServer`, add web WS upgrade)
- Modify: `packages/relay/src/cli.ts` (`start` reads `--web-root`)
- Test: `tests/unit/packages/relay/web-ws-integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/unit/packages/relay/web-ws-integration.test.ts
import { expect, test } from "bun:test";
import { WebSocket } from "ws";
import { decodeEnvelope, parseWebServerEvent } from "../../../../packages/relay-protocol/src/index";
import { startRelayServer } from "../../../../packages/relay/src/server";

test("authenticated /ws receives account-scoped fan-out; unauthenticated is rejected", async () => {
  const relay = await startRelayServer({ dbPath: ":memory:", httpPort: 0, wsPort: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${relay.httpPort}`;

  relay.runtime.accounts.createAccount("admin", "pw", "admin");
  const login = await fetch(`${base}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "pw" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const accountId = relay.runtime.accounts.findByUsername("admin")!.id;

  // unauthenticated upgrade is refused
  const refused = new WebSocket(`ws://127.0.0.1:${relay.httpPort}/ws`);
  await new Promise<void>((resolve) => { refused.on("error", () => resolve()); refused.on("open", () => { refused.close(); resolve(); }); });
  expect(refused.readyState).not.toBe(WebSocket.OPEN);

  // authenticated upgrade with the session cookie
  const ws = new WebSocket(`ws://127.0.0.1:${relay.httpPort}/ws`, { headers: { cookie } });
  const message = new Promise<string>((resolve) => ws.on("message", (d) => resolve(String(d))));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));

  relay.runtime.webGateway.broadcast(accountId, { kind: "instance-status", instanceId: "i1", online: true });
  const decoded = decodeEnvelope(await message);
  expect(decoded.ok && parseWebServerEvent(decoded.envelope)).toEqual({ kind: "instance-status", instanceId: "i1", online: true });

  ws.close();
  await relay.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/web-ws-integration.test.ts`
Expected: FAIL — `/ws` upgrade not handled (connection refused/closed).

- [ ] **Step 3: Implement the `/ws` upgrade in `startRelayServer`**

In `packages/relay/src/server.ts`, thread `webRoot` and add the web WS gateway. Update `StartRelayOptions`:
```ts
export interface StartRelayOptions {
  dbPath: string;
  httpPort: number;
  wsPort: number;
  host?: string;
  webRoot?: string;
}
```

Pass `webRoot` into the runtime:
```ts
  const runtime = await createRelayRuntime(options.dbPath, { webRoot: options.webRoot });
```

After the `httpServer` promise resolves and before/after the instance `wss`, add a cookie-authenticated web WS using `noServer` mode on the HTTP server's upgrade event:
```ts
  const webWss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws")) { socket.destroy(); return; }
    const token = parseCookie(req.headers.cookie ?? "")["xrelay_session"];
    const account = token ? runtime.accounts.getSessionAccount(token) : null;
    if (!account) { socket.destroy(); return; }
    webWss.handleUpgrade(req, socket, head, (ws) => runtime.webGateway.register(account.id, ws));
  });
```

Add a tiny cookie parser at module scope (avoid pulling a dep):
```ts
function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
```

Close the web WS in the returned `close()`:
```ts
    close: async () => {
      await new Promise<void>((resolve) => webWss.close(() => resolve()));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      runtime.close();
    },
```

> `SESSION_COOKIE` is `"xrelay_session"` (see `http/app.ts`). Keep the literal in sync; both reference the same cookie name.

- [ ] **Step 4: Add `--web-root` to the CLI `start` command**

In `packages/relay/src/cli.ts`, in the `start` branch, read the flag and pass it through:
```ts
    const webRoot = flag(args, "--web-root");
    // ... existing dbPath/httpPort/wsPort resolution ...
    await startRelayServer({ dbPath, httpPort, wsPort, host, webRoot });
```
(Use the existing `flag()` helper. If `start` currently destructures a fixed option set, add `webRoot` to it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/web-ws-integration.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Full relay-package regression + build**

Run: `npm test && bun run build:relay`
Expected: `tsc --noEmit` clean, all relay test files pass, relay builds.

- [ ] **Step 7: Commit**

```bash
git add packages/relay/src/server.ts packages/relay/src/cli.ts tests/unit/packages/relay/web-ws-integration.test.ts
git commit -m "feat(relay): cookie-authenticated /ws web fan-out endpoint and --web-root"
```

---

## Task 8: relay-web — scaffold + toolchain (Vite/Vue/Pinia/router/Tailwind/Vitest)

**Files (create all):**
- `packages/relay-web/package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.gitignore`
- `packages/relay-web/src/main.ts`, `src/App.vue`, `src/style.css`, `src/router/index.ts`
- `packages/relay-web/src/__tests__/smoke.test.ts`
- Modify root `package.json` (scripts), `scripts/run-tests.mjs` (web test step)

This task installs the frontend toolchain (so it legitimately changes `bun.lock`) and proves the build/test pipeline with a trivial mounted-component test.

- [ ] **Step 1: Create `packages/relay-web/package.json`**

```json
{
  "name": "@ganglion/xacpx-relay-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@ganglion/xacpx-relay-protocol": "^0.1.0",
    "pinia": "^2.2.0",
    "vue": "^3.5.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "@vue/test-utils": "^2.4.6",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create config files**

`packages/relay-web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

`packages/relay-web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals"],
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"]
}
```

`packages/relay-web/tailwind.config.js`:
```js
export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: { extend: {} },
  plugins: [],
};
```

`packages/relay-web/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`packages/relay-web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>xacpx relay</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/relay-web/.gitignore`:
```
dist
node_modules
```

- [ ] **Step 3: Create app entry + shell**

`packages/relay-web/src/style.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`packages/relay-web/src/router/index.ts`:
```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
  { path: "/", name: "dashboard", component: () => import("../views/DashboardView.vue") },
];

export const router = createRouter({ history: createWebHistory(), routes });
```

`packages/relay-web/src/App.vue`:
```vue
<template>
  <RouterView />
</template>
```

`packages/relay-web/src/main.ts`:
```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";

createApp(App).use(createPinia()).use(router).mount("#app");
```

Create placeholder views so the router resolves (filled in by later tasks):

`packages/relay-web/src/views/LoginView.vue`:
```vue
<template><div>login</div></template>
```

`packages/relay-web/src/views/DashboardView.vue`:
```vue
<template><div>dashboard</div></template>
```

- [ ] **Step 4: Write the smoke test**

`packages/relay-web/src/__tests__/smoke.test.ts`:
```ts
import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import LoginView from "../views/LoginView.vue";

test("toolchain mounts a component", () => {
  const wrapper = mount(LoginView);
  expect(wrapper.text()).toContain("login");
});
```

- [ ] **Step 5: Install deps and run the smoke test**

Run:
```bash
bun install
bun run --cwd packages/relay-web test
```
Expected: deps install; Vitest runs 1 passing test. (This legitimately updates `bun.lock`.)

- [ ] **Step 6: Wire root scripts + the test runner**

In root `package.json` `scripts`, add:
```json
    "clean:relay-web": "node -e \"require('node:fs').rmSync('packages/relay-web/dist',{recursive:true,force:true})\"",
    "build:relay-web": "bun run build:relay-protocol && bun run clean:relay-web && bun run --cwd packages/relay-web build",
    "test:web": "bun run --cwd packages/relay-web test",
```

In `scripts/run-tests.mjs`, after the per-file test loop, run the web suite **only for the unit root**:
```js
if (root === "tests/unit") {
  const webCode = await runOne("bun", ["run", "test:web"]);
  if (webCode !== 0) process.exit(webCode ?? 1);
}
```

- [ ] **Step 7: Verify the integrated gate**

Run: `npm test`
Expected: backend `tsc` + bun tests pass, then web Vitest passes.

- [ ] **Step 8: Commit**

```bash
git add packages/relay-web/package.json packages/relay-web/vite.config.ts packages/relay-web/tsconfig.json packages/relay-web/tailwind.config.js packages/relay-web/postcss.config.js packages/relay-web/index.html packages/relay-web/.gitignore packages/relay-web/src package.json scripts/run-tests.mjs bun.lock
git commit -m "feat(relay-web): scaffold Vue 3 + Vite + Pinia + Tailwind app and wire test runner"
```

---

## Task 9: relay-web — API client, auth store, LoginView + route guard

**Files:**
- Create: `packages/relay-web/src/api/client.ts`, `src/stores/auth.ts`
- Modify: `src/views/LoginView.vue`, `src/router/index.ts`
- Test: `packages/relay-web/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/relay-web/src/__tests__/auth.test.ts
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAuthStore } from "../stores/auth";

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

test("login stores the account on success", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ username: "admin", role: "admin" }), { status: 200 })));
  const auth = useAuthStore();
  await auth.login("admin", "pw");
  expect(auth.account).toEqual({ username: "admin", role: "admin" });
  expect(auth.error).toBe("");
});

test("login surfaces an error and leaves account null on 401", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid-credentials" }), { status: 401 })));
  const auth = useAuthStore();
  await auth.login("admin", "bad");
  expect(auth.account).toBeNull();
  expect(auth.error).toBe("invalid-credentials");
});

test("fetchMe populates account when a session exists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ username: "u", role: "member" }), { status: 200 })));
  const auth = useAuthStore();
  expect(await auth.fetchMe()).toBe(true);
  expect(auth.account?.username).toBe("u");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/relay-web test src/__tests__/auth.test.ts`
Expected: FAIL — `stores/auth` not found.

- [ ] **Step 3: Implement the API client**

`packages/relay-web/src/api/client.ts`:
```ts
export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? "request-failed", res.status);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  /** Proxy a control RPC to an instance via the relay. */
  rpc: <T>(instanceId: string, type: string, payload: unknown = {}) =>
    request<{ result: T }>("POST", `/api/instances/${instanceId}/rpc`, { type, payload }).then((r) => r.result),
};
```

- [ ] **Step 4: Implement the auth store**

`packages/relay-web/src/stores/auth.ts`:
```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, api } from "../api/client";

export interface Account {
  username: string;
  role: "admin" | "member";
}

export const useAuthStore = defineStore("auth", () => {
  const account = ref<Account | null>(null);
  const error = ref("");

  async function login(username: string, password: string): Promise<boolean> {
    error.value = "";
    try {
      account.value = await api.post<Account>("/api/login", { username, password });
      return true;
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "request-failed";
      account.value = null;
      return false;
    }
  }

  async function fetchMe(): Promise<boolean> {
    try {
      account.value = await api.get<Account>("/api/me");
      return true;
    } catch {
      account.value = null;
      return false;
    }
  }

  async function logout(): Promise<void> {
    await api.post("/api/logout").catch(() => {});
    account.value = null;
  }

  return { account, error, login, fetchMe, logout };
});
```

- [ ] **Step 5: Fill in LoginView and the route guard**

`packages/relay-web/src/views/LoginView.vue`:
```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const username = ref("");
const password = ref("");

async function submit() {
  if (await auth.login(username.value, password.value)) router.replace("/");
}
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-slate-100">
    <form class="w-80 space-y-3 rounded-lg bg-white p-6 shadow" @submit.prevent="submit">
      <h1 class="text-lg font-semibold">xacpx relay</h1>
      <input v-model="username" class="w-full rounded border px-3 py-2" placeholder="username" />
      <input v-model="password" type="password" class="w-full rounded border px-3 py-2" placeholder="password" />
      <p v-if="auth.error" class="text-sm text-red-600">{{ auth.error }}</p>
      <button class="w-full rounded bg-slate-800 px-3 py-2 text-white" type="submit">Sign in</button>
    </form>
  </div>
</template>
```

In `packages/relay-web/src/router/index.ts`, add a guard that redirects to `/login` when unauthenticated:
```ts
import { useAuthStore } from "../stores/auth";

router.beforeEach(async (to) => {
  if (to.name === "login") return true;
  const auth = useAuthStore();
  if (auth.account) return true;
  const ok = await auth.fetchMe();
  return ok ? true : { name: "login" };
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run --cwd packages/relay-web test src/__tests__/auth.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-web/src/api/client.ts packages/relay-web/src/stores/auth.ts packages/relay-web/src/views/LoginView.vue packages/relay-web/src/router/index.ts packages/relay-web/src/__tests__/auth.test.ts
git commit -m "feat(relay-web): API client, auth store, login view and route guard"
```

---

## Task 10: relay-web — WS events client, instances store, InstanceTree (left column)

**Files:**
- Create: `packages/relay-web/src/api/events.ts`, `src/stores/instances.ts`, `src/components/InstanceTree.vue`
- Test: `packages/relay-web/src/__tests__/instances.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/relay-web/src/__tests__/instances.test.ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
import { useInstancesStore } from "../stores/instances";

beforeEach(() => setActivePinia(createPinia()));

test("loadInstances populates the list with online flags", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    instances: [{ id: "i1", name: "pc", online: true, lastSeenAt: null }],
  }), { status: 200 })));
  const store = useInstancesStore();
  await store.loadInstances();
  expect(store.instances[0]).toMatchObject({ id: "i1", name: "pc", online: true });
});

test("applyEvent instance-status toggles online without refetch", () => {
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }];
  store.applyEvent({ kind: "instance-status", instanceId: "i1", online: false });
  expect(store.instances[0]?.online).toBe(false);
});

test("loadSessions caches sessions under the instance", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    result: { sessions: [{ alias: "backend", agent: "claude", workspace: "/w", transportSession: "t", running: false }] },
  }), { status: 200 })));
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }];
  await store.loadSessions("i1");
  expect(store.instances[0]?.sessions.map((s) => s.alias)).toEqual(["backend"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/relay-web test src/__tests__/instances.test.ts`
Expected: FAIL — `stores/instances` not found.

- [ ] **Step 3: Implement the WS events client**

`packages/relay-web/src/api/events.ts`:
```ts
import { parseWebServerEvent, decodeEnvelope, type WebServerEvent } from "@ganglion/xacpx-relay-protocol";

/** Connects to the relay /ws fan-out and invokes `onEvent` for each web event. Auto-reconnects. */
export function connectEvents(onEvent: (event: WebServerEvent) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onmessage = (e) => {
      const decoded = decodeEnvelope(String(e.data));
      if (!decoded.ok) return;
      const event = parseWebServerEvent(decoded.envelope);
      if (event) onEvent(event);
    };
    socket.onopen = () => { retry = 0; };
    socket.onclose = () => {
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(open, 250 * 2 ** (retry - 1));
    };
  };

  open();
  return () => { closed = true; socket?.close(); };
}
```

- [ ] **Step 4: Implement the instances store**

`packages/relay-web/src/stores/instances.ts`:
```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import type { SessionDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api } from "../api/client";

export interface InstanceView {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  sessions: SessionDto[];
}

export const useInstancesStore = defineStore("instances", () => {
  const instances = ref<InstanceView[]>([]);

  async function loadInstances(): Promise<void> {
    const { instances: rows } = await api.get<{ instances: Array<Omit<InstanceView, "sessions">> }>("/api/instances");
    instances.value = rows.map((r) => ({ ...r, sessions: byId(r.id)?.sessions ?? [] }));
  }

  async function loadSessions(instanceId: string): Promise<void> {
    const { sessions } = await api.rpc<{ sessions: SessionDto[] }>(instanceId, "control.sessions.list");
    const inst = byId(instanceId);
    if (inst) inst.sessions = sessions;
  }

  async function createSession(instanceId: string, alias: string, agent: string, workspace: string): Promise<void> {
    await api.rpc(instanceId, "control.sessions.create", { alias, agent, workspace });
    await loadSessions(instanceId);
  }

  async function removeSession(instanceId: string, alias: string): Promise<void> {
    await api.rpc(instanceId, "control.sessions.remove", { alias });
    await loadSessions(instanceId);
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind === "instance-status") {
      const inst = byId(event.instanceId);
      if (inst) inst.online = event.online;
    } else if (event.kind === "control-event" && event.event.type === "sessions-changed") {
      void loadSessions(event.instanceId);
    }
  }

  function byId(id: string): InstanceView | undefined {
    return instances.value.find((i) => i.id === id);
  }

  return { instances, loadInstances, loadSessions, createSession, removeSession, applyEvent };
});
```

- [ ] **Step 5: Implement InstanceTree (left column)**

`packages/relay-web/src/components/InstanceTree.vue`:
```vue
<script setup lang="ts">
import { useInstancesStore } from "../stores/instances";

const store = useInstancesStore();
const emit = defineEmits<{ select: [instanceId: string, alias: string] }>();

async function toggle(id: string) {
  await store.loadSessions(id);
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto border-r bg-white">
    <div v-for="inst in store.instances" :key="inst.id" class="border-b">
      <button class="flex w-full items-center gap-2 px-3 py-2 text-left" @click="toggle(inst.id)">
        <span class="h-2 w-2 rounded-full" :class="inst.online ? 'bg-green-500' : 'bg-slate-300'" data-test="online-dot" />
        <span class="font-medium">{{ inst.name }}</span>
      </button>
      <ul>
        <li v-for="s in inst.sessions" :key="s.alias">
          <button class="flex w-full items-center gap-2 px-6 py-1 text-left text-sm hover:bg-slate-50"
                  @click="emit('select', inst.id, s.alias)">
            <span v-if="s.running" class="text-amber-500">●</span>
            {{ s.alias }} <span class="text-slate-400">({{ s.agent }})</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Add the InstanceTree component test**

Append to `packages/relay-web/src/__tests__/instances.test.ts`:
```ts
import { mount } from "@vue/test-utils";
import InstanceTree from "../components/InstanceTree.vue";

test("InstanceTree renders an online dot per instance", () => {
  setActivePinia(createPinia());
  const store = useInstancesStore();
  store.instances = [
    { id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] },
    { id: "i2", name: "srv", online: false, lastSeenAt: null, sessions: [] },
  ];
  const wrapper = mount(InstanceTree);
  const dots = wrapper.findAll('[data-test="online-dot"]');
  expect(dots.length).toBe(2);
  expect(dots[0]!.classes()).toContain("bg-green-500");
  expect(dots[1]!.classes()).toContain("bg-slate-300");
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun run --cwd packages/relay-web test src/__tests__/instances.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/relay-web/src/api/events.ts packages/relay-web/src/stores/instances.ts packages/relay-web/src/components/InstanceTree.vue packages/relay-web/src/__tests__/instances.test.ts
git commit -m "feat(relay-web): WS events client, instances store, and instance tree"
```

---

## Task 11: relay-web — chat store + ChatPane/MessageList/PromptInput (middle column)

**Files:**
- Create: `packages/relay-web/src/stores/chat.ts`, `src/components/ChatPane.vue`, `src/components/MessageList.vue`, `src/components/PromptInput.vue`
- Test: `packages/relay-web/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/relay-web/src/__tests__/chat.test.ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { useChatStore } from "../stores/chat";
import PromptInput from "../components/PromptInput.vue";

beforeEach(() => setActivePinia(createPinia()));

test("streaming turn output accumulates then commits on finish", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" } });
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "lo" } });
  expect(store.streaming).toBe("hello");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true } });
  expect(store.streaming).toBe("");
  expect(store.messages.at(-1)).toMatchObject({ direction: "out", text: "hello" });
});

test("events for a different session are ignored", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "x", sessionAlias: "other", chunk: "nope" } });
  expect(store.streaming).toBe("");
});

test("loadHistory pulls cached messages for the selected session", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    messages: [{ instanceId: "i1", sessionAlias: "backend", direction: "in", text: "hi", createdAt: "t" }],
  }), { status: 200 })));
  const store = useChatStore();
  store.select("i1", "backend");
  await store.loadHistory();
  expect(store.messages.map((m) => m.text)).toEqual(["hi"]);
});

test("PromptInput emits send with trimmed text and clears", async () => {
  const wrapper = mount(PromptInput);
  await wrapper.find("textarea").setValue("  do it  ");
  await wrapper.find("form").trigger("submit.prevent");
  expect(wrapper.emitted("send")?.[0]).toEqual(["do it"]);
  expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/relay-web test src/__tests__/chat.test.ts`
Expected: FAIL — `stores/chat` not found.

- [ ] **Step 3: Implement the chat store**

`packages/relay-web/src/stores/chat.ts`:
```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import type { MessageRecordDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api } from "../api/client";

export const useChatStore = defineStore("chat", () => {
  const instanceId = ref<string | null>(null);
  const sessionAlias = ref<string | null>(null);
  const messages = ref<MessageRecordDto[]>([]);
  const streaming = ref("");
  const sending = ref(false);

  function select(id: string, alias: string): void {
    instanceId.value = id;
    sessionAlias.value = alias;
    messages.value = [];
    streaming.value = "";
  }

  async function loadHistory(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    const { messages: rows } = await api.get<{ messages: MessageRecordDto[] }>(
      `/api/instances/${instanceId.value}/sessions/${sessionAlias.value}/messages`,
    );
    messages.value = rows;
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "control-event") return;
    const e = event.event;
    if (event.instanceId !== instanceId.value) return;
    if (e.type === "turn-output" && e.sessionAlias === sessionAlias.value) {
      streaming.value += e.chunk;
    } else if (e.type === "turn-finished" && e.sessionAlias === sessionAlias.value) {
      if (streaming.value) {
        messages.value.push({ instanceId: event.instanceId, sessionAlias: e.sessionAlias, direction: "out", text: streaming.value, createdAt: new Date().toISOString() });
      }
      streaming.value = "";
    }
  }

  async function send(text: string): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    sending.value = true;
    messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "in", text, createdAt: new Date().toISOString() });
    try {
      if (text.startsWith("/")) {
        const { output } = await api.rpc<{ output: string }>(instanceId.value, "control.command.execute", { text });
        messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "out", text: output, createdAt: new Date().toISOString() });
      } else {
        await api.rpc(instanceId.value, "control.prompt", { sessionAlias: sessionAlias.value, text });
      }
    } finally {
      sending.value = false;
    }
  }

  return { instanceId, sessionAlias, messages, streaming, sending, select, loadHistory, applyEvent, send };
});
```

- [ ] **Step 4: Implement the components**

`packages/relay-web/src/components/MessageList.vue`:
```vue
<script setup lang="ts">
import type { MessageRecordDto } from "@ganglion/xacpx-relay-protocol";
defineProps<{ messages: MessageRecordDto[]; streaming: string }>();
</script>

<template>
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.direction === 'in' ? 'justify-end' : 'justify-start'">
      <pre class="max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm"
           :class="m.direction === 'in' ? 'bg-slate-800 text-white' : 'bg-slate-100'">{{ m.text }}</pre>
    </div>
    <div v-if="streaming" class="flex justify-start">
      <pre class="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm opacity-70">{{ streaming }}</pre>
    </div>
  </div>
</template>
```

`packages/relay-web/src/components/PromptInput.vue`:
```vue
<script setup lang="ts">
import { ref } from "vue";
const emit = defineEmits<{ send: [text: string] }>();
const text = ref("");
function submit() {
  const value = text.value.trim();
  if (!value) return;
  emit("send", value);
  text.value = "";
}
</script>

<template>
  <form class="border-t p-3" @submit.prevent="submit">
    <textarea v-model="text" rows="2" class="w-full resize-none rounded border px-3 py-2 text-sm"
              placeholder="Message, or /command" @keydown.enter.exact.prevent="submit" />
  </form>
</template>
```

`packages/relay-web/src/components/ChatPane.vue`:
```vue
<script setup lang="ts">
import { useChatStore } from "../stores/chat";
import MessageList from "./MessageList.vue";
import PromptInput from "./PromptInput.vue";

const chat = useChatStore();
</script>

<template>
  <div class="flex h-full flex-1 flex-col">
    <div v-if="!chat.sessionAlias" class="flex flex-1 items-center justify-center text-slate-400">
      Select a session
    </div>
    <template v-else>
      <div class="border-b px-4 py-2 text-sm font-medium">{{ chat.sessionAlias }}</div>
      <MessageList :messages="chat.messages" :streaming="chat.streaming" />
      <PromptInput @send="chat.send" />
    </template>
  </div>
</template>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run --cwd packages/relay-web test src/__tests__/chat.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/components/ChatPane.vue packages/relay-web/src/components/MessageList.vue packages/relay-web/src/components/PromptInput.vue packages/relay-web/src/__tests__/chat.test.ts
git commit -m "feat(relay-web): chat store with streaming turns and chat pane components"
```

---

## Task 12: relay-web — DashboardView three-column shell + event lifecycle

**Files:**
- Modify: `packages/relay-web/src/views/DashboardView.vue`
- Test: `packages/relay-web/src/__tests__/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/relay-web/src/__tests__/dashboard.test.ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Stub the WS client so jsdom needs no real socket.
const disconnect = vi.fn();
vi.mock("../api/events", () => ({ connectEvents: () => disconnect }));

import DashboardView from "../views/DashboardView.vue";
import { useInstancesStore } from "../stores/instances";
import { useChatStore } from "../stores/chat";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ instances: [] }), { status: 200 })));
});

test("dashboard renders three columns and loads instances on mount", async () => {
  const store = useInstancesStore();
  const spy = vi.spyOn(store, "loadInstances");
  const wrapper = mount(DashboardView, { global: { stubs: { ChatPane: true, InstanceTree: true } } });
  await flushPromises();
  expect(spy).toHaveBeenCalled();
  expect(wrapper.findAll('[data-test="column"]').length).toBe(3);
});

test("selecting a session routes it into the chat store", async () => {
  const chat = useChatStore();
  const wrapper = mount(DashboardView, { global: { stubs: { ChatPane: true } } });
  await flushPromises();
  wrapper.findComponent({ name: "InstanceTree" }).vm.$emit("select", "i1", "backend");
  expect(chat.instanceId).toBe("i1");
  expect(chat.sessionAlias).toBe("backend");
});
```

> The second test relies on `InstanceTree` keeping `name: "InstanceTree"`. SFCs compiled by `@vitejs/plugin-vue` infer the name from the filename, so `findComponent({ name: "InstanceTree" })` resolves. If it doesn't in your toolchain version, switch to `findComponent(InstanceTree)` with an explicit import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/relay-web test src/__tests__/dashboard.test.ts`
Expected: FAIL — placeholder DashboardView has no columns.

- [ ] **Step 3: Implement DashboardView**

`packages/relay-web/src/views/DashboardView.vue`:
```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { connectEvents } from "../api/events";
import { useInstancesStore } from "../stores/instances";
import { useChatStore } from "../stores/chat";
import InstanceTree from "../components/InstanceTree.vue";
import ChatPane from "../components/ChatPane.vue";

const instances = useInstancesStore();
const chat = useChatStore();
let disconnect: (() => void) | null = null;

function onSelect(instanceId: string, alias: string) {
  chat.select(instanceId, alias);
  void chat.loadHistory();
}

onMounted(async () => {
  await instances.loadInstances();
  disconnect = connectEvents((event) => {
    instances.applyEvent(event);
    chat.applyEvent(event);
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <div class="flex h-screen">
    <div data-test="column" class="w-72 shrink-0">
      <InstanceTree @select="onSelect" />
    </div>
    <div data-test="column" class="flex flex-1 flex-col">
      <ChatPane />
    </div>
    <div data-test="column" class="hidden w-72 shrink-0 border-l bg-white lg:block">
      <div class="p-4 text-sm text-slate-400">Tasks panel — phase 4</div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --cwd packages/relay-web test src/__tests__/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Full frontend suite + production build**

Run: `bun run --cwd packages/relay-web test && bun run build:relay-web`
Expected: all web tests pass; `vue-tsc` typecheck clean; Vite build emits `packages/relay-web/dist`.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/dashboard.test.ts
git commit -m "feat(relay-web): three-column dashboard shell with live event wiring"
```

---

## Task 13: end-to-end backend integration test + docs + memory

**Files:**
- Test: `tests/unit/packages/relay/web-dashboard-e2e.test.ts`
- Create: `docs/relay-web-module.md`
- Modify: `docs/relay-module.md`, `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-06-13-relay-hub-design.md` (status note)

- [ ] **Step 1: Write the end-to-end backend test**

Model on the existing `tests/unit/packages/relay/integration.test.ts` harness (real runtime + real `ws` instance gateway + fake control + `RelayClient`). Add a web WS client that asserts the full path: instance online → web `instance-status`; instance turn output → web `control-event` + cached history readable over HTTP.

```ts
// tests/unit/packages/relay/web-dashboard-e2e.test.ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { decodeEnvelope, parseWebServerEvent } from "../../../../packages/relay-protocol/src/index";
import { startRelayServer } from "../../../../packages/relay/src/server";
import { CredentialStore } from "../../../../packages/channel-relay/src/credential-store";
import { createControlBridge, subscribeControlEvents } from "../../../../packages/channel-relay/src/control-bridge";
import { RelayClient } from "../../../../packages/channel-relay/src/relay-client";

test("instance event flows to web client and is cached as history", async () => {
  const relay = await startRelayServer({ dbPath: ":memory:", httpPort: 0, wsPort: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${relay.httpPort}`;

  relay.runtime.accounts.createAccount("admin", "pw", "admin");
  const login = await fetch(`${base}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "pw" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const tokenRes = await fetch(`${base}/api/instances/pairing-token`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  const { token } = (await tokenRes.json()) as { token: string };

  const listeners: Array<(event: unknown) => void> = [];
  const fakeControl = {
    listSessions: () => [],
    events: { subscribe: (l: (event: unknown) => void) => { listeners.push(l); return () => {}; } },
  };

  const credentialPath = join(mkdtempSync(join(tmpdir(), "relay-e2e-")), "credential.json");
  const controller = new AbortController();
  await new Promise<void>((resolve) => {
    const client = new RelayClient({
      url: `ws://127.0.0.1:${relay.wsPort}`, credentialStore: new CredentialStore(credentialPath),
      pairingToken: token, coreVersion: "0.11.0",
      onRequest: createControlBridge(fakeControl as never), onReady: resolve, reconnectDelaysMs: [0],
    });
    subscribeControlEvents(fakeControl as never, (type, payload) => client.sendEvent(type, payload));
    client.start(controller.signal);
  });

  // web client connects and collects events
  const ws = new WebSocket(`ws://127.0.0.1:${relay.httpPort}/ws`, { headers: { cookie } });
  const events: string[] = [];
  ws.on("message", (d) => events.push(String(d)));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));

  // instance emits a streamed turn
  listeners.forEach((l) => l({ type: "turn-output", chatKey: "relay:x", sessionAlias: "backend", chunk: "done" }));
  listeners.forEach((l) => l({ type: "turn-finished", chatKey: "relay:x", sessionAlias: "backend", ok: true }));
  await new Promise((r) => setTimeout(r, 150));

  const kinds = events
    .map((raw) => { const d = decodeEnvelope(raw); return d.ok ? parseWebServerEvent(d.envelope) : null; })
    .filter(Boolean)
    .map((e) => e!.kind);
  expect(kinds).toContain("control-event");

  const instanceId = relay.runtime.instances.listByAccount(relay.runtime.accounts.findByUsername("admin")!.id)[0]!.id;
  const histRes = await fetch(`${base}/api/instances/${instanceId}/sessions/backend/messages`, { headers: { cookie } });
  const { messages } = (await histRes.json()) as { messages: Array<{ direction: string; text: string }> };
  expect(messages).toEqual([{ instanceId, sessionAlias: "backend", direction: "out", text: "done", createdAt: messages[0]!.createdAt } as never]);

  ws.close();
  controller.abort();
  await relay.close();
});
```

> If `InstanceStore.listByAccount` returns camelCase rows, adjust the `instanceId` extraction accordingly. Verify the exact shape against `packages/relay/src/stores/instances.ts` before finalizing.

- [ ] **Step 2: Run the e2e test**

Run: `bun run build:relay-protocol && bun test tests/unit/packages/relay/web-dashboard-e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `docs/relay-web-module.md`**

Document: purpose (three-column dashboard), stack (Vue 3 + Vite + Pinia + Tailwind + Vitest), the snapshot-plus-event model (REST snapshot + `/ws` deltas), file map (api/stores/views/components), how it talks to relay (REST `/api/*` + `/api/instances/:id/rpc`, WS `/ws`), how it's served in production (`xacpx-relay start --web-root <dist>`), dev (`bun run --cwd packages/relay-web dev` with Vite proxy to 8787), test command (`bun run test:web`), and the phase-3 scope boundary (task panels/settings/pairing UI are phase 4).

- [ ] **Step 4: Update `docs/relay-module.md`**

Add: the `messages` cache table (§5), `MessageStore`, `WebGateway`, the gateway `onStatusChange`/`onEvent` wiring, the `/ws` cookie-auth web fan-out endpoint, the `GET /api/instances/:id/sessions/:alias/messages` endpoint, the prompt-echo-to-history behavior, and the `--web-root` static-hosting flag.

- [ ] **Step 5: Add an `AGENTS.md` nav line**

Under the relay docs navigation, add one line linking `docs/relay-web-module.md` (Web 看板模块说明). Edit `AGENTS.md` only — never `CLAUDE.md` (it is a symlink).

- [ ] **Step 6: Note phase-3 completion in the spec**

In `docs/superpowers/specs/2026-06-13-relay-hub-design.md` §11, mark 阶段三 as implemented (web dashboard: login + session tree + chat flow; web fan-out + messages cache landed), noting task panels/settings remain 阶段四.

- [ ] **Step 7: Full gate + builds**

Run: `npm test && bun run build:relay && bun run build:relay-web`
Expected: `tsc --noEmit` clean, all bun tests pass, web Vitest passes, both builds succeed.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/packages/relay/web-dashboard-e2e.test.ts docs/relay-web-module.md docs/relay-module.md AGENTS.md docs/superpowers/specs/2026-06-13-relay-hub-design.md
git commit -m "test(relay): end-to-end web fan-out; phase-3 docs and spec note"
```

- [ ] **Step 9: Update project memory**

Update `project_relay_hub_multiphase.md`: phase 3 complete on a stacked branch; record deliverables (web fan-out gateway, messages cache, `/ws` endpoint, relay-web SPA with login/session-tree/chat); note phase 4 remaining (task panels, settings, pairing UI, error-recovery polish).

---

## Self-Review (controller checklist)

- **Spec coverage:** §4.4 web API + WS fan-out (Tasks 4–7), §4.5 left/middle columns (Tasks 10–12), §5 messages table (Task 2), §6 pairing (unchanged; CLI from phase 2), §9 reconnect (events client backoff, Task 10) — all mapped. Right column / settings / pairing UI deferred to phase 4 by design.
- **Type consistency:** `WebServerEvent`, `MessageRecordDto`, `MessageDirection`, `WEB_EVENT_TYPE`, `webEventEnvelope`, `parseWebServerEvent` defined in Task 1 and used verbatim in Tasks 4/5/10/11. `MessageStore.listBySession(accountId, instanceId, sessionAlias, limit)` signature consistent across Tasks 2/5/6/13. `api.rpc(instanceId, type, payload)` consistent across Tasks 9/10/11.
- **Ordering:** Task 5 references `createApp`'s `messages`/`webRoot` deps that Task 6 formally lands — note included; subagent-driven execution runs in order and the full-suite `tsc` is asserted green at Task 7/13.
- **No placeholders:** every code step shows real code; every test step shows real assertions and an exact run command.
