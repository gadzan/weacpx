# Relay Hub Phase 5 — Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects found by the five-way phase-4 audit — relay-web error-recovery/UX bugs, two server-side hardening gaps, connector credential-file robustness + protocol-mismatch surfacing, a wire-trust validation gap, and two unbuilt §4.5 UI features — without weakening any of the verified-correct multi-tenancy/security invariants.

**Architecture:** No architectural change. Each fix is local to its layer: relay server (`packages/relay`), protocol (`packages/relay-protocol`), connector (`packages/channel-relay`), web SPA (`packages/relay-web`). The verified-correct invariants (account_id scoping, server-side identity stamping, hashed secrets) must remain intact — these tasks only add validation, surface errors, and build missing UI.

**Tech Stack:** Backend — TypeScript, Hono, SQLite via `SqlDriver`, `node:crypto`, `bun test`. Frontend — Vue 3 + Pinia + vue-router + Tailwind, Vitest + `@vue/test-utils` + jsdom.

---

## Scope & Conventions

- **Branch:** `feat/relay-hub-phase5-audit-fixes`, stacked on phase-4 HEAD `6960d9f` (kept unmerged/unpushed like phases 1–4).
- **Verification commands** (root `tsc --noEmit` only covers `src/**`; use package builds):
  - `bun run build:relay` / `build:relay-protocol` / `build:channel-relay` / `build:relay-web`
  - Backend tests per-file only (NEVER whole-dir bun test): `bun test tests/unit/packages/<pkg>/<file>.test.ts`
  - Frontend tests: `bun run --cwd packages/relay-web test`
  - Full gate: `npm test`
- **channel-relay tests** require sibling `dist/` first: run `bun run build:relay-protocol` (and `build:channel-relay` if the test imports built output) before `bun test tests/unit/packages/channel-relay/*`.
- **Environment:** a shell hook (rtk) can garble `cat`/`grep`/`head` — use the Read tool for source. Git hygiene: stage only the listed files; never `git add -A`, `bun.lock`, `dist/`, `node_modules/`, or `CLAUDE.md` (symlink).
- **Audit finding → task map:** #6/#8→T1, #7→T1, verifyCredential+gateway-drain→T2, parseWebServerEvent→T3, #9→T4, #10+executeAt→T5, C1+I6→T6, C2+I3+I4+I5→T7, cancel-in-flight→T8, create/delete-session UI→T9, docs→T10.

---

## File Structure

- `packages/relay/src/http/app.ts` — requireJson on pairing-token + invites; bounded login rate-limiter (T1).
- `packages/relay/src/gateway/instance-gateway.ts` — drain pending requests on socket close (T2).
- `packages/relay/src/stores/instances.ts` + `src/auth.ts` — timing-safe credential compare (T2).
- `packages/relay-protocol/src/web-dtos.ts` — deep-validate control-event/notice in `parseWebServerEvent` (T3).
- `packages/channel-relay/src/credential-store.ts` — atomic 0600 write (T4).
- `packages/channel-relay/src/relay-client.ts` — surface protocol-mismatch + handle `relay.protocol-error` (T5).
- `packages/channel-relay/src/control-bridge.ts` — validate `executeAt` (T5).
- `packages/relay-web/src/api/events.ts` + `views/DashboardView.vue` — clear reconnect timer; re-pull snapshot on reconnect (T6).
- `packages/relay-web/src/stores/chat.ts` + `components/ChatPane.vue` + `components/MessageList.vue` — turn-failure handling, error banner, clear-on-select, optimistic failed-marker (T7).
- chat store + ChatPane — cancel in-flight turn (T8).
- `packages/relay-web/src/components/InstanceTree.vue` (+ a small session form) — create/delete logical session UI (T9).
- Docs + spec §11 + memory (T10).

---

### Task 1: Server HTTP hardening — CSRF backstop + bounded rate-limiter

Audit #6 (pairing-token endpoint parses a JSON body and issues a credential but lacks the `requireJson` 415 guard the other mutating routes have), #8 (invites endpoint defense-in-depth), #7 (login rate-limiter map grows unbounded and never time-evicts → memory DoS).

**Files:**
- Modify: `packages/relay/src/http/app.ts`
- Test: `tests/unit/packages/relay/http-app.test.ts`

- [ ] **Step 1: Write failing tests**

Read the existing `http-app.test.ts` harness (its inline `makeApp`/cookie setup). Add:

```ts
test("pairing-token rejects non-JSON bodies with 415", async () => {
  const h = await makeHarness();
  const res = await h.app.request("/api/instances/pairing-token", {
    method: "POST",
    headers: { cookie: h.cookie, "content-type": "text/plain" },
    body: "name=x",
  });
  expect(res.status).toBe(415);
});

test("invites rejects non-JSON bodies with 415", async () => {
  const h = await makeHarness(); // admin cookie
  const res = await h.app.request("/api/invites", {
    method: "POST",
    headers: { cookie: h.adminCookie, "content-type": "text/plain" },
    body: "x",
  });
  expect(res.status).toBe(415);
});

test("login rate-limiter evicts expired entries and is bounded", async () => {
  // Drive many distinct failed usernames with a controllable clock; assert the
  // internal failure map does not grow without bound. Use the app's injectable
  // `now` (deps.now) to advance past LOGIN_WINDOW_MS and confirm a later login
  // for an evicted username is not throttled, and that the map is pruned.
  // Implement by exposing a tiny test seam if needed (see Step 3 note).
});
```

