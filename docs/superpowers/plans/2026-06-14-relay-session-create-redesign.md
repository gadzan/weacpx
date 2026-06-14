# Relay Session-Create Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the relay dashboard's session-create flow ergonomic — optional auto-alias, an agent picker driven by acpx's full driver catalog with a best-effort install hint, workspace-by-path, and a per-instance modal to manage agents & workspaces.

**Architecture:** A new core `agent-catalog` module lists all acpx drivers and best-effort-probes each binary on PATH. Four new (non-chat-scoped) control RPCs — `agents.catalog`, `agents.create`, `agents.remove`, `workspaces.remove` — expose catalog + config mutation (ConfigStore already has the mutators; in-use guards live in ControlService). The relay-web store gains catalog state + 4 actions; `NewSessionDialog` is reworked (optional alias, catalog agent select, workspace pick-or-type-path) using pure helpers; a new per-instance `ManageInstanceDialog` (opened from `InstanceTree`) hosts `WorkspacesManager` + `AgentsManager`.

**Tech Stack:** TypeScript, Bun test (core: `tests/unit/**`), Vitest + @vue/test-utils + jsdom (relay-web), Vue 3 + Pinia, npm workspaces, Hono relay server.

**Spec:** `docs/superpowers/specs/2026-06-14-relay-session-create-redesign-design.md`

