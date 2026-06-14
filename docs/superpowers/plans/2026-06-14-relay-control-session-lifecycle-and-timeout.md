# Relay Control-Session Transport Lifecycle + Gateway RPC Timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session created from the relay dashboard actually promptable end-to-end, and stop the relay's 15s RPC timeout from breaking agent cold-starts and long prompts.

**Architecture:** Two independent fixes. **Part A** routes `control.sessions.create` through the *same* transport lifecycle the chat `/ss new` command uses (`resolveSession → reserveTransportSession → ensureTransportSession → checkTransportSession → attachSession → refresh agent command`), instead of only creating a logical session. **Part B** makes the relay gateway's per-request timeout configurable with a higher default, and makes the dashboard treat a prompt RPC timeout as non-fatal (turn results already arrive over the `/ws` event stream).

**Tech Stack:** TypeScript, Bun test (backend, `tests/unit/**`), Vitest + jsdom (relay-web), npm workspaces. acpx-bridge transport. Hono relay server. Vue 3 dashboard.

**Background (why this is needed):** On the branch `feat/relay-web-session-create-form`, commit `9a7b788` fixed session *scoping* so a control-created session is now found by `control.prompt` (was "session does not exist"). But prompting still fails with `No named session "home:relay:<alias>"` because `control.sessions.create` (via `ControlService.createSession` → `SessionService.createSession`) creates only the **logical** session — it never creates the acpx **named (transport)** session. The chat `/ss` path does this in `src/commands/handlers/session-handler.ts:200-230`. Separately, `InstanceGateway.sendRequest` (`packages/relay/src/gateway/instance-gateway.ts:148`) times out every RPC at 15s; a codex cold-start ensure takes ~48s and a real prompt can take minutes, so both the create RPC and prompt RPC time out even when the underlying work succeeds.

**Reference reading before starting:**
- `src/commands/handlers/session-handler.ts:195-235` — the canonical create flow (`createNewSession`).
- `src/commands/command-router.ts:443-520` (`createSessionLifecycleOps`), `:517-525` (`reserveLogicalTransportSession`), `:587-627` (`ensureTransportSession`), `:688-...` (`checkTransportSession`).
- `src/control/control-service.ts` — `ControlService.createSession` (current, logical-only).
- `src/main.ts:763-...` — where `ControlService` is constructed; `const router` and `const transport` and `const sessions` are all in scope here.
- `packages/relay/src/gateway/instance-gateway.ts:21-40,142-160` — `InstanceGatewayDeps.requestTimeoutMs`, `sendRequest`.
- `packages/relay/src/server.ts:50-110` — `createRelayRuntime` / `startRelayServer` (`StartRelayOptions`).
- `packages/relay/src/cli.ts:71-90` — `start` flag parsing.
- `packages/relay-web/src/stores/chat.ts:63-90` — dashboard `send()`.

**Manual end-to-end harness (a local sandbox is assumed running; if not, see Appendix).**
- Relay server: `node packages/relay/dist/cli.js start --db /tmp/xacpx-relay-test/relay.db --web-root packages/relay-web/dist --host 127.0.0.1`
- Instance console: `HOME=/tmp/xacpx-relay-test node dist/cli.js run`
- Admin/login: `admin` / (the password printed by `init-admin`; stored in `/tmp/xacpx-relay-test`).

---

## File Structure