For the rate-limiter test: the cleanest assertion is behavioral — after `LOGIN_WINDOW_MS` elapses (advance `deps.now`), a username that previously accumulated failures is treated fresh, AND repeatedly hitting login with thousands of distinct usernames does not retain all of them. If asserting map size requires a seam, prefer asserting eviction behavior (an old entry is gone) over reaching into internals. Read the current handler to pick the exact seam; do NOT add a production-only-for-test export unless unavoidable.

- [ ] **Step 2: Run, verify failure**

`bun test tests/unit/packages/relay/http-app.test.ts` → the two 415 tests fail (currently 200/4xx other than 415); rate-limiter test fails or reveals unbounded retention.

- [ ] **Step 3: Implement**

In `packages/relay/src/http/app.ts`:

1. Add the `requireJson` 415 guard as the FIRST statement of the `POST /api/instances/pairing-token` handler and the `POST /api/invites` handler (mirror the existing guard in `/api/login`):
```ts
    if (!requireJson(c.req.header("content-type"))) return c.json({ error: "unsupported-media-type" }, 415);
```
Note: `/api/invites` currently doesn't read a body — adding the guard is intentional defense-in-depth (forces a CORS preflight on cross-site forgery). Keep the admin-role check after the guard.

2. Bound the login rate-limiter. The `loginFailures` Map is keyed by username and only deleted on success. Add eviction so it can't grow unbounded:
   - On each login attempt, before inserting/reading, prune entries whose window has elapsed: iterate and delete entries where `nowMs - entry.windowStart >= LOGIN_WINDOW_MS`. To bound the per-request cost, only run the full sweep when the map exceeds a cap (e.g. `if (loginFailures.size > 1024) { for (const [k, v] of loginFailures) if (nowMs - v.windowStart >= LOGIN_WINDOW_MS) loginFailures.delete(k); }`), and additionally, as a hard backstop, if after sweeping `loginFailures.size` still exceeds a max (e.g. 4096), drop the oldest-window entries until under the cap. Use module consts `LOGIN_FAILURES_SWEEP_AT = 1024` and `LOGIN_FAILURES_MAX = 4096`.
   - This preserves the existing throttle semantics for active brute-force on a real username while preventing memory exhaustion from random-username flooding.

- [ ] **Step 4: Run, verify pass**

`bun test tests/unit/packages/relay/http-app.test.ts` → all pass (existing tests still green).

- [ ] **Step 5: Typecheck**

`bun run build:relay` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/http/app.ts tests/unit/packages/relay/http-app.test.ts
git commit -m "fix(relay): CSRF 415 guard on pairing-token/invites; bound login rate-limiter"
```

---

### Task 2: Gateway pending-drain on disconnect + timing-safe credential compare

Audit: `InstanceGateway.sendRequest` leaves in-flight promises pending until the 15s timeout when the instance disconnects mid-request — they should fail fast with `instance-offline`. Plus `verifyCredential` uses a non-timing-safe `!==` string compare.

**Files:**
- Modify: `packages/relay/src/gateway/instance-gateway.ts`
- Modify: `packages/relay/src/stores/instances.ts`, `packages/relay/src/auth.ts`
- Test: `tests/unit/packages/relay/instance-gateway.test.ts` (create if absent; otherwise add), `tests/unit/packages/relay/instances.test.ts` (or wherever store tests live — find via Read on the dir)

- [ ] **Step 1: Write failing tests**

For the gateway, drive a fake socket: auth it, start a `sendRequest`, then fire the socket `close` handler and assert the in-flight promise rejects with `instance-offline` (not after a 15s timeout). Read the existing gateway test file (or `integration.test.ts`) for the fake-socket pattern. Sketch:

```ts
test("sendRequest pending requests reject with instance-offline on disconnect", async () => {
  // build gateway with a fake socket; complete the auth handshake so `authed` is set
  // and connections.set runs; call sendRequest (do not respond); trigger the socket
  // "close" listener; await expect(pendingPromise).rejects.toThrow("instance-offline")
});
```

For timing-safe compare, a behavioral test is weak (timing is hard to assert deterministically); instead assert `verifyCredential` still returns the instance for a correct credential and null for a wrong one (regression guard that the refactor didn't break correctness):

```ts
test("verifyCredential accepts the right credential and rejects a wrong one", () => {
  // issue+redeem a pairing token to get a real credential, then verifyCredential
  // returns the instance for the right credential and null for a tampered one
});
```

- [ ] **Step 2: Run, verify failure**

Gateway test fails (promise stays pending past the test or rejects only via timeout). Run with a short `requestTimeoutMs` in the test so a non-drained pending would otherwise hang — set `requestTimeoutMs` large (e.g. default) so the test proves the drain, not the timeout, rejects it.

- [ ] **Step 3: Implement gateway drain**

In `instance-gateway.ts`, the pending map currently has no per-instance association. Add the instance id to each `PendingRequest` so close can drain selectively. Change `PendingRequest` to include `instanceId: string`, set it in `sendRequest` (`this.pending.set(id, { resolve, reject, timer, instanceId })`), and in the `socket.on("close")` handler (after `connections.delete`), drain:
```ts
    socket.on("close", () => {
      if (authed) {
        this.connections.delete(authed.instanceId);
        for (const [id, p] of this.pending) {
          if (p.instanceId === authed.instanceId) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(new Error("instance-offline"));
          }
        }
        this.deps.onStatusChange?.(authed.instanceId, authed.accountId, false);
      }
    });