**Branch:** `feat/relay-session-form-redesign` (already checked out; stacks on PR #31).

**Reference reading before starting (exact current code):**
- ConfigStore mutators already exist: `src/config/config-store.ts` — `upsertAgent(name, {driver, command?})` (l.76), `removeAgent(name)` (l.87), `removeWorkspace(name)` (l.69). Do NOT re-add them.
- `src/config/agent-templates.ts` — `listAgentTemplates(): string[]` returns 18 driver keys; templates are `{driver}` only (no description).
- `src/control/control-service.ts` — `ControlServiceDeps` (l.42-64), `ControlAgentInfo`/`ControlWorkspaceInfo` (l.31-40), `listAgents`/`listWorkspaces`/`createWorkspace` (l.136-146), `removeSession` event idiom (l.129-134).
- `src/main.ts` — `new ControlService({...})` deps (l.763-791); `config` (l.165) & `configStore` (l.164) in scope; `replaceRuntimeConfig(target, source)` (l.899-904).
- `src/sessions/session-service.ts` — `listAllResolvedSessions(): ResolvedSession[]` (l.97-123); `ResolvedSession` has `.agent`, `.workspace` (`src/transport/types.ts:26-49`).
- `packages/relay-protocol/src/messages.ts` — `MSG` (l.6-26), `AgentsListResult`/`WorkspacesListResult`/`WorkspacesCreatePayload`/`WorkspacesCreateResult` (l.100-113), `errorPayload`/`isErrorPayload`.
- `packages/relay-protocol/src/dtos.ts` — `AgentDto` (l.10), `WorkspaceDto` (l.16); barrel `index.ts` re-exports all.
- `packages/channel-relay/src/control-bridge.ts` — dispatch switch (l.62-132); imports `ControlService` from `xacpx/plugin-api`, payload types from `@ganglion/xacpx-relay-protocol`.
- `packages/relay/src/http/app.ts` — `CHAT_SCOPED_TYPES` (l.36-44) — new config RPCs must NOT be added here.
- `packages/relay-web/src/stores/instances.ts` — `InstanceView`, `unwrap`, `loadFormOptions`, `createWorkspace`, `createSession`, `removeSession`, return object (l.97).
- `packages/relay-web/src/components/NewSessionDialog.vue` — current dialog (from PR #31).
- `packages/relay-web/src/components/InstanceTree.vue` — instance rows + `+ new session` button + `dialogFor` pattern.
- `packages/relay-web/src/api/client.ts` — `ApiError(code, status)`, `api.rpc/get/post/del`.

**Test/build commands:**
- Core single file: `bun test tests/unit/<path>.test.ts` (NEVER run a whole dir — state-leak false failures).
- Core suite + relay-web: `node ./scripts/run-tests.mjs tests/unit` (also runs relay-web vitest).
- relay-web only: `cd packages/relay-web && npx vitest run <file>`.
- Typecheck core: `npx tsc --noEmit`. Build relay-web: `bun run build:relay-web`. Build packages: `bun run build:packages`.

**Git hygiene (every task):** stage only the exact paths listed. NEVER `git add -A`/`.`; never stage `bun.lock`, `package-lock.json`, `dist/`, `node_modules/`, `CLAUDE.md`. Do not push/rebase/switch branches.

---

## Phase 1 — Core backend

### Task 1: Agent catalog module + install probe

**Files:**
- Create: `src/config/agent-catalog.ts`
- Test: `tests/unit/config/agent-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config/agent-catalog.test.ts`:

```ts
import { expect, test } from "bun:test";
import { listAgentCatalog } from "../../../src/config/agent-catalog";
import type { AppConfig } from "../../../src/config/types";

function cfg(agents: Record<string, { driver: string }>): AppConfig {
  return { agents, workspaces: {} } as unknown as AppConfig;
}

test("codex and claude are always builtin and configured-aware", () => {
  const cat = listAgentCatalog(cfg({ codex: { driver: "codex" } }), () => false);
  const codex = cat.find((e) => e.driver === "codex")!;
  const claude = cat.find((e) => e.driver === "claude")!;
  expect(codex.installed).toBe("builtin");
  expect(codex.configured).toBe(true);
  expect(claude.installed).toBe("builtin");
  expect(claude.configured).toBe(false);
});

test("non-builtin driver is 'yes' when its binary is on PATH, else 'unknown'", () => {
  const cat = listAgentCatalog(cfg({}), (bin) => bin === "gemini");
  expect(cat.find((e) => e.driver === "gemini")!.installed).toBe("yes");
  expect(cat.find((e) => e.driver === "qwen")!.installed).toBe("unknown");
});

test("cursor probes the cursor-agent binary, not 'cursor'", () => {
  const seen: string[] = [];
  listAgentCatalog(cfg({}), (bin) => { seen.push(bin); return false; });
  expect(seen).toContain("cursor-agent");
  expect(seen).not.toContain("cursor");
});

test("configured is true when a config agent uses the driver under a different name", () => {
  const cat = listAgentCatalog(cfg({ "my-gem": { driver: "gemini" } }), () => false);
  expect(cat.find((e) => e.driver === "gemini")!.configured).toBe(true);
});

test("every entry comes from listAgentTemplates and has the three fields", () => {
  const cat = listAgentCatalog(cfg({}), () => false);
  expect(cat.length).toBeGreaterThanOrEqual(15);
  for (const e of cat) {
    expect(typeof e.driver).toBe("string");
    expect(typeof e.configured).toBe("boolean");
    expect(["builtin", "yes", "unknown"]).toContain(e.installed);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/agent-catalog.test.ts`
Expected: FAIL — `Cannot find module '.../agent-catalog'`.

- [ ] **Step 3: Implement the module**

Create `src/config/agent-catalog.ts`:

```ts
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { AppConfig } from "./types";
import { listAgentTemplates } from "./agent-templates";

export interface AgentCatalogEntry {
  driver: string;
  configured: boolean;
  installed: "builtin" | "yes" | "unknown";
}

// codex/claude are npm-published ACP adapters auto-fetched via npx — usable with
// nothing pre-installed. acpx's BUILT_IN_AGENT_PACKAGES is not importable here
// (acpx is a child-process binary), so this small set is maintained by hand.
const BUILTIN_DRIVERS = new Set(["codex", "claude"]);

// Best-effort driver -> CLI binary. Default: the binary equals the driver name.
// Only exceptions need an entry. This is advisory; a miss yields "unknown", never
// a hard block (the agent may be installed under a name we can't predict).
const DRIVER_BINARIES: Record<string, string> = {
  cursor: "cursor-agent",
};

/** True if `binary` is found in any PATH directory (no extension assumptions on POSIX). */
export function isBinaryOnPath(binary: string): boolean {
  const path = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, binary + ext))) return true;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

/**
 * Catalog of every acpx driver xacpx knows (from `listAgentTemplates()`), each
 * tagged with whether it's already configured and a best-effort install hint.
 * `probe` is injectable for tests; defaults to a real PATH lookup.
 */
export function listAgentCatalog(
  config: AppConfig,
  probe: (binary: string) => boolean = isBinaryOnPath,
): AgentCatalogEntry[] {
  const agents = config.agents ?? {};
  const driverConfigured = (driver: string): boolean =>
    Object.entries(agents).some(([name, a]) => name === driver || a.driver === driver);

  return listAgentTemplates().map((driver) => {
    let installed: AgentCatalogEntry["installed"];
    if (BUILTIN_DRIVERS.has(driver)) {
      installed = "builtin";
    } else {
      const binary = DRIVER_BINARIES[driver] ?? driver;
      installed = probe(binary) ? "yes" : "unknown";
    }
    return { driver, configured: driverConfigured(driver), installed };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/agent-catalog.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/config/agent-catalog.ts tests/unit/config/agent-catalog.test.ts
git commit -m "feat(config): agent catalog with best-effort install probe"
```

---

### Task 2: ControlService catalog + agent/workspace management

**Files:**
- Modify: `src/control/control-service.ts`
- Modify: `src/main.ts`
- Test: `tests/unit/control/control-service-config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/control/control-service-config.test.ts`. First read the file's existing `makeDeps()` helper. Add a `createAgent`/`removeAgent`/catalog/`removeWorkspace` capable deps factory (adapt to the file's actual helper; the snippet assumes a local `makeDeps()` returning `{ deps }` you can extend):

```ts
import { expect, test } from "bun:test";
import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus } from "../../../src/control/control-event-bus";

function makeDeps(sessions: Array<{ agent: string; workspace: string }> = []) {
  const calls: string[] = [];
  const deps = {
    agent: { chat: async () => ({ text: "" }) },
    sessions: {
      listAllResolvedSessions: () => sessions,
      removeSession: async () => ({ wasActive: false }),
      useSession: async () => ({ alias: "a", agent: "x", workspace: "w" }),
      resolveAliasForChat: async (_c: string, a: string) => a,
    },
    createSessionWithTransport: async () => ({}),
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: { listPending: () => [], createTask: async () => ({}), cancelPending: async () => false },
    orchestration: { listTasks: async () => [], getTask: async () => null, requestTaskCancellation: async () => ({}) },
    events: createControlEventBus(),
    agents: {
      list: () => [{ name: "codex", driver: "codex" }],
      catalog: () => [{ driver: "codex", configured: true, installed: "builtin" as const }],
      create: async (name: string, driver: string) => { calls.push(`create:${name}:${driver}`); return { name, driver }; },
      remove: async (name: string) => { calls.push(`remove:${name}`); },
    },
    workspaces: {
      list: () => [],
      create: async (name: string, cwd: string) => ({ name, cwd }),
      remove: async (name: string) => { calls.push(`wsremove:${name}`); },
    },
  };
  return { deps, calls };
}

test("listAgentCatalog delegates to the agents.catalog dep", () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);
  expect(control.listAgentCatalog()).toEqual([{ driver: "codex", configured: true, installed: "builtin" }]);
});

test("createAgent delegates to agents.create", async () => {
  const { deps, calls } = makeDeps();
  const control = new ControlService(deps as never);
  const created = await control.createAgent("gemini", "gemini");
  expect(created).toEqual({ name: "gemini", driver: "gemini" });
  expect(calls).toContain("create:gemini:gemini");
});

test("removeAgent rejects when a session uses the agent", async () => {
  const { deps, calls } = makeDeps([{ agent: "codex", workspace: "w" }]);
  const control = new ControlService(deps as never);
  await expect(control.removeAgent("codex")).rejects.toThrow(/in use/);
  expect(calls).not.toContain("remove:codex");
});

test("removeAgent succeeds when no session uses the agent", async () => {
  const { deps, calls } = makeDeps([{ agent: "claude", workspace: "w" }]);
  const control = new ControlService(deps as never);
  await control.removeAgent("codex");
  expect(calls).toContain("remove:codex");
});

test("removeWorkspace rejects when a session uses the workspace", async () => {
  const { deps } = makeDeps([{ agent: "codex", workspace: "backend" }]);
  const control = new ControlService(deps as never);
  await expect(control.removeWorkspace("backend")).rejects.toThrow(/in use/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/control/control-service-config.test.ts`
Expected: FAIL — `control.listAgentCatalog is not a function`.

- [ ] **Step 3: Implement ControlService changes**

In `src/control/control-service.ts`:

(a) Add the catalog type import near the top (with the other imports):
```ts
import type { AgentCatalogEntry } from "../config/agent-catalog";
```

(b) Extend the `agents` and `workspaces` deps in `ControlServiceDeps` (replace the current `agents`/`workspaces` members):
```ts
  agents: {
    list(): ControlAgentInfo[];
    catalog(): AgentCatalogEntry[];
    create(name: string, driver: string): Promise<ControlAgentInfo>;
    remove(name: string): Promise<void>;
  };
  workspaces: {
    list(): ControlWorkspaceInfo[];
    create(name: string, cwd: string, description?: string): Promise<ControlWorkspaceInfo>;
    remove(name: string): Promise<void>;
  };
```

(c) Add methods next to `createWorkspace` (after l.146):
```ts
  listAgentCatalog(): AgentCatalogEntry[] {
    return this.deps.agents.catalog();
  }

  createAgent(name: string, driver: string): Promise<ControlAgentInfo> {
    return this.deps.agents.create(name, driver);
  }

  async removeAgent(name: string): Promise<void> {
    if (this.deps.sessions.listAllResolvedSessions().some((s) => s.agent === name)) {
      throw new Error(`agent "${name}" is in use by an existing session`);
    }
    await this.deps.agents.remove(name);
  }

  async removeWorkspace(name: string): Promise<void> {
    if (this.deps.sessions.listAllResolvedSessions().some((s) => s.workspace === name)) {
      throw new Error(`workspace "${name}" is in use by an existing session`);
    }
    await this.deps.workspaces.remove(name);
  }
```

- [ ] **Step 4: Wire the new deps in `src/main.ts`**

Add the import near the other config imports:
```ts
import { listAgentCatalog } from "./config/agent-catalog";
```

Replace the `agents:` and `workspaces:` dep blocks in `new ControlService({...})` (l.771-790) with:
```ts
    agents: {
      list: () =>
        Object.entries(config.agents).map(([name, agentConfig]) => ({ name, driver: agentConfig.driver })),
      catalog: () => listAgentCatalog(config),
      create: async (name, driver) => {
        const updated = await configStore.upsertAgent(name, { driver });
        replaceRuntimeConfig(config, updated);
        return { name, driver };
      },
      remove: async (name) => {
        const updated = await configStore.removeAgent(name);
        replaceRuntimeConfig(config, updated);
      },
    },
    workspaces: {
      list: () =>
        Object.entries(config.workspaces).map(([name, workspace]) => ({
          name,
          cwd: workspace.cwd,
          ...(workspace.description ? { description: workspace.description } : {}),
        })),
      create: async (name, cwd, description) => {
        const updated = await configStore.upsertWorkspace(name, cwd, description);
        replaceRuntimeConfig(config, updated);
        return { name, cwd, ...(description ? { description } : {}) };
      },
      remove: async (name) => {
        const updated = await configStore.removeWorkspace(name);
        replaceRuntimeConfig(config, updated);
      },
    },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/unit/control/control-service-config.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/control/control-service.ts src/main.ts tests/unit/control/control-service-config.test.ts
git commit -m "feat(control): agent catalog + agents/workspaces management with in-use guards"
```

---

## Phase 2 — Protocol + bridge

### Task 3: relay-protocol messages + DTOs

**Files:**
- Modify: `packages/relay-protocol/src/messages.ts`
- Modify: `packages/relay-protocol/src/dtos.ts`
- Test: `tests/unit/packages/relay-protocol/messages.test.ts` (create if absent; otherwise add to the existing protocol test)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/packages/relay-protocol/messages.test.ts`:
```ts
import { expect, test } from "bun:test";
import { MSG } from "../../../../packages/relay-protocol/src/messages";
import type { AgentCatalogEntryDto } from "../../../../packages/relay-protocol/src/dtos";

test("new control message types exist with the control. prefix", () => {
  expect(MSG.agentsCatalog).toBe("control.agents.catalog");
  expect(MSG.agentsCreate).toBe("control.agents.create");
  expect(MSG.agentsRemove).toBe("control.agents.remove");
  expect(MSG.workspacesRemove).toBe("control.workspaces.remove");
});

test("AgentCatalogEntryDto shape compiles", () => {
  const e: AgentCatalogEntryDto = { driver: "gemini", configured: false, installed: "unknown" };
  expect(e.driver).toBe("gemini");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/relay-protocol/messages.test.ts`
Expected: FAIL — `MSG.agentsCatalog` is undefined / type missing.

- [ ] **Step 3: Implement**

In `packages/relay-protocol/src/messages.ts`, add to the `MSG` object (after `workspacesCreate`):
```ts
  agentsCatalog: "control.agents.catalog",
  agentsCreate: "control.agents.create",
  agentsRemove: "control.agents.remove",
  workspacesRemove: "control.workspaces.remove",
```
And add the result/payload interfaces (near `AgentsListResult`, l.100-113):
```ts
export interface AgentsCatalogResult {
  agents: AgentCatalogEntryDto[];
}
export interface AgentsCreatePayload {
  name: string;
  driver: string;
}
export interface AgentsCreateResult {
  agent: AgentDto;
}
export interface AgentsRemovePayload {
  name: string;
}
export interface WorkspacesRemovePayload {
  name: string;
}
export interface OkResult {
  ok: true;
}
```
Ensure `AgentDto` and `AgentCatalogEntryDto` are imported at the top of `messages.ts` (check how `AgentDto` is currently imported — match it; add `AgentCatalogEntryDto` to the same import from `./dtos`).

In `packages/relay-protocol/src/dtos.ts`, add after `AgentDto` (l.14):
```ts
export interface AgentCatalogEntryDto {
  driver: string;
  configured: boolean;
  installed: "builtin" | "yes" | "unknown";
}
```

- [ ] **Step 4: Run test + build the protocol**

Run: `bun test tests/unit/packages/relay-protocol/messages.test.ts && bun run build:relay-protocol`
Expected: PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src/messages.ts packages/relay-protocol/src/dtos.ts tests/unit/packages/relay-protocol/messages.test.ts
git commit -m "feat(relay-protocol): agents.catalog/create/remove + workspaces.remove messages"
```

---

### Task 4: channel-relay control-bridge cases

**Files:**
- Modify: `packages/channel-relay/src/control-bridge.ts`
- Test: `tests/unit/packages/channel-relay/control-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Read the file's `makeFakeControl()` + `dispatch`/`req` helpers, then add (adapt names to the file's actual helpers):
```ts
test("agents.catalog returns the control catalog", async () => {
  const control = makeFakeControl({ listAgentCatalog: () => [{ driver: "gemini", configured: false, installed: "unknown" }] });
  const bridge = createControlBridge(control as never);
  const res = await dispatch(bridge, req(MSG.agentsCatalog, {}));
  expect(res).toEqual({ agents: [{ driver: "gemini", configured: false, installed: "unknown" }] });
});

test("agents.create requires name and driver", async () => {
  const control = makeFakeControl({ createAgent: async (n: string, d: string) => ({ name: n, driver: d }) });
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.agentsCreate, { name: "", driver: "gemini" }))).toMatchObject({ error: { code: "bad-request" } });
  expect(await dispatch(bridge, req(MSG.agentsCreate, { name: "gemini", driver: "gemini" }))).toEqual({ agent: { name: "gemini", driver: "gemini" } });
});

