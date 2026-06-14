# Relay Session-Create Redesign — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/relay-session-form-redesign` (stacks on `feat/relay-web-session-create-form` / PR #31)

## Problem

The relay dashboard's "new session" dialog has four usability gaps the user raised:

1. **Alias is mandatory** — should be optional and auto-derived from workspace + agent.
2. **Agent dropdown shows only `claude`/`codex`** — only the two seeded config agents. The user expects the agents *usable on the machine*, not just the configured two.
3. **Workspace creation lives inside the session form** — should move to a dedicated Settings management module.
4. **No quick workspace-by-path** — creating a session should allow either picking an existing workspace *or* typing a filesystem path that auto-creates a workspace (the two are mutually exclusive).

## Key findings (from codebase + acpx investigation)

- **Agent set:** acpx has a fixed registry of 16 supported drivers (`pi, openclaw, codex, claude, gemini, cursor, copilot, droid, iflow, kilocode, kimi, kiro, opencode, qoder, qwen, trae`). xacpx mirrors these in `src/config/agent-templates.ts` (`listAgentTemplates()`), so listing them needs **no new acpx call**.
- **Install detection:** acpx does **not** probe PATH. Only `codex`/`claude` are zero-install (auto-fetched via npx — `BUILT_IN_AGENT_PACKAGES`). The other 14 only run if their CLI is on PATH. xacpx already calls `resolveAgentCommand(driver, command?)` (used in `src/transport/collect-reap-targets.ts`), so for each driver we can resolve its launch command, take the leading binary, and PATH-probe it (`which`/`command -v`). This is **best-effort and advisory**.
- **Hard config requirement:** `SessionService.validateSession` (`src/sessions/session-service.ts:711-731`) throws `agentNotRegistered` if `agent ∉ config.agents` and `workspaceNotRegistered` if `workspace ∉ config.workspaces`. So a session cannot be created with an unconfigured agent or a bare path — the agent/workspace must be persisted to config first. `control.workspaces.create` already does this (`configStore.upsertWorkspace` + live-config refresh, `src/main.ts:783-789`); agents need an analogous create.
- **Existing Settings surface:** `/settings` route + `SettingsView.vue` already exist (pairing token, admin invite, retention display). Extend it — no routing changes.
- **Alias constraints:** only non-empty-after-trim is enforced, but `:` is the channel-scope/transport-session delimiter and must be avoided. Safe charset: `[a-z0-9-]`. The relay create path (`createSessionWithTransport`, `command-router.ts:483-486`) **refuses to overwrite** an existing alias (throws `already exists`), so auto-generated aliases need client-side de-dup.
- **Existing RPCs:** `control.agents.list` (configured only), `control.workspaces.list`, `control.workspaces.create`, `control.sessions.list/create/remove`. **No** agents.create/remove, workspaces.remove. agents/workspaces RPCs are **not** chat-scoped (unlike sessions.*).

## Design

### A. Backend — agent catalog + agent/workspace management (core)

**New `src/config/agent-catalog.ts`:**
```ts
export interface AgentCatalogEntry {
  driver: string;            // acpx driver name (also the default agent name)
  configured: boolean;       // a config.agents entry has this name OR this driver
  installed: "builtin" | "yes" | "unknown"; // see probe below
}
export function listAgentCatalog(config: AppConfig): AgentCatalogEntry[];
```
- Built from `listAgentTemplates()` (18 driver keys; templates carry only `{driver}`, no description) merged with `config.agents`.
- `installed` (note: `BUILT_IN_AGENT_PACKAGES` lives in acpx and is **not importable** by xacpx — acpx is a child-process binary; and xacpx's `resolveAgentCommand(driver, command?)` only returns an explicit override, not the default binary, so it cannot supply the probe target):
  - `"builtin"` for a small hardcoded set `BUILTIN_DRIVERS = ["codex", "claude"]` — always usable via npx.
  - else look up the driver's CLI binary from a small hardcoded best-effort map `DRIVER_BINARIES` (default: the binary equals the driver name; known exceptions like `cursor → cursor-agent` overridden), and check it on PATH → `"yes"` if found, `"unknown"` if not found / not mapped / probe errors. (`"unknown"` never blocks — the binary may be installed under a name we can't predict; the UI greys it with a hint but keeps it selectable — see §C.)