| File | Responsibility | Part |
|---|---|---|
| `src/commands/command-router.ts` | New public method `createSessionWithTransport(internalAlias, agent, workspace)` that runs the full lifecycle with `reply=undefined` (no chat progress messages). | A |
| `src/control/control-service.ts` | `createSession` calls a new dep `createSessionWithTransport` (full lifecycle) instead of `sessions.createSession` (logical only). | A |
| `src/main.ts` | Wire `createSessionWithTransport: (a,ag,w) => router.createSessionWithTransport(a,ag,w)` into `ControlService` deps; thread `requestTimeoutMs` into `startRelayServer`. | A,B |
| `tests/unit/commands/command-router-session.test.ts` | Test the new router method creates the transport session. | A |
| `tests/unit/control/control-service-sessions.test.ts` | Update mock: replace `sessions.createSession` usage with the new `createSessionWithTransport` dep. | A |
| `packages/relay/src/gateway/instance-gateway.ts` | (No change — already supports `requestTimeoutMs`.) | B |
| `packages/relay/src/server.ts` | `StartRelayOptions.requestTimeoutMs` → pass to `InstanceGateway`; default 120_000. | B |
| `packages/relay/src/cli.ts` | `--request-timeout-ms` flag on `start`. | B |
| `packages/relay-web/src/stores/chat.ts` | Treat a prompt RPC timeout (HTTP 504 / `"timeout"`) as non-fatal — results arrive via `turn-finished`. | B |
| `packages/relay-web/src/api/client.ts` | `ApiError` already carries `status`; used by chat.ts to detect 504. (Verify, no change expected.) | B |
| `docs/relay-module.md` | Note the control-create lifecycle + configurable timeout. | A,B |

---

## Part A — Make control-created sessions promptable

### Task A1: Spike — confirm the root cause and the minimal lifecycle subset

**Files:** none (investigation only). Record findings in the PR description.

- [ ] **Step 1: Reproduce the failure on the current branch**

With the sandbox running (new build of core + connector), create a session and prompt it:

```bash
export HOME=/tmp/xacpx-relay-test; IID=$(curl -s http://127.0.0.1:8787/api/instances -b /tmp/xacpx-relay-test/cookies.txt | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).instances[0].id))")
rpc(){ curl -s --max-time 90 -X POST "http://127.0.0.1:8787/api/instances/$IID/rpc" -H 'content-type: application/json' -b /tmp/xacpx-relay-test/cookies.txt -d "$1"; echo; }
rpc '{"type":"control.sessions.create","payload":{"alias":"spike1","agent":"codex","workspace":"home"}}'
rpc '{"type":"control.prompt","payload":{"sessionAlias":"spike1","text":"say pong"}}'
```

Expected: prompt returns `{"ok":false,"errorMessage":"No named session \"home:relay:spike1\" ..."}`.

- [ ] **Step 2: Confirm the hypothesis by manually completing the lifecycle**

Inspect `/tmp/xacpx-relay-test/.xacpx/runtime/app.log` and `/tmp/xacpx-relay-test/.xacpx/state.json`. Confirm: (a) the logical session `relay:spike1` exists in `state.json` with `transport_session: "home:relay:spike1"`; (b) it has **no** `transport_agent_command` set; (c) there is no acpx "session new" / ensure log line.

The hypothesis: a control-created session never runs `transport.ensureSession`, and even when it does, the resolved `agentCommand`/identity differs from the prompt's because `attachSession` + `refreshSessionTransportAgentCommand` were skipped (acpx keys named sessions on `agent + agentCommand + cwd + name`; see `listAllResolvedSessions` in `session-service.ts:108-115`).

- [ ] **Step 3: Decide the implementation shape**

Confirm that mirroring `session-handler.ts:createNewSession` (resolve → reserve → ensure → check → attach → refresh) is the fix. Record the confirmed root cause in the PR description. Proceed to A2 regardless of which sub-steps prove strictly necessary — implementing the *full* lifecycle matches `/ss` exactly and is the safe choice.

- [ ] **Step 4: Commit** (no code; this task produces only the recorded finding — skip the commit).

---

### Task A2: Add `CommandRouter.createSessionWithTransport`