test("agents.remove and workspaces.remove return ok", async () => {
  const removed: string[] = [];
  const control = makeFakeControl({
    removeAgent: async (n: string) => { removed.push(`a:${n}`); },
    removeWorkspace: async (n: string) => { removed.push(`w:${n}`); },
  });
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.agentsRemove, { name: "gemini" }))).toEqual({ ok: true });
  expect(await dispatch(bridge, req(MSG.workspacesRemove, { name: "ws1" }))).toEqual({ ok: true });
  expect(removed).toEqual(["a:gemini", "w:ws1"]);
});
```
If `makeFakeControl` is a fixed object, extend it to accept overrides (merge the passed partial over defaults) so these methods can be stubbed.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packages/channel-relay/control-bridge.test.ts`
Expected: FAIL — unknown-type for the new MSGs.

- [ ] **Step 3: Implement the cases**

In `packages/channel-relay/src/control-bridge.ts`, add the payload type imports to the existing `@ganglion/xacpx-relay-protocol` import: `AgentsCreatePayload, AgentsRemovePayload, WorkspacesRemovePayload`. Add these cases inside the switch (after `workspacesCreate`):
```ts
    case MSG.agentsCatalog:
      return { agents: control.listAgentCatalog() };
    case MSG.agentsCreate: {
      const input = payload as AgentsCreatePayload;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const driver = typeof input.driver === "string" ? input.driver.trim() : "";
      if (!name || !driver) return errorPayload("bad-request", "agent name and driver are required");
      return { agent: await control.createAgent(name, driver) };
    }
    case MSG.agentsRemove: {
      const input = payload as AgentsRemovePayload;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) return errorPayload("bad-request", "agent name is required");
      await control.removeAgent(name);
      return { ok: true };
    }
    case MSG.workspacesRemove: {
      const input = payload as WorkspacesRemovePayload;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) return errorPayload("bad-request", "workspace name is required");
      await control.removeWorkspace(name);
      return { ok: true };
    }
```