- Probe results cached with a short TTL (e.g. 60s) so re-opening the dialog/manager doesn't re-`which` every binary.

**ControlService additions** (`src/control/control-service.ts`) + deps wired in `src/main.ts` against the live `AppConfig`/`ConfigStore`:
- `listAgentCatalog(): AgentCatalogEntry[]`
- `createAgent(name: string, driver: string): Promise<ControlAgentInfo>` — `configStore.upsertAgent(name, driver)` + live-config refresh; idempotent if the name already maps to the same driver.
- `removeAgent(name: string): Promise<void>` — **guard:** reject (`agent-in-use`) if any session in `listAllResolvedSessions()` uses it.
- `removeWorkspace(name: string): Promise<void>` — **guard:** reject (`workspace-in-use`) if any session uses it.

`ConfigStore` **already has** `upsertAgent(name, AgentConfig)`, `removeAgent(name)`, `removeWorkspace(name)` (`src/config/config-store.ts`) — no config-store changes needed; the new ControlService deps call them then `replaceRuntimeConfig(config, updated)`, mirroring the existing `workspaces.create` wiring in `src/main.ts`.

### B. relay-protocol — new messages/DTOs

Add to `packages/relay-protocol/src/messages.ts` + `dtos.ts`:
- `MSG.agentsCatalog = "control.agents.catalog"` → `{ agents: AgentCatalogEntryDto[] }`
- `MSG.agentsCreate = "control.agents.create"` → payload `{ name, driver }` → `{ agent: AgentDto }`
- `MSG.agentsRemove = "control.agents.remove"` → payload `{ name }` → `{ ok: true }`
- `MSG.workspacesRemove = "control.workspaces.remove"` → payload `{ name }` → `{ ok: true }`
- `AgentCatalogEntryDto = { driver, configured, installed }`

Mapped in `packages/channel-relay/src/control-bridge.ts` (config-global, **no** chatKey stamping — same as the existing `agents.list`/`workspaces.list`).

### C. Session form redesign (`packages/relay-web/src/components/NewSessionDialog.vue`)

- **Alias** — optional. The input's placeholder previews the auto value `‹workspace›-‹agent›` (sanitized `[a-z0-9-]`, lowercased). On submit, if blank, use that value de-duped against the instance's existing `sessions` (`name`, `name-2`, `name-3`, …). `‹workspace›` is the chosen/derived workspace name; `‹agent›` is the chosen agent/driver name.
- **Agent** — `<select>` whose options are, in order: (1) **configured agents** listed by their config name (with their driver shown, e.g. `my-codex · codex`); then (2) **un-configured catalog drivers** (a driver already configured under some name is *not* repeated as a raw-driver entry). Each option shows an availability hint; `installed: "unknown"` options are rendered greyed with a "CLI not detected" hint but remain selectable (advisory only). On submit, if the chosen value is an un-configured driver, call `createAgent(name=driver, driver)` first, then create the session; a configured agent is used directly.
- **Workspace** — a segmented toggle with two mutually-exclusive modes:
  - **Existing** → `<select>` of `inst.workspaces` (`name — cwd`).
  - **New path** → a single text input for an absolute filesystem path.
  On submit in **New path** mode: derive a workspace name from the path basename (sanitized `[a-z0-9-]`, de-duped against `inst.workspaces`), call `createWorkspace(name, path)` (no description), then create the session. The old inline name/desc "+ New workspace…" sub-form is **removed**.
- **Submit order:** (1) ensure agent (auto-create if needed) → (2) ensure workspace (auto-create if New-path) → (3) `createSession`. Each step's error surfaces in the existing `ns-error` banner. The `{pending:true}` create-timeout handling from PR #31 is preserved.

### D. Per-instance management modal (dashboard)

Management is **per-instance** (the control RPCs target one connected instance), and the existing `SettingsView` is a global, admin-gated page with no instance context. So the manager lives as a **modal opened from each instance row** in the dashboard's `InstanceTree` — a "Manage" button next to "+ new session", mirroring the existing `NewSessionDialog` modal pattern. `SettingsView` is unchanged.