```

- [ ] **Step 4: Implement timing-safe compare**

Read `packages/relay/src/auth.ts` — it already uses `timingSafeEqual` for `verifyPassword`. Add an exported helper `hashEquals(aHashHex: string, bHashHex: string): boolean` that compares two equal-length hex hash strings via `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`, guarding unequal lengths (return false without throwing). In `instances.ts` `verifyCredential`, replace `row.credential_hash !== hashToken(credential)` with `!hashEquals(row.credential_hash, hashToken(credential))` (import `hashEquals` from `../auth.js`).

- [ ] **Step 5: Run, verify pass + typecheck**

`bun test tests/unit/packages/relay/instance-gateway.test.ts` (and the instances test) → pass; `bun test tests/unit/packages/relay/integration.test.ts` → still pass (drain doesn't break the happy path); `bun run build:relay` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/gateway/instance-gateway.ts packages/relay/src/stores/instances.ts packages/relay/src/auth.ts tests/unit/packages/relay/instance-gateway.test.ts tests/unit/packages/relay/instances.test.ts
git commit -m "fix(relay): drain in-flight requests on instance disconnect; timing-safe credential compare"
```
(Adjust the staged test paths to the files you actually created/changed.)

---

### Task 3: Deep-validate web events at the wire-trust boundary

Audit: `parseWebServerEvent` only checks the outer wrapper and that `event`/`notice` are non-null objects — the inner `ControlEventDto` discriminant and `InstanceNoticePayload` shape are never validated. A malformed inner payload is cast through to the web stores.

**Files:**
- Modify: `packages/relay-protocol/src/web-dtos.ts`
- Test: `tests/unit/packages/relay-protocol/web-dtos.test.ts` (find the existing protocol test file via Read on `tests/unit/packages/relay-protocol/`; add cases there)

- [ ] **Step 1: Write failing tests**

Add rejection cases for malformed inner payloads (these currently PASS the guard, which is the bug):

```ts
it("rejects a control-event whose inner event has no valid type", () => {
  const env = webEventEnvelope({ kind: "control-event", instanceId: "i", event: { type: "__bogus__" } as never });
  expect(parseWebServerEvent(env)).toBeNull();
});
it("rejects a turn-output event missing sessionAlias/chunk", () => {
  const env = { ...webEventEnvelope({ kind: "control-event", instanceId: "i", event: { type: "turn-output" } as never }) };
  expect(parseWebServerEvent(env)).toBeNull();
});
it("rejects a notice missing kind/text", () => {
  const env = webEventEnvelope({ kind: "notice", instanceId: "i", notice: { foo: 1 } as never });
  expect(parseWebServerEvent(env)).toBeNull();
});
it("accepts a well-formed turn-output / turn-finished / sessions-changed / notice", () => {
  expect(parseWebServerEvent(webEventEnvelope({ kind: "control-event", instanceId: "i", event: { type: "turn-output", chatKey: "c", sessionAlias: "s", chunk: "x" } }))).not.toBeNull();
  expect(parseWebServerEvent(webEventEnvelope({ kind: "control-event", instanceId: "i", event: { type: "turn-finished", chatKey: "c", sessionAlias: "s", ok: true } }))).not.toBeNull();
  expect(parseWebServerEvent(webEventEnvelope({ kind: "control-event", instanceId: "i", event: { type: "sessions-changed" } }))).not.toBeNull();
  expect(parseWebServerEvent(webEventEnvelope({ kind: "notice", instanceId: "i", notice: { kind: "task-completion", text: "done" } }))).not.toBeNull();
});
```

- [ ] **Step 2: Run, verify failure**

`bun test tests/unit/packages/relay-protocol/web-dtos.test.ts` → the three rejection tests fail (currently parse returns non-null).

- [ ] **Step 3: Implement inner validation**

In `web-dtos.ts`, extend `parseWebServerEvent` so the `control-event` branch validates the `ControlEventDto` discriminant and required fields per variant, and the `notice` branch validates `notice.kind` (one of `task-completion`/`task-progress`/`coordinator-message`) and `notice.text` is a string. Add a `validateControlEvent(event: unknown): boolean` helper:
```ts
const CONTROL_EVENT_TYPES = new Set(["turn-output", "turn-finished", "sessions-changed", "scheduled-changed", "orchestration-changed"]);
function validControlEvent(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const c = e as Record<string, unknown>;
  if (typeof c.type !== "string" || !CONTROL_EVENT_TYPES.has(c.type)) return false;
  if (c.type === "turn-output") return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && typeof c.chunk === "string";
  if (c.type === "turn-finished") return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && typeof c.ok === "boolean";
  if (c.type === "scheduled-changed") return typeof c.chatKey === "string";
  return true; // sessions-changed / orchestration-changed carry no extra fields
}
const NOTICE_KINDS = new Set(["task-completion", "task-progress", "coordinator-message"]);
function validNotice(n: unknown): boolean {
  if (typeof n !== "object" || n === null) return false;
  const c = n as Record<string, unknown>;
  return typeof c.kind === "string" && NOTICE_KINDS.has(c.kind) && typeof c.text === "string";
}
```
Then in `parseWebServerEvent`, replace the shallow `event`/`notice` object checks with `validControlEvent(candidate.event)` and `validNotice(candidate.notice)` respectively.

