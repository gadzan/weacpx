# Plan: `xacpx doctor` enhancements — repair mode, plugin/channel health, more coverage

Date: 2026-06-11
Status: proposed (awaiting approval)

## Motivation

`xacpx doctor` today is **diagnose-only**: 8 read-only checks (Config, Runtime, Daemon,
WeChat, Acpx, Bridge, Orchestration, Smoke) emitting `severity + summary + details +
suggestions`, rendered to the terminal, exit 1 on any FAIL. Two concrete gaps surfaced
in practice:

1. **No repair.** Even trivially-fixable conditions (runtime dir perms, stale lock/pid
   files, quarantinable `state.json` records) require the user to act manually.
2. **No plugin/channel health.** A channel-plugin that fails to load — e.g. the feishu
   `failed to import plugin: Cannot find module '@ganglion/xacpx-channel-feishu'` seen
   right after a core update — is **not** caught by `xacpx doctor`. That logic exists, but
   only behind a *separate* `xacpx plugin doctor` (`inspectPlugins`).

Approved directions (user, 2026-06-11): **(1) `--fix` repair mode**, **(2) fold in
plugin/channel health**, **(3) more coverage**. (`--json` output explicitly out of scope.)

## Design principles

- **Detect and repair stay separate.** Checks remain pure/read-only and never mutate as a
  side effect (the Orchestration check already deliberately uses `StateStore.inspect()`,
  not `load()`). Repairs run only under an explicit `--fix`.
- **`--fix` is conservative.** A fix auto-applies only if it is **local, non-destructive,
  and needs no network**. Anything requiring the network (plugin (re)install), user intent
  (a malformed config value), or interaction (WeChat re-login) stays a **suggestion**,
  never an auto-fix.
- **State-mutating fixes are gated on the daemon being stopped.** Quarantining `state.json`
  records or removing a consumer lock while the daemon is live would race it. When the
  daemon is running, such a fix is *withheld* with a "stop the daemon first" note.
- English output only (matches existing doctor strings; no CJK so the i18n guard is
  unaffected).

---

## Task A1 — Repair framework (types + runner)

**Files:** `src/doctor/doctor-types.ts`, `src/doctor/doctor.ts`, `src/doctor/render-doctor.ts`

Extend the result shape with optional, typed, *lazily-executed* fixes:

```ts
export interface DoctorFixOutcome { ok: boolean; message: string; }
export interface DoctorFix {
  id: string;                 // stable, e.g. "runtime.repair-perms"
  title: string;              // human: "create runtime dir with mode 0700"
  /** Withheld (not run) under --fix with this reason set; rendered as a note. */
  withheld?: string;          // e.g. "stop the daemon first: xacpx stop"
  run: () => Promise<DoctorFixOutcome>;
}
export interface DoctorCheckResult { /* ...existing... */ fixes?: DoctorFix[]; }
export interface DoctorRunOptions { /* ...existing... */ fix?: boolean; }
```

Runner (`runDoctor`):
1. Run all checks read-only (unchanged).
2. If `options.fix`: for each check result in order, for each `fix` whose `withheld` is
   unset, `await fix.run()` and record `{ checkId, fixId, title, outcome }`. Withheld
   fixes are recorded as skipped-with-reason. Swallow/normalise thrown errors into
   `{ ok: false, message }` (a failing repair must never crash doctor).
3. After applying, **re-run the affected checks** (those that had an applied fix) to show
   post-fix state; replace their results in the report.
4. Return `report` (with a new `repairs: DoctorRepairOutcome[]`) + rendered output. Exit
   code: still `1` if any FAIL remains *after* repairs.

Render:
- Without `--fix`: a check carrying fixes shows `(fixable — run: xacpx doctor --fix)`.
- With `--fix`: append a `Repairs:` section listing each applied fix and `ok`/`failed`/
  `skipped: <reason>`, then the (re-checked) summary line.

**Tests:** `tests/unit/doctor/doctor.test.ts` (extend) — fixes only run under `--fix`;
withheld fixes are not run; affected checks are re-run after fixing; a throwing fix is
captured, not propagated; exit code reflects post-repair severity.

## Task A2 — Attach safe fixes to existing checks

Wire concrete, in-scope fixes onto the checks that detect a fixable condition. Each fix
reuses an existing primitive — no new repair logic invented.

- **Runtime** (`runtime-check.ts`): when the runtime dir is missing or its mode is not
  `0700`, attach `runtime.ensure-private-dir` → `ensurePrivateRuntimeDir(runtimeDir)`
  (create + chmod-repair; already exists). Local, safe, ungated.
- **Daemon** (`daemon-check.ts`): when a **stale** consumer lock or pid/status file is
  owned by a **dead** pid (and no live daemon), attach `daemon.clear-stale-runtime` →
  remove the stale lock / clear stale pid+status (reuse controller stale-clearing +
  targeted lock removal). Gated: `withheld` when a daemon is currently running.