**New `ManageInstanceDialog.vue`** — a modal with two sections, each its own child component for isolation:
- **`WorkspacesManager.vue`** — list (`name · cwd · description`), create form (name/path/desc), remove button per row. Remove-in-use → inline error.
- **`AgentsManager.vue`** — list configured agents (`name · driver · availability`), add form (driver `<select>` from catalog + optional custom name, default = driver), remove button per row. Remove-in-use → inline error.

Both use new store actions (below). The catalog (with availability) powers the add-agent driver picker and the session-form agent picker alike.

### E. relay-web store (`packages/relay-web/src/stores/instances.ts`)

- State: add `agentCatalog: AgentCatalogEntryDto[]` to `InstanceView`.
- Actions: `loadAgentCatalog(instanceId)`; `createAgent(instanceId, name, driver)`; `removeAgent(instanceId, name)`; `removeWorkspace(instanceId, name)`. Existing `loadFormOptions` also loads the catalog. Reuse `unwrap()` for instance-side `{error}` payloads.

## Error handling

- Remove agent/workspace in use → server returns `{error:{code:"agent-in-use"|"workspace-in-use"}}` → surfaced inline in the manager.
- Auto-create agent/workspace failure during session create → surfaced in the dialog `ns-error` banner; session not created.
- Install probe failure → entry marked `"unknown"`, never blocks.
- Auto-generated alias collision → de-duped client-side; the relay create path still guards server-side.

## Testing

- **Backend unit:** `agent-catalog` probe (mock `resolveAgentCommand` + a PATH-exists fn; assert builtin/yes/unknown); `ControlService.createAgent/removeAgent/removeWorkspace` incl. in-use guards; new `control-bridge` cases.
- **Frontend (Vitest/jsdom):** store actions (catalog load, create/remove agent & workspace); `NewSessionDialog` (blank-alias auto-gen + de-dup, disabled/unknown driver state, workspace toggle existing-vs-path, auto-create agent & workspace submit order, error surfacing); `WorkspacesManager` + `AgentsManager` (list/create/remove + in-use error).

## Out of scope / non-goals

- True per-driver "is it really runnable" verification beyond a PATH binary check (acpx itself doesn't do this; runtime spawn remains the real test).
- Editing existing agents/workspaces in place (only create + remove).
- Session rename/update.
- Any change to chat-scoping or the transport lifecycle (shipped in PR #31).

## File map

| File | Change |
|---|---|
| `src/config/agent-catalog.ts` | **new** — `listAgentCatalog` + best-effort install probe (`BUILTIN_DRIVERS`, `DRIVER_BINARIES`, PATH check, TTL cache) |
| `src/control/control-service.ts` | `listAgentCatalog`/`createAgent`/`removeAgent`/`removeWorkspace` + deps; in-use guards via `listAllResolvedSessions()` |
| `src/main.ts` | wire the new ControlService deps against `configStore` + `replaceRuntimeConfig` (mirror existing `workspaces.create`) |
| `packages/relay-protocol/src/messages.ts`, `dtos.ts` | new MSG (`agentsCatalog/agentsCreate/agentsRemove/workspacesRemove`) + `AgentCatalogEntryDto` + payload/result interfaces |
| `packages/channel-relay/src/control-bridge.ts` | map the 4 new MSGs (non-chat-scoped) |
| `packages/relay-web/src/stores/instances.ts` | `agentCatalog` state + `loadAgentCatalog`/`createAgent`/`removeAgent`/`removeWorkspace` actions |
| `packages/relay-web/src/components/NewSessionDialog.vue` | optional alias, catalog agent picker, workspace pick-or-path |
| `packages/relay-web/src/components/ManageInstanceDialog.vue` | **new** — per-instance modal hosting the two managers |
| `packages/relay-web/src/components/WorkspacesManager.vue` | **new** |
| `packages/relay-web/src/components/AgentsManager.vue` | **new** |
| `packages/relay-web/src/components/InstanceTree.vue` | add a "Manage" button per instance row opening `ManageInstanceDialog` |
| `docs/relay-module.md`, `docs/relay-web-module.md` | document new RPCs + form/manager behavior |