- [ ] **Step 4: Run, verify pass + build**

`bun test tests/unit/packages/relay-protocol/web-dtos.test.ts` → all pass. `bun run build:relay-protocol` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src/web-dtos.ts tests/unit/packages/relay-protocol/web-dtos.test.ts
git commit -m "fix(relay-protocol): deep-validate control-event/notice in parseWebServerEvent"
```

---

### Task 4: Atomic 0600 credential write in the connector

Audit #9: `CredentialStore.save` uses `writeFileSync(..., {mode: 0o600})`, which only applies the mode when CREATING the file (re-saving over a looser-perm file keeps old perms), and the truncate-then-write is non-atomic (crash mid-write corrupts the credential → if the one-shot pairing token was already consumed, permanent lockout).

**Files:**
- Modify: `packages/channel-relay/src/credential-store.ts`
- Test: `tests/unit/packages/channel-relay/credential-store.test.ts`

- [ ] **Step 1: Write failing tests**

Read the existing `credential-store.test.ts`. Add a perms assertion (currently untested) and a re-save assertion:

```ts
import { statSync, writeFileSync } from "node:fs";

it("writes the credential file with 0600 perms", () => {
  const dir = mkdtempSync(join(tmpdir(), "cred-"));
  const path = join(dir, "credential.json");
  const store = new CredentialStore(path);
  store.save({ instanceId: "i", credential: "c", relayUrl: "ws://x" });
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it("re-tightens perms when overwriting a loosened file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cred-"));
  const path = join(dir, "credential.json");
  writeFileSync(path, "{}", { mode: 0o644 });
  const store = new CredentialStore(path);
  store.save({ instanceId: "i", credential: "c", relayUrl: "ws://x" });
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(store.load()?.instanceId).toBe("i");
});
```

(Adapt imports to the test file's existing `mkdtempSync`/`tmpdir`/`join` usage.)

- [ ] **Step 2: Run, verify failure**

`bun run build:relay-protocol && bun test tests/unit/packages/channel-relay/credential-store.test.ts` → the re-tighten test fails (overwrite keeps 0644).

- [ ] **Step 3: Implement atomic write**

In `credential-store.ts` `save`, write to a temp file in the same directory with mode 0600, then `renameSync` over the target (atomic on the same filesystem); rename also replaces perms with the temp file's. Import `renameSync`, `chmodSync`:
```ts
  save(credential: RelayCredential): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(credential, null, 2), { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600); // ensure perms even if the file pre-existed with a looser umask
    renameSync(tmp, this.filePath);
  }
```
(The `chmodSync` guards the case where the temp file already existed; `renameSync` makes the swap atomic so a crash leaves either the old or the new complete file, never a truncated one.)

- [ ] **Step 4: Run, verify pass + build**

`bun test tests/unit/packages/channel-relay/credential-store.test.ts` → pass. `bun run build:channel-relay` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/credential-store.ts tests/unit/packages/channel-relay/credential-store.test.ts
git commit -m "fix(channel-relay): atomic 0600 credential write (temp+rename)"
```

---

### Task 5: Surface protocol-version mismatch + validate executeAt in the connector

Audit #10: the connector silently drops any envelope that fails to decode (`if (!decoded.ok) return;`) — a `version-mismatch` produces no log/error/upgrade hint and the reconnect loop spins; the relay server's `relay.protocol-error` event (a valid envelope, `kind:"event"`) also falls through unhandled. Plus: the bridge doesn't validate `executeAt` for `scheduled.create`, yielding a generic `internal` error on bad input.

**Files:**
- Modify: `packages/channel-relay/src/relay-client.ts`
- Modify: `packages/channel-relay/src/control-bridge.ts`
- Test: `tests/unit/packages/channel-relay/relay-client.test.ts`, `tests/unit/packages/channel-relay/control-bridge.test.ts` (find via Read on the dir)

- [ ] **Step 1: Write failing tests**

For relay-client: drive `handleMessage` (or feed a raw message via the fake socket the existing tests use) with (a) a higher-protocol-version envelope and (b) a `relay.protocol-error` event, asserting the logger is called with a `version`/`protocol` code and that a version-mismatch stops reconnect (sets stopped). Read the existing relay-client test to reuse its socket/logger fakes. Sketch:

```ts
it("logs and stops on a protocol version mismatch from the relay", () => {
  // construct RelayClient with a fake logger; feed a raw string whose protocolVersion
  // is RELAY_PROTOCOL_VERSION + 1 (encode manually with the wrong version, or hand-craft JSON)
  // expect logger.error called with a code mentioning protocol/version
  // expect the client to NOT schedule another reconnect (stopped)
});
it("logs a relay.protocol-error event payload", () => {
  // feed an event envelope type "relay.protocol-error" with an errorPayload body
  // expect logger.error called with the error code/message
});
```

For control-bridge: call the dispatch with `scheduled.create` and a malformed `executeAt` (e.g. `"not-a-date"`), expect an `errorPayload` with a clear code like `bad-request` (not `internal`).

- [ ] **Step 2: Run, verify failure**

`bun run build:relay-protocol && bun test tests/unit/packages/channel-relay/relay-client.test.ts tests/unit/packages/channel-relay/control-bridge.test.ts` → new tests fail (silent drop; `internal` error).

- [ ] **Step 3: Implement relay-client surfacing**