- [ ] **Step 4: Run test + build**

Run: `bun test tests/unit/packages/channel-relay/control-bridge.test.ts && bun run build:channel-relay`
Expected: PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/control-bridge.ts tests/unit/packages/channel-relay/control-bridge.test.ts
git commit -m "feat(channel-relay): bridge agents.catalog/create/remove + workspaces.remove"
```

---

## Phase 3 — relay-web store

### Task 5: instances store — catalog state + management actions

**Files:**
- Modify: `packages/relay-web/src/stores/instances.ts`
- Test: `packages/relay-web/src/__tests__/instances.test.ts`

- [ ] **Step 1: Write the failing test**

Read the existing `instances.test.ts` for its harness (pinia setup, `vi.spyOn(api, "rpc")` / mock). Add:
```ts
test("loadAgentCatalog stores the catalog on the instance", async () => {
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "n", online: true, sessions: [], agents: [], workspaces: [], agentCatalog: [] }] as never;
  vi.spyOn(api, "rpc").mockResolvedValue({ agents: [{ driver: "gemini", configured: false, installed: "unknown" }] } as never);
  await store.loadAgentCatalog("i1");
  expect(store.byId("i1")!.agentCatalog).toEqual([{ driver: "gemini", configured: false, installed: "unknown" }]);
});

test("removeAgent surfaces an instance-side error payload", async () => {
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "n", online: true, sessions: [], agents: [], workspaces: [], agentCatalog: [] }] as never;
  vi.spyOn(api, "rpc").mockResolvedValue({ error: { code: "internal", message: "agent \"codex\" is in use by an existing session" } } as never);
  await expect(store.removeAgent("i1", "codex")).rejects.toThrow(/in use/);
});
```
(Match the file's actual mock style — it may stub `api.rpc` via a module mock rather than `vi.spyOn`. Mirror whatever the existing `createSession`/`createWorkspace` tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay-web && npx vitest run src/__tests__/instances.test.ts`
Expected: FAIL — `store.loadAgentCatalog is not a function`.

- [ ] **Step 3: Implement**

In `packages/relay-web/src/stores/instances.ts`:

(a) Import the DTO type (add to the existing relay-protocol import): `AgentCatalogEntryDto`.

(b) Add `agentCatalog: AgentCatalogEntryDto[]` to the `InstanceView` interface and to every place an `InstanceView` literal is built (e.g. inside `loadInstances` where instances are mapped — initialise `agentCatalog: []`).