- **Orchestration** (`doctor.ts` `defaultCheckOrchestrationHealth`): when the inspection
  reports droppable/corrupt `state.json`, attach `state.quarantine` → `new
  StateStore(statePath).load()` (performs the documented quarantine/backup/rename). Gated:
  `withheld` when a daemon is running (it would do this itself at next start).

Explicitly **suggestion-only** (no auto-fix): invalid config value (Config), missing or
broken plugin package (needs `xacpx plugin add` → network), disabled plugin (behaviour
change), WeChat logged out (interactive).

**Tests:** per-check unit tests assert the fix is attached only on the fixable condition,
is withheld when the daemon runs, and that `run()` invokes the injected primitive.

## Task B1 — Plugin/channel health check (fold-in)

**Files:** new `src/doctor/checks/plugin-check.ts`; wire into `src/doctor/doctor.ts`.

Wrap the existing `inspectPlugins`:
```ts
inspectPlugins({
  config,
  pluginHome: resolvePluginHome({ home }),
  currentXacpxVersion: XACPX_CORE_VERSION,
})
```
Map issues → one `DoctorCheckResult` id `"plugins"`, label `"Plugins"`:
- any `error` → `fail`; else any `warn` → `warn`; else `pass` (or `skip` if no plugins
  configured).
- `details` = each issue message; `suggestions` = the `xacpx plugin …` hints already
  embedded in the messages (deduped).
- If config fails to load, `skip` with a pointer to the Config check (mirror
  Orchestration's behaviour). Reuse the shared `loadConfig`.

Insert in `runDoctor` after Bridge, before Orchestration. This is the check that would
have caught the feishu import failure.

Suggestion-only fix (network): `error` "package not installed / failed to import" →
suggest `xacpx plugin add <pkg> && xacpx restart` (no auto-run).

**Tests:** `tests/unit/doctor/checks/plugin-check.test.ts` — error/warn/ok/skip mapping
from injected `inspectPlugins`; import-failure surfaces as `fail` with the package name.

## Task C1 — Orchestration socket liveness check

**Files:** new `src/doctor/checks/orchestration-socket-check.ts`; wire into `doctor.ts`.

When the daemon reports **running**, confirm the orchestration IPC endpoint actually
accepts connections (catches a daemon whose heartbeat is fresh but whose orchestration
server is dead). Reuse `resolveOrchestrationEndpoint` + the existing `endpoint-probe.ts`
(definitive-no-listener semantics). Result:
- daemon not running → `skip` ("daemon stopped").
- endpoint reachable → `pass`.
- definitive no-listener → `fail` ("daemon is running but orchestration IPC is not
  accepting connections"), suggest `xacpx restart`.
- ambiguous/other → `warn` with the detail.

**Tests:** `tests/unit/doctor/checks/orchestration-socket-check.test.ts` — skip when
stopped; pass/fail/warn from an injected probe.

## Task C2 — Log/disk growth health check

**Files:** new `src/doctor/checks/logs-check.ts`; wire into `doctor.ts`.

Sum the sizes of `app.log` / `stdout.log` / `stderr.log` (and rotation siblings) in the
runtime dir. `warn` if any single file exceeds a threshold (default 50 MB) or the total
exceeds 200 MB — a signal that rotation isn't keeping up or disk pressure is building.
`pass` otherwise; `skip` if the runtime dir doesn't exist yet. Read-only; thresholds are
constants with an injectable override for tests. No auto-fix (suggest checking rotation /
disk), since truncating logs is destructive.

**Tests:** `tests/unit/doctor/checks/logs-check.test.ts` — pass under threshold, warn over
(single-file and total), skip when missing.

## Task D1 — CLI flag + docs

- `src/cli.ts` `parseDoctorArgs`: add `--fix` → `options.fix = true`.
- New `docs/doctor-command.md`: the check matrix, severities, `--fix` safety model (what
  auto-applies vs stays a suggestion, daemon-stopped gating), and the new checks. Link it
  from `AGENTS.md` "Docs to rely on" and `README` if doctor is referenced there.

## Out of scope / deferred

- `--json` machine-readable output (user deselected).
- **Warm queue-owner orphan scan.** Detecting *leaked* warm `acpx __queue-owner` process
  trees needs acpx-side process scanning whose identity model is fuzzy from the xacpx
  side; the existing startup reap already cleans these. Revisit only if a concrete,
  low-false-positive signal emerges. (Related: `attempted=28` startup reap cost.)
- Auto-running plugin (re)install or config rewrites under `--fix` (network / intent).

## Execution

Subagent-driven-development in an isolated worktree: per-task implementer (TDD, per-file
tests via `bun test ./tests/unit/<file>`) → spec + code-quality review → fix loop; final
whole-batch review; full `npm test` + `bun run build`; PR to `main`. No release unless
asked.