In `relay-client.ts` `handleMessage`, replace the silent `if (!decoded.ok) return;` with handling that logs, and stops on a version mismatch:
```ts
    const decoded = decodeEnvelope(raw);
    if (!decoded.ok) {
      void this.options.logger?.error(
        "relay.decode_failed",
        `relay sent an undecodable message: ${decoded.error}`,
        { error: decoded.error, detail: decoded.detail ?? "" },
      );
      if (decoded.error === "version-mismatch") {
        // protocol skew is operator-action-required; stop hammering the relay
        this.stopped = true;
        this.socket?.close();
      }
      return;
    }
    const envelope = decoded.envelope;
    if (envelope.kind === "event" && envelope.type === "relay.protocol-error") {
      const p = envelope.payload;
      const detail = isErrorPayload(p) ? `${p.error.code}: ${p.error.message}` : "protocol error";
      void this.options.logger?.error("relay.protocol_error", `relay reported a protocol error: ${detail}`, {});
      this.stopped = true;
      this.socket?.close();
      return;
    }
```
(Confirm `decodeEnvelope`'s result shape exposes `.error`/`.detail` — it does per the protocol package. `isErrorPayload` is already imported.)

- [ ] **Step 4: Implement bridge executeAt validation**

In `control-bridge.ts`, in the `scheduled.create` case, before constructing the Date, validate:
```ts
      const ms = Date.parse(input.executeAt);
      if (Number.isNaN(ms)) return errorPayload("bad-request", "executeAt is not a valid ISO timestamp");
```
and use `new Date(ms)` (or pass the validated string through to the service as it does today). Read the current case to place this correctly without changing the success path.

- [ ] **Step 5: Run, verify pass + build**

`bun test tests/unit/packages/channel-relay/relay-client.test.ts tests/unit/packages/channel-relay/control-bridge.test.ts` → pass; existing connector tests still green; `bun run build:channel-relay` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/channel-relay/src/relay-client.ts packages/channel-relay/src/control-bridge.ts tests/unit/packages/channel-relay/relay-client.test.ts tests/unit/packages/channel-relay/control-bridge.test.ts
git commit -m "fix(channel-relay): surface protocol-version mismatch and protocol-error; validate executeAt"
```

---

### Task 6: Web reconnect — snapshot re-pull + reconnect-timer cleanup

Audit C1 (reconnect doesn't re-pull a snapshot → ghost state; deltas during the outage are lost) and I6 (`connectEvents` disposer doesn't clear a pending reconnect `setTimeout`, leaking a socket+timer if unmount happens during the backoff window).

**Files:**
- Modify: `packages/relay-web/src/api/events.ts`
- Modify: `packages/relay-web/src/views/DashboardView.vue`
- Test: `packages/relay-web/src/__tests__/events.test.ts` (new), and a DashboardView reconnect assertion (extend `dashboard.test.ts` or a new file)

- [ ] **Step 1: Write failing tests**

Create `packages/relay-web/src/__tests__/events.test.ts`. Mock `WebSocket` with a controllable fake (vitest `vi.stubGlobal("WebSocket", FakeWS)`) and fake timers (`vi.useFakeTimers()`). Assert: (a) after a close, a reconnect is scheduled; (b) calling the disposer clears the pending timer so no new socket is created after teardown; (c) `onStatus(false)` then `onStatus(true)` fire across a drop/reopen. Sketch:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "../api/events";

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(public url: string) { FakeWS.instances.push(this); }
}

describe("connectEvents", () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWS.instances = []; vi.stubGlobal("WebSocket", FakeWS as never); vi.stubGlobal("location", { protocol: "http:", host: "x" } as never); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not reconnect after the disposer runs during backoff", () => {
    const dispose = connectEvents(() => {});
    FakeWS.instances[0].onclose?.();        // drop → schedules reconnect
    dispose();                               // teardown during backoff
    vi.runOnlyPendingTimers();               // any pending reconnect timer fires
    expect(FakeWS.instances).toHaveLength(1); // no second socket created
  });

  it("reports status across drop and reopen", () => {
    const status: boolean[] = [];
    connectEvents(() => {}, (o) => status.push(o));
    FakeWS.instances[0].onopen?.();
    FakeWS.instances[0].onclose?.();
    vi.runOnlyPendingTimers();
    FakeWS.instances[1]?.onopen?.();
    expect(status).toEqual([true, false, true]);
  });
});
```

For DashboardView reconnect re-pull: in `dashboard.test.ts`, spy on `instances.loadInstances` and assert it is called again when the status callback transitions back to online after a prior offline. (The test mocks `connectEvents`; capture the `onStatus` callback it was given and invoke it false→true, then assert a re-pull.)

- [ ] **Step 2: Run, verify failure**

`bun run --cwd packages/relay-web test` → the disposer test fails (a second socket is created) and the DashboardView re-pull test fails (loadInstances not re-invoked).

- [ ] **Step 3: Implement events.ts timer cleanup**

In `events.ts`, track the reconnect timer and clear it on dispose; also guard the timer callback:
```ts
export function connectEvents(onEvent, onStatus?) {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    // ...unchanged...
    socket.onclose = () => {
      onStatus?.(false);
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(() => { timer = null; if (!closed) open(); }, 250 * 2 ** (retry - 1));
    };
  };
  open();
  return () => { closed = true; if (timer) { clearTimeout(timer); timer = null; } socket?.close(); };
}
```

- [ ] **Step 4: Implement DashboardView snapshot re-pull**

In `DashboardView.vue`, add a reconnect-aware status handler. Track whether we have connected before so the initial open (snapshot already loaded in `onMounted`) doesn't double-fetch, but a genuine reconnect re-pulls:
```ts
let everOnline = false;
async function reloadSnapshot() {
  await instances.loadInstances().catch(() => {});
  if (chat.instanceId && chat.sessionAlias) {
    await instances.loadSessions(chat.instanceId).catch(() => {});
    await chat.loadHistory().catch(() => {});
    await tasks.loadFor(chat.instanceId, chat.sessionAlias).catch(() => {});
  }
}
function onStatus(online: boolean) {
  conn.setOnline(online);
  if (online) {
    if (everOnline) void reloadSnapshot(); // reconnect → re-pull to avoid ghost state
    everOnline = true;
  }
}
```
and pass `onStatus` as the second arg to `connectEvents(...)` (replacing the inline `(online) => conn.setOnline(online)`).

- [ ] **Step 5: Run, verify pass + build**

`bun run --cwd packages/relay-web test` → pass. `bun run build:relay-web` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/api/events.ts packages/relay-web/src/views/DashboardView.vue packages/relay-web/src/__tests__/events.test.ts packages/relay-web/src/__tests__/dashboard.test.ts
git commit -m "fix(relay-web): re-pull snapshot on reconnect; clear pending reconnect timer on teardown"
```

---

### Task 7: Web chat — turn-failure handling, error banner, clear-on-select, optimistic failed marker

Audit C2 (`turn-finished` ignores `ok`/`errorMessage` → failed/cancelled turns render as success), I3 (`chat.error` is set but never rendered), I4 (stale `error` across session switch), I5 (optimistic input message orphaned on send failure — looks sent when it wasn't).

**Files:**
- Modify: `packages/relay-web/src/stores/chat.ts`
- Modify: `packages/relay-web/src/components/ChatPane.vue`
- Modify: `packages/relay-web/src/components/MessageList.vue`
- Test: `packages/relay-web/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `chat.test.ts`:

```ts
it("turn-finished with ok:false surfaces an error and does not render as a normal reply", () => {
  const chat = useChatStore();
  chat.select("inst", "A");
  chat.applyEvent({ kind: "control-event", instanceId: "inst", event: { type: "turn-output", chatKey: "c", sessionAlias: "A", chunk: "partial" } });
  chat.applyEvent({ kind: "control-event", instanceId: "inst", event: { type: "turn-finished", chatKey: "c", sessionAlias: "A", ok: false, errorMessage: "boom" } });
  expect(chat.error).toBe("boom");
  // the failed tail must not silently become an indistinguishable normal out-message
  const last = chat.messages[chat.messages.length - 1];
  expect(last?.failed ?? false).toBe(true);
});

it("clears error on session select", () => {
  const chat = useChatStore();
  chat.select("inst", "A");
  chat.error = "stale";
  chat.select("inst", "B");
  expect(chat.error).toBe("");
});

it("marks the optimistic message failed when send rejects", async () => {
  rpc.mockRejectedValueOnce(new ApiError("instance-offline", 503));
  const chat = useChatStore();
  chat.select("inst", "A");
  await chat.send("hello");
  const last = chat.messages[chat.messages.length - 1];
  expect(last.direction).toBe("in");
  expect(last.failed).toBe(true);
  expect(chat.error).toBe("instance-offline");
});
```

(Use the file's existing `rpc`/`ApiError` mock.)

- [ ] **Step 2: Run, verify failure**

`bun run --cwd packages/relay-web test` → the three new tests fail (`failed` undefined; error not cleared on select; ok:false treated as success).

- [ ] **Step 3: Implement chat.ts**

- Introduce a local message type (the wire DTO has no status field): `export interface ChatMessage extends MessageRecordDto { failed?: boolean; }` and type `messages` as `ref<ChatMessage[]>([])`. `loadHistory` assigns `MessageRecordDto[]` rows — assignment is compatible (extra optional field).
- `select`: add `error.value = "";` (clear stale error, fixes I4).
- `applyEvent` `turn-finished`: read `e.ok` and `e.errorMessage`. Keep the buffered-tail flush, but mark it failed and surface the error when `!e.ok`:
```ts
    } else if (e.type === "turn-finished") {
      const k = bufKey(event.instanceId, e.sessionAlias);
      const text = streamBuffers.value[k];
      delete streamBuffers.value[k];
      const selected = event.instanceId === instanceId.value && e.sessionAlias === sessionAlias.value;
      if (!e.ok && selected) error.value = e.errorMessage ?? "turn-failed";
      if (text && selected) {
        messages.value.push({ instanceId: event.instanceId, sessionAlias: e.sessionAlias, direction: "out", text, createdAt: new Date().toISOString(), failed: !e.ok });
      }
    }
```
- `send`: capture the pushed optimistic message and mark it failed in the catch (fixes I5):
```ts
    error.value = "";
    sending.value = true;
    const optimistic: ChatMessage = { instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "in", text, createdAt: new Date().toISOString() };
    messages.value.push(optimistic);
    try {
      // ...existing command/prompt branches unchanged...
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "send-failed";
      optimistic.failed = true;
    } finally {
      sending.value = false;
    }
```
(Note: mutating `optimistic.failed` after it's in the reactive array updates the view because the object is reactive once pushed.)

- [ ] **Step 4: Implement ChatPane.vue error banner (I3)**

In `ChatPane.vue`, render `chat.error` when set (dismissible), above or below the message list inside the `v-else` block:
```html
      <div v-if="chat.error" data-test="chat-error" class="bg-red-50 px-4 py-1 text-xs text-red-700">
        {{ chat.error }}
        <button class="ml-2 underline" @click="chat.error = ''">dismiss</button>
      </div>
```

- [ ] **Step 5: Implement MessageList.vue failed styling**

`MessageList.vue` props type: change `messages: MessageRecordDto[]` to accept the failed flag — import `ChatMessage` from the store (`import type { ChatMessage } from "../stores/chat"`) and use `messages: ChatMessage[]`. Style failed messages distinctly (e.g. red ring / "failed" tag):
```html
    <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.direction === 'in' ? 'justify-end' : 'justify-start'">
      <pre class="max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm"
           :class="[m.direction === 'in' ? 'bg-slate-800 text-white' : 'bg-slate-100', m.failed ? 'ring-1 ring-red-400' : '']">{{ m.text }}<span v-if="m.failed" class="ml-2 text-xs text-red-400">failed</span></pre>
    </div>
```

- [ ] **Step 6: Run, verify pass + build**

`bun run --cwd packages/relay-web test` → all pass (existing chat tests still green). `bun run build:relay-web` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/components/ChatPane.vue packages/relay-web/src/components/MessageList.vue packages/relay-web/src/__tests__/chat.test.ts
git commit -m "fix(relay-web): surface turn failures + chat errors; clear on select; mark failed optimistic sends"
```

---

### Task 8: Web — cancel in-flight turn

Audit / §4.5 "运行中可取消": there's no way to cancel a running prompt. Add a `cancel()` chat action (`control.prompt.cancel`) and a Cancel control in the chat pane while a turn is in flight.

**Files:**
- Modify: `packages/relay-web/src/stores/chat.ts`
- Modify: `packages/relay-web/src/components/ChatPane.vue` (and/or `PromptInput.vue`)
- Test: `packages/relay-web/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it("cancel sends control.prompt.cancel for the selected session", async () => {
  rpc.mockResolvedValueOnce({ cancelled: true });
  const chat = useChatStore();
  chat.select("inst", "A");
  await chat.cancel();
  expect(rpc).toHaveBeenCalledWith("inst", "control.prompt.cancel", { sessionAlias: "A" });
});
```

- [ ] **Step 2: Run, verify failure** — `cancel` undefined.

- [ ] **Step 3: Implement `cancel` in chat.ts**

```ts
  async function cancel(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    try {
      await api.rpc(instanceId.value, "control.prompt.cancel", { sessionAlias: sessionAlias.value });
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "cancel-failed";
    }
  }
```
Return `cancel` from the store. The relay stamps `chatKey` server-side for `control.prompt.cancel` (it's in `CHAT_SCOPED_TYPES`), so the client sends only `{ sessionAlias }`.

- [ ] **Step 4: Implement the Cancel control**

In `ChatPane.vue`, show a Cancel button while a turn is active — i.e. when `chat.sending` OR `chat.streaming` is non-empty (a running turn streams output). Minimal: next to / above `PromptInput`:
```html
      <div v-if="chat.sending || chat.streaming" class="px-4 pb-1">
        <button data-test="cancel-turn" class="text-xs text-red-500 hover:underline" @click="chat.cancel">Cancel</button>
      </div>
```

- [ ] **Step 5: Run, verify pass + build** — `bun run --cwd packages/relay-web test` and `bun run build:relay-web`.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/components/ChatPane.vue packages/relay-web/src/__tests__/chat.test.ts
git commit -m "feat(relay-web): cancel in-flight turn from the chat pane"
```

---

### Task 9: Web — create/delete logical session UI

§4.5 left column: the store has `createSession`/`removeSession` but no UI calls them. Add a "+ new session" affordance per instance and a delete control per session in `InstanceTree.vue`.

**Files:**
- Modify: `packages/relay-web/src/components/InstanceTree.vue`
- Test: `packages/relay-web/src/__tests__/instancetree.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `packages/relay-web/src/__tests__/instancetree.test.ts`. Mount `InstanceTree` with a real pinia, seed `instances.instances`, and assert: clicking "+ new session", filling the inline form, and submitting calls `instances.createSession(id, alias, agent, workspace)`; clicking a session's delete calls `instances.removeSession(id, alias)`. Spy on the store actions.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import InstanceTree from "../components/InstanceTree.vue";
import { useInstancesStore } from "../stores/instances";

describe("InstanceTree session management", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("creates a session via the inline form", async () => {
    const store = useInstancesStore();
    store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }] as never;
    const create = vi.spyOn(store, "createSession").mockResolvedValue();
    const w = mount(InstanceTree);
    await w.find('[data-test="new-session"]').trigger("click");
    await w.find('[data-test="new-session-alias"]').setValue("backend");
    await w.find('[data-test="new-session-agent"]').setValue("claude");
    await w.find('[data-test="new-session-workspace"]').setValue("/ws");
    await w.find('[data-test="new-session-submit"]').trigger("submit");
    expect(create).toHaveBeenCalledWith("i1", "backend", "claude", "/ws");
  });

  it("deletes a session", async () => {
    const store = useInstancesStore();
    store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [{ alias: "backend", agent: "claude", workspace: "/ws", transportSession: "t", running: false }] }] as never;
    const remove = vi.spyOn(store, "removeSession").mockResolvedValue();
    const w = mount(InstanceTree);
    await w.find('[data-test="delete-session"]').trigger("click");
    expect(remove).toHaveBeenCalledWith("i1", "backend");
  });
});
```

- [ ] **Step 2: Run, verify failure** — controls don't exist.

- [ ] **Step 3: Implement in InstanceTree.vue**

Read the current `InstanceTree.vue` (it renders instances → sessions with a `toggle` loader and `select` emit). Add, per instance, a "+ new session" button that reveals an inline form (alias/agent/workspace inputs + submit) calling `store.createSession(inst.id, alias, agent, workspace)`; and per session row, a small delete button calling `store.removeSession(inst.id, s.alias)`. Manage per-instance form open-state with a `ref<Record<string,boolean>>` (or a single "active form instance id"). Keep the existing online-dot, running ●, and `select` emit intact. Use `data-test` hooks matching the test. Example sketch for the form (inside the instance block, after the sessions `<ul>`):
```html
        <button data-test="new-session" class="px-6 py-1 text-left text-xs text-slate-500 hover:underline" @click="openForm(inst.id)">+ new session</button>
        <form v-if="formFor === inst.id" class="space-y-1 px-6 py-1" @submit.prevent="submitNew(inst.id)">
          <input v-model="draft.alias" data-test="new-session-alias" placeholder="alias" class="w-full rounded border px-1 text-xs" />
          <input v-model="draft.agent" data-test="new-session-agent" placeholder="agent" class="w-full rounded border px-1 text-xs" />
          <input v-model="draft.workspace" data-test="new-session-workspace" placeholder="workspace" class="w-full rounded border px-1 text-xs" />
          <button type="submit" data-test="new-session-submit" class="w-full rounded bg-slate-700 px-2 py-0.5 text-xs text-white">Create</button>
        </form>
```
and a delete control inside each session `<li>`:
```html
          <button data-test="delete-session" class="text-xs text-red-400 hover:underline" @click.stop="store.removeSession(inst.id, s.alias)">delete</button>
```
Script additions: `formFor` ref, `draft` reactive `{ alias, agent, workspace }`, `openForm(id)`, and `submitNew(id)` that calls `await store.createSession(...)` then resets `draft` + closes the form. Wrap calls in try/catch or `.catch` to avoid unhandled rejections (errors are non-fatal; optionally surface later).

- [ ] **Step 4: Run, verify pass + build** — `bun run --cwd packages/relay-web test` and `bun run build:relay-web`. If `dashboard.test.ts` mounts `InstanceTree` and the new controls affect its assertions, adjust minimally (it stubs InstanceTree in some tests — confirm).

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/components/InstanceTree.vue packages/relay-web/src/__tests__/instancetree.test.ts
git commit -m "feat(relay-web): create/delete logical sessions from the instance tree"
```

---

### Task 10: Docs, spec §11, memory

**Files:**
- Modify: `docs/relay-web-module.md`, `docs/relay-module.md`, `docs/superpowers/specs/2026-06-13-relay-hub-design.md`
- Memory: `project_relay_hub_multiphase.md` (+ MEMORY.md index)

- [ ] **Step 1: Update `docs/relay-web-module.md`** — document: reconnect snapshot re-pull + timer cleanup (events.ts/DashboardView), chat error banner + turn-failure surfacing + failed-message styling + clear-on-select, optimistic failed marker, cancel-in-flight control, create/delete-session UI in the instance tree.

- [ ] **Step 2: Update `docs/relay-module.md`** — document: pairing-token/invites CSRF 415 guard, bounded login rate-limiter, gateway in-flight drain on disconnect (fast 503 instead of 15s timeout), timing-safe credential compare. And note `parseWebServerEvent` now deep-validates inner payloads (relay-protocol) and the connector now surfaces protocol-version mismatch (channel-relay) — or add a short note pointing to those packages.

- [ ] **Step 3: Update spec §11** — add a phase-5 line under the phasing list: "阶段五【已实现】：审计修复（错误恢复/重连快照、CSRF/限流加固、连接器凭证原子写与协议版本提示、会话创建删除 UI、取消运行回合）". Keep it concise.

- [ ] **Step 4: Update memory `project_relay_hub_multiphase.md`** — add a phase-5 paragraph: branch `feat/relay-hub-phase5-audit-fixes`, what it fixed (the audit punch-list), and that the relay hub is now hardened through phase 5; refresh the frontmatter description and the MEMORY.md index hook. (Memory lives outside the repo — use the Write tool, not git.)

- [ ] **Step 5: Commit**

```bash
git add docs/relay-web-module.md docs/relay-module.md docs/superpowers/specs/2026-06-13-relay-hub-design.md
git commit -m "docs(relay): phase-5 audit remediation (recovery, hardening, UI)"
```

---

## Final Review

After all tasks: dispatch a whole-branch review (most capable model) confirming (a) every audit finding addressed, (b) no verified-correct invariant regressed (multi-tenancy isolation, identity stamping, hashed secrets), (c) no test weakened to pass. Then the full gate:

```bash
npm test && bun run build:relay-protocol && bun run build:relay && bun run build:channel-relay && bun run build:relay-web
```

Expected: all green / exit 0. Finish via superpowers:finishing-a-development-branch (the user keeps phase branches unmerged/unpushed, matching phases 1–4).