(c) Add actions (mirror `createWorkspace`'s `api.rpc + unwrap` idiom):
```ts
  async function loadAgentCatalog(instanceId: string): Promise<void> {
    const { agents } = await api.rpc<{ agents: AgentCatalogEntryDto[] }>(instanceId, "control.agents.catalog");
    const inst = byId(instanceId);
    if (inst) inst.agentCatalog = agents;
  }

  async function createAgent(instanceId: string, name: string, driver: string): Promise<void> {
    unwrap(await api.rpc(instanceId, "control.agents.create", { name, driver }));
    await Promise.all([loadFormOptions(instanceId), loadAgentCatalog(instanceId)]);
  }

  async function removeAgent(instanceId: string, name: string): Promise<void> {
    unwrap(await api.rpc(instanceId, "control.agents.remove", { name }));
    await Promise.all([loadFormOptions(instanceId), loadAgentCatalog(instanceId)]);
  }

  async function removeWorkspace(instanceId: string, name: string): Promise<void> {
    unwrap(await api.rpc(instanceId, "control.workspaces.remove", { name }));
    await loadFormOptions(instanceId);
  }
```

(d) Extend `loadFormOptions` to also fetch the catalog (add `api.rpc<{ agents: AgentCatalogEntryDto[] }>(instanceId, "control.agents.catalog")` to its `Promise.all` and assign `inst.agentCatalog`).

(e) Add the four functions to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay-web && npx vitest run src/__tests__/instances.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/stores/instances.ts packages/relay-web/src/__tests__/instances.test.ts
git commit -m "feat(relay-web): store catalog + agent/workspace management actions"
```

---

## Phase 4 — relay-web UI

### Task 6: Session-form pure helpers

**Files:**
- Create: `packages/relay-web/src/lib/session-form.ts`
- Test: `packages/relay-web/src/__tests__/session-form.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/relay-web/src/__tests__/session-form.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { slugify, genAlias, uniqueName, workspaceNameFromPath } from "../lib/session-form";

describe("slugify", () => {
  test("lowercases and replaces non [a-z0-9-] runs with a single dash", () => {
    expect(slugify("My Cool_Workspace!")).toBe("my-cool-workspace");
    expect(slugify("  --Trim--  ")).toBe("trim");
  });
});

describe("genAlias", () => {
  test("joins workspace and agent", () => {
    expect(genAlias("backend", "codex")).toBe("backend-codex");
    expect(genAlias("My WS", "Codex")).toBe("my-ws-codex");
  });
});

describe("uniqueName", () => {
  test("returns base when free, else suffixes -2, -3", () => {
    expect(uniqueName("backend-codex", [])).toBe("backend-codex");
    expect(uniqueName("backend-codex", ["backend-codex"])).toBe("backend-codex-2");
    expect(uniqueName("backend-codex", ["backend-codex", "backend-codex-2"])).toBe("backend-codex-3");
  });
});

describe("workspaceNameFromPath", () => {
  test("uses the basename, slugified", () => {
    expect(workspaceNameFromPath("/tmp/demo-project")).toBe("demo-project");
    expect(workspaceNameFromPath("/Users/me/My App/")).toBe("my-app");
    expect(workspaceNameFromPath("C:\\\\work\\\\Repo One")).toBe("repo-one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay-web && npx vitest run src/__tests__/session-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/relay-web/src/lib/session-form.ts`:
```ts
/** Lowercase, collapse any non [a-z0-9] run to a single dash, trim leading/trailing dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Default session alias from a workspace name and an agent name. */
export function genAlias(workspace: string, agent: string): string {
  return slugify(`${workspace}-${agent}`);
}

/** `base`, or `base-2`, `base-3`, … — the first not present in `existing`. */
export function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Derive a workspace name from a filesystem path's final segment (POSIX or Windows). */
export function workspaceNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/]/).pop() ?? "";
  return slugify(segment);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay-web && npx vitest run src/__tests__/session-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay-web/src/lib/session-form.ts packages/relay-web/src/__tests__/session-form.test.ts
git commit -m "feat(relay-web): pure helpers for alias/workspace-name generation"
```

---

### Task 7: NewSessionDialog redesign

**Files:**
- Modify: `packages/relay-web/src/components/NewSessionDialog.vue`
- Test: `packages/relay-web/src/__tests__/newsessiondialog.test.ts`

- [ ] **Step 1: Write the failing tests**

Read the existing `newsessiondialog.test.ts` to reuse its mount helper + store stubbing. Replace/extend it so it covers the new behavior (the old inline-workspace `__new__` tests are removed):
```ts
// Helpers assumed from the existing file: mountDialog(props), a stubbed instances store
// with agents/workspaces/agentCatalog/sessions, and spies createAgent/createWorkspace/createSession.

test("blank alias is auto-generated from workspace + agent and de-duped", async () => {
  const { wrapper, store } = mountDialog({
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [{ name: "backend", cwd: "/b" }],
    agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
    sessions: [{ alias: "backend-codex" }],
  });
  await wrapper.get('[data-test="ns-create"]').trigger("click");
  expect(store.createSession).toHaveBeenCalledWith("i1", "backend-codex-2", "codex", "backend");
});

test("selecting an un-configured driver auto-creates the agent before the session", async () => {
  const { wrapper, store } = mountDialog({
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [{ name: "backend", cwd: "/b" }],
    agentCatalog: [
      { driver: "codex", configured: true, installed: "builtin" },
      { driver: "gemini", configured: false, installed: "yes" },
    ],
    sessions: [],
  });
  await wrapper.get('[data-test="ns-agent"]').setValue("gemini");
  await wrapper.get('[data-test="ns-create"]').trigger("click");
  expect(store.createAgent).toHaveBeenCalledWith("i1", "gemini", "gemini");
  expect(store.createSession).toHaveBeenCalledWith("i1", "backend-gemini", "gemini", "backend");
});

test("New-path workspace mode auto-creates a workspace from the path basename", async () => {
  const { wrapper, store } = mountDialog({
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [],
    agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
    sessions: [],
  });
  await wrapper.get('[data-test="ns-ws-mode-path"]').trigger("click");
  await wrapper.get('[data-test="ns-ws-path"]').setValue("/tmp/demo-project");
  await wrapper.get('[data-test="ns-create"]').trigger("click");
  expect(store.createWorkspace).toHaveBeenCalledWith("i1", "demo-project", "/tmp/demo-project");
  expect(store.createSession).toHaveBeenCalledWith("i1", "demo-project-codex", "codex", "demo-project");
});

test("an un-installed (unknown) driver is shown but disabled in the select", () => {
  const { wrapper } = mountDialog({
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [{ name: "backend", cwd: "/b" }],
    agentCatalog: [
      { driver: "codex", configured: true, installed: "builtin" },
      { driver: "qwen", configured: false, installed: "unknown" },
    ],
    sessions: [],
  });
  const opt = wrapper.find('option[value="qwen"]');
  expect(opt.exists()).toBe(true);
  expect(opt.attributes("disabled")).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay-web && npx vitest run src/__tests__/newsessiondialog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the redesigned dialog**

Rewrite `packages/relay-web/src/components/NewSessionDialog.vue`. Preserve the existing modal shell, `data-test="new-session-dialog"`, `ns-error`, `ns-create`, the `{pending:true}` handling (`ns-pending` / `ns-pending-close`), and `emit("created"|"close")`. Replace the form body/script with:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useInstancesStore } from "../stores/instances";
import { genAlias, uniqueName, workspaceNameFromPath } from "../lib/session-form";

const props = defineProps<{ instanceId: string; instanceName: string }>();
const emit = defineEmits<{ created: [alias: string]; close: [] }>();

const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const alias = ref("");
const agentValue = ref("");           // chosen agent NAME or un-configured driver
const wsMode = ref<"existing" | "path">("existing");
const workspaceSel = ref("");
const workspacePath = ref("");
const submitting = ref(false);
const pending = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    await store.loadFormOptions(props.instanceId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "failed to load options";
  }
  // default selections
  agentValue.value = inst.value?.agents[0]?.name ?? inst.value?.agentCatalog.find((c) => c.installed !== "unknown")?.driver ?? "";
  workspaceSel.value = inst.value?.workspaces[0]?.name ?? "";
});

// configured agent NAMEs (to know if a chosen value needs agent auto-create)
const configuredNames = computed(() => new Set((inst.value?.agents ?? []).map((a) => a.name)));
// catalog drivers not already configured (shown after configured agents)
const extraDrivers = computed(() =>
  (inst.value?.agentCatalog ?? []).filter((c) => !c.configured),
);

const resolvedWorkspaceName = computed(() =>
  wsMode.value === "path"
    ? (workspacePath.value.trim() ? workspaceNameFromPath(workspacePath.value) : "")
    : workspaceSel.value,
);
const aliasPlaceholder = computed(() =>
  resolvedWorkspaceName.value && agentValue.value ? genAlias(resolvedWorkspaceName.value, agentValue.value) : "auto",
);

const canSubmit = computed(() => {
  if (submitting.value || !agentValue.value) return false;
  if (wsMode.value === "existing") return !!workspaceSel.value;
  return !!workspacePath.value.trim();
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = "";
  try {
    const agentName = agentValue.value;
    // 1) auto-create the config agent if an un-configured driver was picked
    if (!configuredNames.value.has(agentName)) {
      await store.createAgent(props.instanceId, agentName, agentName);
    }
    // 2) resolve workspace (auto-create from path if in New-path mode)
    let workspaceName = workspaceSel.value;
    if (wsMode.value === "path") {
      const existing = (inst.value?.workspaces ?? []).map((w) => w.name);
      workspaceName = uniqueName(workspaceNameFromPath(workspacePath.value), existing);
      await store.createWorkspace(props.instanceId, workspaceName, workspacePath.value.trim());
    }
    // 3) alias: explicit, else generated + de-duped against existing sessions
    const existingAliases = (inst.value?.sessions ?? []).map((s) => s.alias);
    const finalAlias = alias.value.trim() || uniqueName(genAlias(workspaceName, agentName), existingAliases);
    // 4) create the session (preserve PR #31 pending handling)
    const result = await store.createSession(props.instanceId, finalAlias, agentName, workspaceName);
    if (result.pending) { pending.value = true; return; }
    emit("created", finalAlias);
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "create failed";
  } finally {
    submitting.value = false;
  }
}
</script>
```

Template requirements (keep the modal shell + header/footer pattern, Tailwind classes consistent with the current file):
- Alias `<input v-model="alias" :placeholder="aliasPlaceholder" data-test="ns-alias">` with a label noting "optional".
- Agent `<select v-model="agentValue" data-test="ns-agent">`: first an optgroup/options of `inst.agents` (`:value="a.name"`, label `{{a.name}} · {{a.driver}}`), then options for `extraDrivers` (`:value="c.driver"`, label `{{c.driver}}` + an availability hint; `:disabled="c.installed === 'unknown'"`). Unknown ones render greyed with a "CLI not detected" hint.
- Workspace mode toggle: two buttons `data-test="ns-ws-mode-existing"` / `data-test="ns-ws-mode-path"` setting `wsMode`. When `existing`: `<select v-model="workspaceSel" data-test="ns-workspace">` of `inst.workspaces`. When `path`: `<input v-model="workspacePath" data-test="ns-ws-path" placeholder="/abs/path">`.
- Submit button `data-test="ns-create"` `:disabled="!canSubmit"` `@click="submit"`.
- Error banner `data-test="ns-error"` when `error`; pending notice `data-test="ns-pending"` + `data-test="ns-pending-close"` when `pending` (reuse PR #31's markup).
- Remove the old inline `__new__` / `ns-ws-name` / `ns-ws-desc` sub-form entirely.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay-web && npx vitest run src/__tests__/newsessiondialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Build (vue-tsc)**

Run: `bun run build:relay-web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/relay-web/src/components/NewSessionDialog.vue packages/relay-web/src/__tests__/newsessiondialog.test.ts
git commit -m "feat(relay-web): optional auto-alias + catalog agent picker + workspace pick-or-path"
```

---

### Task 8: Per-instance Manage modal (Workspaces + Agents managers)

**Files:**
- Create: `packages/relay-web/src/components/WorkspacesManager.vue`
- Create: `packages/relay-web/src/components/AgentsManager.vue`
- Create: `packages/relay-web/src/components/ManageInstanceDialog.vue`
- Modify: `packages/relay-web/src/components/InstanceTree.vue`
- Test: `packages/relay-web/src/__tests__/managers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/relay-web/src/__tests__/managers.test.ts`:
```ts
import { beforeEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import WorkspacesManager from "../components/WorkspacesManager.vue";
import AgentsManager from "../components/AgentsManager.vue";
import { useInstancesStore } from "../stores/instances";

beforeEach(() => setActivePinia(createPinia()));

function seed(store: ReturnType<typeof useInstancesStore>) {
  store.instances = [{
    id: "i1", name: "n", online: true, sessions: [],
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [{ name: "backend", cwd: "/b", description: "" }],
    agentCatalog: [
      { driver: "codex", configured: true, installed: "builtin" },
      { driver: "gemini", configured: false, installed: "yes" },
    ],
  }] as never;
}

test("WorkspacesManager creates a workspace", async () => {
  const store = useInstancesStore(); seed(store);
  const createWorkspace = vi.spyOn(store, "createWorkspace").mockResolvedValue(undefined as never);
  const w = mount(WorkspacesManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="wm-name"]').setValue("frontend");
  await w.get('[data-test="wm-path"]').setValue("/f");
  await w.get('[data-test="wm-create"]').trigger("click");
  expect(createWorkspace).toHaveBeenCalledWith("i1", "frontend", "/f", undefined);
});

test("WorkspacesManager surfaces a remove-in-use error", async () => {
  const store = useInstancesStore(); seed(store);
  vi.spyOn(store, "removeWorkspace").mockRejectedValue(new Error("workspace \"backend\" is in use by an existing session"));
  const w = mount(WorkspacesManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="wm-remove-backend"]').trigger("click");
  await new Promise((r) => setTimeout(r));
  expect(w.get('[data-test="wm-error"]').text()).toMatch(/in use/);
});

test("AgentsManager adds an agent from the catalog driver picker", async () => {
  const store = useInstancesStore(); seed(store);
  const createAgent = vi.spyOn(store, "createAgent").mockResolvedValue(undefined as never);
  const w = mount(AgentsManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="am-driver"]').setValue("gemini");
  await w.get('[data-test="am-add"]').trigger("click");
  expect(createAgent).toHaveBeenCalledWith("i1", "gemini", "gemini");
});

test("AgentsManager removes a configured agent", async () => {
  const store = useInstancesStore(); seed(store);
  const removeAgent = vi.spyOn(store, "removeAgent").mockResolvedValue(undefined as never);
  const w = mount(AgentsManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="am-remove-codex"]').trigger("click");
  expect(removeAgent).toHaveBeenCalledWith("i1", "codex");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay-web && npx vitest run src/__tests__/managers.test.ts`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement `WorkspacesManager.vue`**

Create `packages/relay-web/src/components/WorkspacesManager.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const props = defineProps<{ instanceId: string }>();
const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const name = ref("");
const path = ref("");
const description = ref("");
const error = ref("");
const busy = ref(false);

async function create(): Promise<void> {
  if (!name.value.trim() || !path.value.trim() || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await store.createWorkspace(props.instanceId, name.value.trim(), path.value.trim(), description.value.trim() || undefined);
    name.value = ""; path.value = ""; description.value = "";
  } catch (e) { error.value = e instanceof Error ? e.message : "create failed"; }
  finally { busy.value = false; }
}

async function remove(wsName: string): Promise<void> {
  error.value = "";
  try { await store.removeWorkspace(props.instanceId, wsName); }
  catch (e) { error.value = e instanceof Error ? e.message : "remove failed"; }
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-sm font-semibold uppercase text-slate-500">Workspaces</h3>
    <p v-if="error" data-test="wm-error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <ul class="divide-y rounded border">
      <li v-for="w in inst?.workspaces ?? []" :key="w.name" class="flex items-center justify-between px-3 py-2 text-sm">
        <span><span class="font-medium">{{ w.name }}</span> — <span class="text-slate-500">{{ w.cwd }}</span></span>
        <button :data-test="`wm-remove-${w.name}`" class="text-red-600 hover:underline" @click="remove(w.name)">remove</button>
      </li>
    </ul>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <input v-model="name" data-test="wm-name" placeholder="name" class="rounded border px-2 py-1 text-sm" />
      <input v-model="path" data-test="wm-path" placeholder="/abs/path" class="rounded border px-2 py-1 text-sm" />
      <input v-model="description" data-test="wm-desc" placeholder="description (optional)" class="rounded border px-2 py-1 text-sm" />
    </div>
    <button data-test="wm-create" class="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !name.trim() || !path.trim()" @click="create">Add workspace</button>
  </section>
</template>
```

- [ ] **Step 4: Implement `AgentsManager.vue`**

Create `packages/relay-web/src/components/AgentsManager.vue`:
```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const props = defineProps<{ instanceId: string }>();
const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const driver = ref("");
const customName = ref("");
const error = ref("");
const busy = ref(false);

const addableDrivers = computed(() => (inst.value?.agentCatalog ?? []).filter((c) => !c.configured));

async function add(): Promise<void> {
  if (!driver.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await store.createAgent(props.instanceId, customName.value.trim() || driver.value, driver.value);
    driver.value = ""; customName.value = "";
  } catch (e) { error.value = e instanceof Error ? e.message : "add failed"; }
  finally { busy.value = false; }
}

async function remove(name: string): Promise<void> {
  error.value = "";
  try { await store.removeAgent(props.instanceId, name); }
  catch (e) { error.value = e instanceof Error ? e.message : "remove failed"; }
}

function hint(installed: string): string {
  return installed === "builtin" ? "built-in" : installed === "yes" ? "installed" : "CLI not detected";
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-sm font-semibold uppercase text-slate-500">Agents</h3>
    <p v-if="error" data-test="am-error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <ul class="divide-y rounded border">
      <li v-for="a in inst?.agents ?? []" :key="a.name" class="flex items-center justify-between px-3 py-2 text-sm">
        <span><span class="font-medium">{{ a.name }}</span> · <span class="text-slate-500">{{ a.driver }}</span></span>
        <button :data-test="`am-remove-${a.name}`" class="text-red-600 hover:underline" @click="remove(a.name)">remove</button>
      </li>
    </ul>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <select v-model="driver" data-test="am-driver" class="rounded border px-2 py-1 text-sm">
        <option value="" disabled>Choose a driver…</option>
        <option v-for="c in addableDrivers" :key="c.driver" :value="c.driver" :disabled="c.installed === 'unknown'">
          {{ c.driver }} ({{ hint(c.installed) }})
        </option>
      </select>
      <input v-model="customName" data-test="am-name" placeholder="name (optional, = driver)" class="rounded border px-2 py-1 text-sm" />
      <button data-test="am-add" class="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !driver" @click="add">Add agent</button>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Implement `ManageInstanceDialog.vue` + InstanceTree button**

Create `packages/relay-web/src/components/ManageInstanceDialog.vue`:
```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useInstancesStore } from "../stores/instances";
import WorkspacesManager from "./WorkspacesManager.vue";
import AgentsManager from "./AgentsManager.vue";

const props = defineProps<{ instanceId: string; instanceName: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useInstancesStore();

onMounted(() => { void store.loadFormOptions(props.instanceId).catch(() => {}); });
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl" data-test="manage-instance-dialog">
      <header class="flex items-center justify-between border-b px-5 py-3">
        <h2 class="text-sm font-semibold">Manage · {{ instanceName }}</h2>
        <button class="text-slate-400 hover:text-slate-600" @click="emit('close')">✕</button>
      </header>
      <div class="space-y-6 p-5">
        <WorkspacesManager :instance-id="instanceId" />
        <AgentsManager :instance-id="instanceId" />
      </div>
    </div>
  </div>
</template>
```

In `packages/relay-web/src/components/InstanceTree.vue`: add a `manageFor` ref mirroring the existing `dialogFor` pattern, a "Manage" button next to the "+ new session" button on each instance row, and mount `<ManageInstanceDialog v-if="manageFor" ... @close="manageFor = null" />`. Import `ManageInstanceDialog`.

- [ ] **Step 6: Run tests + build**

Run: `cd packages/relay-web && npx vitest run src/__tests__/managers.test.ts && cd ../.. && bun run build:relay-web`
Expected: PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-web/src/components/WorkspacesManager.vue packages/relay-web/src/components/AgentsManager.vue packages/relay-web/src/components/ManageInstanceDialog.vue packages/relay-web/src/components/InstanceTree.vue packages/relay-web/src/__tests__/managers.test.ts
git commit -m "feat(relay-web): per-instance Manage modal for workspaces + agents"
```

---

## Phase 5 — Docs + full verification

### Task 9: Docs + full suites + sandbox

**Files:**
- Modify: `docs/relay-module.md`, `docs/relay-web-module.md`

- [ ] **Step 1: Document**

In `docs/relay-module.md` (control/bridge section), document the four new non-chat-scoped RPCs: `control.agents.catalog` (all acpx drivers + `configured` + `installed: builtin|yes|unknown` best-effort PATH probe), `control.agents.create {name,driver}`, `control.agents.remove {name}` (rejected if a session uses the agent), `control.workspaces.remove {name}` (rejected if in use). In `docs/relay-web-module.md`: the new-session dialog now has an optional auto-alias (`‹workspace›-‹agent›`, de-duped), a catalog-driven agent picker (un-installed drivers shown but greyed), and a workspace pick-or-type-path control; per-instance agent/workspace management lives in the Manage modal opened from the instance tree. Match each doc's existing language (zh) and structure.

- [ ] **Step 2: Full suites + builds**

```bash
node ./scripts/run-tests.mjs tests/unit            # core + relay-web vitest
cd packages/relay-web && npx vitest run            # frontend (explicit)
cd ../.. && bun run build:packages && bun run build:relay-web
```
Expected: all green, both builds clean. (If a pre-existing unrelated failure appears, report it — do not fix unrelated failures.)

- [ ] **Step 3: Sandbox end-to-end (controller-run; needs the local relay sandbox)**

Rebuild the sandbox per the previous plan's Appendix (`/tmp/xacpx-relay-test`, repack connector tarball + shims, restart relay `--request-timeout-ms 120000` + console). In the browser: open an instance's **Manage** modal, add a workspace by path and an agent (e.g. `gemini`), then **+ new session** with a blank alias and the New-path workspace mode; confirm the session is created with an auto-alias. Verify a not-installed driver is greyed in the picker.

- [ ] **Step 4: Commit**

```bash
git add docs/relay-module.md docs/relay-web-module.md
git commit -m "docs(relay): agent catalog + management RPCs + redesigned session form"
```

---

## Self-Review

**Spec coverage:**
- Optional auto-alias (spec §C) → Task 6 (`genAlias`/`uniqueName`) + Task 7 (blank-alias path). ✓
- Agent dropdown = machine-available agents (spec §A/§C) → Task 1 (catalog + probe) + Task 3/4 (RPC) + Task 5 (store) + Task 7 (picker, greyed unknowns, auto-create). ✓
- Workspace creation out of the form → into a manager (spec §D) → Task 8 (`WorkspacesManager` in `ManageInstanceDialog`); Task 7 removes the inline `__new__` sub-form. ✓
- Workspace pick-or-type-path (spec §C) → Task 6 (`workspaceNameFromPath`) + Task 7 (`wsMode` toggle + auto-create). ✓
- agents/workspaces management RPCs + in-use guards (spec §A/§B) → Task 2 (guards) + Task 3 (MSG) + Task 4 (bridge). ✓

**Placeholder scan:** All code steps contain full code. Task 7's template is described by exact `data-test` hooks + binding rules rather than a full re-paste of the unchanged modal shell — acceptable because the shell (header/footer/pending markup) is preserved verbatim from PR #31 and the script block is given in full. The implementer must read the current file to preserve the shell. ✓

**Type consistency:** `AgentCatalogEntry` (core, `src/config/agent-catalog.ts`) and `AgentCatalogEntryDto` (protocol) are structurally identical `{driver, configured, installed: "builtin"|"yes"|"unknown"}`. `createSession` returns `{pending:boolean}` (PR #31) — Task 7 relies on `result.pending`. Store action names `loadAgentCatalog`/`createAgent`/`removeAgent`/`removeWorkspace` are identical across Tasks 5/7/8. Session alias field is `alias` on `SessionDto` (used in Task 7's de-dup + Task 7 test). ✓

**Ordering:** 1→2 (catalog feeds control) → 3→4 (protocol before bridge) → 5 (store needs protocol DTO) → 6→7→8 (helpers → dialog → managers) → 9 (verify). Each task independently testable.