**Files:**
- Modify: `src/commands/command-router.ts` (add a public method near `createSessionLifecycleOps`, ~line 443)
- Test: `tests/unit/commands/command-router-session.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/commands/command-router-session.test.ts` (mirror the existing harness in that file — reuse its `makeRouter()`/transport stub; the snippet below assumes a `makeRouter()` returning `{ router, transport, sessions }` like the sibling tests — adapt names to the file's actual helpers):

```ts
test("createSessionWithTransport resolves, ensures the transport session, and binds the logical session", async () => {
  const { router, transport, sessions } = makeRouter();
  const ensured: string[] = [];
  transport.ensureSession = async (s: { transportSession: string }) => { ensured.push(s.transportSession); };
  transport.hasSession = async () => true;

  const resolved = await router.createSessionWithTransport("relay:demo", "codex", "home");

  expect(resolved.transportSession).toBe("home:relay:demo");
  expect(ensured).toEqual(["home:relay:demo"]); // transport.ensureSession was called
  expect(await sessions.getSession("relay:demo")).toBeTruthy(); // logical session bound
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/commands/command-router-session.test.ts`
Expected: FAIL with `router.createSessionWithTransport is not a function`.

- [ ] **Step 3: Implement the method**

In `src/commands/command-router.ts`, add a public method that reuses the existing private lifecycle helpers (`reserveLogicalTransportSession`, `ensureTransportSession`, `checkTransportSession`) and `SessionService` (`resolveSession`, `attachSession`, `refreshSessionTransportAgentCommand`). It mirrors `session-handler.ts:createNewSession` but takes an already-internal alias and passes `reply=undefined` (no chat progress):

```ts
/**
 * Create a session through the FULL transport lifecycle (resolve → reserve →
 * ensure acpx named session → verify → bind logical session → refresh agent
 * command), with no chat reply/progress. Used by the relay control surface so a
 * dashboard-created session is immediately promptable, exactly like `/ss new`.
 * `internalAlias` must already be channel-scoped (e.g. "relay:demo").
 */
async createSessionWithTransport(
  internalAlias: string,
  agent: string,
  workspace: string,
): Promise<ResolvedSession> {
  const session = this.sessions.resolveSession(
    internalAlias,
    agent,
    workspace,
    `${workspace}:${internalAlias}`,
  );
  const release = await this.reserveLogicalTransportSession(session.transportSession);
  try {
    await this.ensureTransportSession(session); // reply/perfSpan default undefined
    const exists = await this.checkTransportSession(session);
    if (!exists) {
      throw new Error(`transport session "${session.transportSession}" could not be verified`);
    }
    await this.sessions.attachSession(internalAlias, agent, workspace, session.transportSession);
    await this.refreshSessionTransportAgentCommand(internalAlias);
    return session;
  } finally {
    await release();
  }
}
```

Confirm `ResolvedSession` is already imported in this file (it is — used by `ensureTransportSession`). Confirm `refreshSessionTransportAgentCommand` is a private method on the router (it is — referenced at `:464,:493,:513`). If `attachSession`/`getSession` are not on `this.sessions`, they are on `SessionService` (`attachSession` at `session-service.ts:142`); the router already holds `this.sessions: SessionService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/commands/command-router-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/commands/command-router.ts tests/unit/commands/command-router-session.test.ts
git commit -m "feat(router): add createSessionWithTransport for the control surface"
```

---

### Task A3: Route `ControlService.createSession` through the full lifecycle

**Files:**
- Modify: `src/control/control-service.ts` (deps + `createSession`)
- Modify: `src/main.ts` (wire the dep)
- Test: `tests/unit/control/control-service-sessions.test.ts`

- [ ] **Step 1: Update the failing test**

In `tests/unit/control/control-service-sessions.test.ts`, replace the `sessions.createSession` mock usage with a new `createSessionWithTransport` dep and assert the transport-creating dep is used. Change `makeDeps()` so `deps` includes:

```ts
// inside makeDeps(), add alongside the existing deps:
createSessionWithTransport: async (internalAlias: string, agent: string, workspace: string) => ({
  ...session, alias: internalAlias, agent, workspace,
}),
```

and update the create test:

```ts
test("createSession runs the transport lifecycle and emits sessions-changed", async () => {
  const { deps, seen } = makeDeps();
  const control = new ControlService(deps as never);
  const created = await control.createSession("relay:acct", "docs", "codex", "/ws/docs");
  expect(created.alias).toBe("docs"); // display alias (relay: stripped requires "relay" registered; see note)
  expect(seen).toContainEqual({ type: "sessions-changed" });
});
```

Note: `toDisplaySessionAlias("docs")` returns `"docs"` because the mock `resolveAliasForChat` returns the alias unchanged and `"docs"` has no known-channel prefix. Keep the existing `resolveAliasForChat: async (_c, a) => a` mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/control/control-service-sessions.test.ts`
Expected: FAIL (`this.deps.createSessionWithTransport is not a function`).

- [ ] **Step 3: Implement — add the dep and use it**

In `src/control/control-service.ts`, add to `ControlServiceDeps` (import `ResolvedSession` from `../transport/types`):

```ts
// Full-lifecycle session creator (resolve → ensure acpx session → bind),
// wired to CommandRouter.createSessionWithTransport in main.ts. Replaces the
// logical-only sessions.createSession so control-created sessions are promptable.
createSessionWithTransport: (internalAlias: string, agent: string, workspace: string) => Promise<ResolvedSession>;
```

Then in `createSession`, replace `await this.deps.sessions.createSession(internalAlias, agent, workspace)` with:

```ts
const session = await this.deps.createSessionWithTransport(internalAlias, agent, workspace);
```

Remove `"createSession"` from the `sessions: Pick<SessionService, ...>` list (keep `listAllResolvedSessions | removeSession | useSession | resolveAliasForChat`).

- [ ] **Step 4: Wire it in `src/main.ts`**

In the `new ControlService({...})` deps (around line 763), add:

```ts
createSessionWithTransport: (internalAlias, agent, workspace) =>
  router.createSessionWithTransport(internalAlias, agent, workspace),
```

Confirm `router` is in scope here (it is — `const agent = new ConsoleAgent(router, logger)` at `main.ts:761`).

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/unit/control/control-service-sessions.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/control/control-service.ts src/main.ts tests/unit/control/control-service-sessions.test.ts
git commit -m "fix(relay): create control sessions through the full transport lifecycle"
```

---

### Task A4: End-to-end sandbox verification (Part A)

**Files:** none (manual verification; this gates Part A).

- [ ] **Step 1: Rebuild core + connector and restart the sandbox**

```bash
bun run build:packages
# repack + reinstall the connector into the sandbox plugin home, recreate the
# xacpx/weacpx shims, restart the console — see Appendix "Sandbox rebuild".
```

- [ ] **Step 2: Create a session and prompt it (the original failing case)**

```bash
export HOME=/tmp/xacpx-relay-test; IID=...   # as in A1
rpc '{"type":"control.sessions.create","payload":{"alias":"ok1","agent":"codex","workspace":"home"}}'
rpc '{"type":"control.prompt","payload":{"sessionAlias":"ok1","text":"reply with exactly one word: pong"}}'
```

Expected: create returns the session DTO within the (raised, Part B) timeout; prompt returns `{"ok":true,"text":"...pong..."}` (or streams and the cached history at `GET /api/instances/$IID/sessions/ok1/messages` shows an `out` message containing `pong`).

- [ ] **Step 3: Confirm in the browser**

Open `http://127.0.0.1:8787`, log in, create a session via the dialog, send "hi", and confirm a streamed markdown reply appears.

> Part A depends on Part B for create/prompt not to time out (codex cold-start ensure ~48s > 15s). Implement Part B before running A4, or run the sandbox with `--request-timeout-ms 120000`.

---

## Part B — Gateway RPC timeout for agent operations

### Task B1: Make `requestTimeoutMs` configurable with a higher default

**Files:**
- Modify: `packages/relay/src/server.ts` (`StartRelayOptions`, `createRelayRuntime`/`startRelayServer`, `InstanceGateway` construction)
- Modify: `packages/relay/src/cli.ts` (`--request-timeout-ms` on `start`)
- Test: `tests/unit/packages/relay/integration.test.ts` (or the gateway test file in that dir)

- [ ] **Step 1: Write the failing test**

In the relay integration test dir (`tests/unit/packages/relay/`), add a test that a configured timeout reaches the gateway. If the existing tests construct `InstanceGateway` directly, assert the default; otherwise test `startRelayServer({..., requestTimeoutMs: 1234})` wires it. Minimal gateway-level test:

```ts
import { InstanceGateway } from "../../../../packages/relay/src/gateway/instance-gateway";
test("InstanceGateway honors a configured requestTimeoutMs", async () => {
  const gw = new InstanceGateway({ instances: fakeInstances(), requestTimeoutMs: 50 });
  // No instance connected → sendRequest should reject with "timeout" after ~50ms, not 15s.
  const start = Date.now();
  await expect(gw.sendRequest("missing", "control.sessions.list", {})).rejects.toThrow(/offline|timeout/);
  expect(Date.now() - start).toBeLessThan(5000);
});
```

(If `sendRequest` rejects immediately with `instance-offline` for an unknown instance, adjust the assertion to register a fake never-responding socket; mirror how the existing gateway test injects a connection.)

- [ ] **Step 2: Run test to verify it fails / passes-trivially**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay`
Expected: compiles; the new test passes only once the option is plumbed (it already is at the gateway layer — this test guards regressions). If it already passes at the gateway layer, proceed; the real change is plumbing through server + CLI (Steps 3-4).

- [ ] **Step 3: Plumb through the server**

In `packages/relay/src/server.ts`:
- Add `requestTimeoutMs?: number;` to `StartRelayOptions` (and to `createRelayRuntime`'s options if it constructs the gateway).
- Where `new InstanceGateway({ instances, onStatusChange, onEvent })` is built (line ~50), add `requestTimeoutMs: options.requestTimeoutMs ?? 120_000,`.

```ts
const gateway = new InstanceGateway({
  instances,
  requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
  onStatusChange: (instanceId, accountId, online) => { /* unchanged */ },
  onEvent: (instanceId, accountId, envelope) => { /* unchanged */ },
});
```

If `createRelayRuntime` builds the gateway and `startRelayServer` calls it, thread `requestTimeoutMs` through both (`createRelayRuntime(dbPath, { webRoot, historyRetentionDays, requestTimeoutMs })`).

- [ ] **Step 4: Add the CLI flag**

In `packages/relay/src/cli.ts`, in the `start` branch (line ~71), parse and pass it; update the `USAGE` string (line 8-13):

```ts
// USAGE start line — append:
//   [--request-timeout-ms 120000]
const requestTimeoutRaw = flag(args, "--request-timeout-ms");
const requestTimeoutMs = requestTimeoutRaw !== undefined ? Number(requestTimeoutRaw) : undefined;
const running = await startRelayServer({
  dbPath,
  httpPort: Number(flag(args, "--http-port") ?? "8787"),
  wsPort: Number(flag(args, "--ws-port") ?? "8788"),
  host: flag(args, "--host"),
  webRoot: flag(args, "--web-root"),
  historyRetentionDays: retentionDays !== undefined && !Number.isNaN(retentionDays) ? retentionDays : undefined,
  requestTimeoutMs: requestTimeoutMs !== undefined && !Number.isNaN(requestTimeoutMs) ? requestTimeoutMs : undefined,
});
```

- [ ] **Step 5: Run tests + build**

Run: `node ./scripts/run-tests.mjs tests/unit/packages/relay && bun run build:relay`
Expected: PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/server.ts packages/relay/src/cli.ts tests/unit/packages/relay
git commit -m "feat(relay): configurable gateway RPC timeout, default 120s"
```

---

### Task B2: Dashboard treats a prompt RPC timeout as non-fatal

**Files:**
- Modify: `packages/relay-web/src/stores/chat.ts` (`send()`)
- Test: `packages/relay-web/src/__tests__/chat.test.ts`

Rationale: a turn can run far longer than any fixed timeout. The dashboard already renders the reply from the `turn-output`/`turn-finished` **event** stream (`applyEvent`), so the prompt RPC's response is redundant for display. A timeout (HTTP 504, or `ApiError.code === "timeout"`) must NOT show an error or mark the message failed — the turn is still running and will stream. Only genuine failures (offline 503, bad-request 400, or a synchronous `ok:false`) should surface.

- [ ] **Step 1: Write the failing test**

In `packages/relay-web/src/__tests__/chat.test.ts`:

```ts
import { ApiError } from "../api/client";
test("a prompt RPC timeout does not surface an error (results stream via events)", async () => {
  const chat = useChatStore();
  chat.select("i1", "s1");
  vi.spyOn(api, "rpc").mockRejectedValue(new ApiError("timeout", 504));
  await chat.send("hi");
  expect(chat.error).toBe("");
  expect(chat.messages.at(-1)?.failed).toBeUndefined(); // optimistic msg not marked failed
});

test("a non-timeout prompt error still surfaces", async () => {
  const chat = useChatStore();
  chat.select("i1", "s1");
  vi.spyOn(api, "rpc").mockRejectedValue(new ApiError("instance-offline", 503));
  await chat.send("hi");
  expect(chat.error).toBe("instance-offline");
});
```

(Match the existing `chat.test.ts` setup for `setActivePinia` + `api` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay-web && npx vitest run src/__tests__/chat.test.ts`
Expected: FAIL (timeout currently sets `error`/`failed`).

- [ ] **Step 3: Implement**

In `chat.ts` `send()`, change the `catch` to ignore prompt timeouts. Replace the catch body:

```ts
} catch (e) {
  // A prompt turn can outlast any RPC timeout; its result still arrives over the
  // /ws event stream (turn-output/turn-finished), so a timeout here is not fatal.
  const isTimeout = e instanceof ApiError && (e.status === 504 || e.code === "timeout");
  if (text.startsWith("/") || !isTimeout) {
    error.value = e instanceof ApiError ? e.code : "send-failed";
    optimistic.failed = true;
  }
} finally {
```

Note: `/command` (`control.command.execute`) is request/response (no streaming), so its timeout MUST still surface — hence the `text.startsWith("/")` guard.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay-web && npx vitest run src/__tests__/chat.test.ts`
Expected: PASS.

- [ ] **Step 5: Build (vue-tsc)**

Run: `bun run build:relay-web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/stores/chat.ts packages/relay-web/src/__tests__/chat.test.ts
git commit -m "fix(relay-web): treat prompt RPC timeout as non-fatal (results stream via events)"
```

---

### Task B3: Docs + final verification

**Files:**
- Modify: `docs/relay-module.md` (timeout flag + control-create lifecycle)
- Modify: `docs/relay-web-module.md` (prompt-timeout behavior)

- [ ] **Step 1: Document**

Add to `docs/relay-module.md` under the control/bridge section: `control.sessions.create` now runs the full transport lifecycle (resolve→reserve→ensure→check→attach→refresh) so created sessions are promptable; and `xacpx-relay start --request-timeout-ms` (default 120000) bounds gateway RPCs. Add to `docs/relay-web-module.md`: a prompt RPC timeout is swallowed (turn results arrive via `/ws`), while `/command` timeouts still surface.

- [ ] **Step 2: Full suites + builds**

```bash
node ./scripts/run-tests.mjs tests/unit            # backend
cd packages/relay-web && npx vitest run             # frontend
cd ../.. && bun run build:packages && bun run build:relay-web
```

Expected: all green, both builds clean.

- [ ] **Step 3: End-to-end sandbox (re-run Task A4 with Part B in effect)**

Rebuild the sandbox, create a session in the browser, send "hi", confirm a streamed reply with no spurious error banner, and that a long prompt (e.g. "write a 200-word poem") streams without a timeout error.

- [ ] **Step 4: Commit**

```bash
git add docs/relay-module.md docs/relay-web-module.md
git commit -m "docs(relay): control-create lifecycle + configurable RPC timeout"
```

---

## Appendix — Sandbox rebuild (connector reinstall)

The relay packages are unpublished, so the connector is installed from a local tarball with a bun override, and the `xacpx`/`weacpx` plugin-api shims are recreated by hand (bun prunes them). After any core/connector code change:

```bash
REPO=/Users/maijiazhen/Projects/weacpx-github; export HOME=/tmp/xacpx-relay-test
PH="$HOME/.xacpx/plugins"; RP="$REPO/packages/relay-protocol"
bun run build:packages
pkill -f "dist/cli.js run"; sleep 1
cd "$REPO/packages/channel-relay" && rm -f /tmp/xacpx-relay-test/ganglion-xacpx-channel-relay-*.tgz && npm pack --pack-destination /tmp/xacpx-relay-test
TGZ=$(ls /tmp/xacpx-relay-test/ganglion-xacpx-channel-relay-*.tgz | head -1)
rm -rf "$PH/node_modules" "$PH/bun.lock"
printf '{ "private": true, "type": "module", "dependencies": { "@ganglion/xacpx-relay-protocol": "file:%s", "@ganglion/xacpx-channel-relay": "file:%s" }, "overrides": { "@ganglion/xacpx-relay-protocol": "file:%s" } }\n' "$RP" "$TGZ" "$RP" > "$PH/package.json"
cd "$PH" && bun install
for n in xacpx weacpx; do mkdir -p "$PH/node_modules/$n"; cp "$REPO/dist/plugin-api.js" "$PH/node_modules/$n/plugin-api.js"; printf '{ "name": "%s", "type": "module", "exports": { "./plugin-api": "./plugin-api.js" } }\n' "$n" > "$PH/node_modules/$n/package.json"; done
# restart relay server with the raised timeout, then the console:
node "$REPO/packages/relay/dist/cli.js" start --db "$HOME/relay.db" --web-root "$REPO/packages/relay-web/dist" --host 127.0.0.1 --request-timeout-ms 120000 >/tmp/xacpx-relay-test/relay.log 2>&1 &
node "$REPO/dist/cli.js" run >/tmp/xacpx-relay-test/console.log 2>&1 &
```

If port 8787 is held by a stale server, `pkill -9 -f "relay/dist/cli.js start"` before restarting.

---

## Self-Review

**Spec coverage:** Issue #2 (transport lifecycle) → A2 (router method) + A3 (control wiring) + A4 (verify). Issue #3 (timeout) → B1 (server/CLI config) + B2 (dashboard non-fatal) + B3 (verify). Root-cause uncertainty → A1 spike. ✓

**Placeholders:** A1 is an investigation task with concrete repro commands and a clear exit (recorded root cause); all code steps show full code. The B1 test notes an adapt-to-existing-harness caveat (the relay gateway test injection pattern) rather than inventing a non-existent helper. ✓

**Type consistency:** `createSessionWithTransport(internalAlias, agent, workspace): Promise<ResolvedSession>` is identical in A2 (router), A3 (dep type), and main.ts wiring. `ResolvedSession` imported from `../transport/types` in control-service. Dashboard `ApiError` has `code` + `status` (per `client.ts:1-5`). ✓

**Ordering risk:** A4 needs B1 (timeout) to pass; called out explicitly in A4 and B3. Recommended execution order: A1 → A2 → A3 → B1 → B2 → A4/B3 (verify together).
