# Follow-up Batch (2026-06-11)

Source: the deferred section of `2026-06-10-deferred-batch.md` plus review-surfaced items recorded
in PR #22's description. Skipped as not worth fixing: the `WeixinChannel.stop()` vs in-flight
scheduled tick race (shutdown-window cosmetics, reconciled at next start).
Branch: `worktree-followup-batch-2026-06` (base 973c4b9 = main after PR #20/#22).
Execution: subagent-driven development, one task at a time.

## Tasks

### Task F1 — Free-text command bodies keep their quotes (raw-tail extraction)
- Bug: `tokenizeCommand` (src/commands/parse-command.ts) strips quote characters — both straight
  (`"`/`'`, pre-existing) and curly/full-width (since the smart-quote change) — and free-text
  bodies are rebuilt by `join(" ")` of tokens, so `/later in 2h 提醒我看"报告"` stores
  `提醒我看报告`. Chinese IMEs emit curly quotes by default, so this silently rewrites user
  content. Known free-text consumers: `/later` message (src/commands/handlers/later-handler.ts
  builds the message from tokens), `/delegate` task text (parse-command.ts ~:788), `/group new`
  title (parse-command.ts ~:189). Audit parse-command.ts for any other `join(" ")` body rebuilds.
- Fix: free-text tails must be taken verbatim from the original input string, not re-joined from
  tokens. Suggested design (implementer may refine): make the tokenizer record each token's source
  start/end offsets; a free-text consumer takes `input.slice(<start of first body token>)` (trim
  trailing whitespace) instead of joining. Structured arguments (flags, aliases, time specs) keep
  tokenized behavior, including quoted-token support for args with spaces.
- Tests: bodies with curly quotes, straight quotes, mixed, multiple spaces between words
  (verbatim tail should preserve internal spacing), and the structured prefix still parsing
  (e.g. `/later at "10:00" …` style args if supported). Existing parse tests must keep passing.

### Task F2 — Bridge ensureSession: one shared deadline
- Bug: in src/bridge/bridge-runtime.ts, `ensureSession` runs `sessions ensure` and on failure
  `sessions new`, each spawnCapture getting a FULL `timeoutMs` budget, with an untimed
  `sessions show` probe between — worst case ≈2× `sessionInitTimeoutMs` (+probe) before the user
  sees the timeout error. acpx-cli's equivalent is a single end-to-end bound.
- Fix: compute one deadline at entry (`now + timeoutMs`); every subprocess step (ensure, show
  probe, new, any verbose-fallback retry) gets `remaining = max(deadline - now, small-floor)` as
  its timeoutMs; on expiry surface the same EnsureSessionFailedError("session initialization
  timed out after Ns") the per-step timeout produces today. Check `resumeAgentSession` for the
  same pattern and bound it identically.
- Tests: fake spawn that burns the budget in step 1 → step 2 gets only the remainder (assert via
  captured per-call timeout values); total-elapsed bound test with injected clock if the module
  has one (look at existing bridge-runtime tests for the spawnFn/killProcessTreeFn seams).

### Task F3 — Plugin spec validation at the CLI boundary
- Bug: a plugin spec containing `"` breaks out of the cmd.exe quote wrapper that
  `shellSpawnPlan` (src/plugins/package-manager.ts) applies on Windows (same trust level as the
  user's shell — no privilege boundary — but unclean), and `%VAR%` is expanded by cmd.exe even
  inside quotes.
- Fix: validate specs where the user hands them over (plugin add path in src/plugins/plugin-cli.ts
  and any other entry point feeding package-manager): reject any spec containing `"` on ALL
  platforms (double quotes are never valid in an npm package spec) with a clear error; on win32,
  reject specs containing `%` too (npm specs may legitimately contain %-encoded URL characters in
  tarball URLs, but on Windows they would be mangled anyway — refusing is more honest than
  corrupting; mention the workaround of installing via npm directly). Keep error messages via the
  existing message/i18n mechanism used by plugin CLI output (check how plugin-cli reports errors —
  it may be plain English CLI strings, match that).
- Tests: specs with `"` rejected everywhere; `%` rejected on win32 (platform-injectable seam if
  needed — see how package-manager tests fake win32); normal specs (name, name@version, scoped)
  unaffected.

### Task F4 — markExecuted save failure must not record a dispatched task as FAILED
- Bug: in src/scheduled/scheduled-scheduler.ts the dispatch try/catch wraps both the dispatch and
  the subsequent `markExecuted`; if dispatch SUCCEEDS but `markExecuted`'s state save throws, the
  catch calls `markFailed` — recording a successfully-dispatched task as FAILED (and `markFailed`'s
  own save will likely fail too, already logged via scheduled.dispatch.mark_failed).
- Fix: separate the failure domains — only dispatch errors reach `markFailed`; a `markExecuted`
  failure is logged with its own snake_case event (e.g. `scheduled.dispatch.mark_executed_failed`)
  and the task is left as-is (disk likely still says pending/triggering; startup reconciliation
  handles it). Read the current code carefully — the 2026-06-10 batch already added
  scheduled.claim/mark_failed handling; extend that structure, don't restructure it.
- Tests: dispatch ok + markExecuted throws → markFailed NOT called, event logged; dispatch throws
  → markFailed still called (existing behavior preserved).

### Task F5 — ConfigStore: hold the file lock across read→patch→write
- Bug: `patchRaw` (src/config/config-store.ts) reads the raw file, patches, then calls
  `writePrivateFileAtomic` — the lock inside writePrivateFileAtomic (proper-lockfile, see
  src/util/private-file.ts) only serializes the WRITE, so two concurrent mutations
  (e.g. /pm set during /config set) lose one. Pre-existing window (old load→save had it too).
- Fix: acquire the same proper-lockfile lock for the WHOLE read→patch→write span. Likely shape: a
  `withPrivateFileLock(path, fn)` helper in src/util/private-file.ts reusing its lock options;
  writePrivateFileAtomic gains an internal variant that skips re-locking when already held (or the
  helper composes the existing pieces — read private-file.ts first and pick the cleanest;
  proper-lockfile is not reentrant, so do NOT nest two lock() calls on the same path).
- Tests: two concurrent patchRaw calls both land (run them with Promise.all against a real temp
  file; assert both keys present). Existing config-store tests keep passing.

### Task F6 — pluginRemoved success message names the normalized package
- One-liner: src/plugins/plugin-cli.ts removal success message uses the raw user input
  (`pluginRemoved(packageName)`) while the failure path already uses the normalized
  `existing.name`. Use `existing.name` for consistency. Adjust/extend the existing legacy-name
  removal test to assert the message.

## Deferred (still not in this batch)
- `WeixinChannel.stop()` vs in-flight scheduled tick: spurious task-failure log at shutdown,
  reconciled at next start — cosmetic, not worth the surgery.
- `replaceChannels`/`replacePlugins` write parsed (closed) entries — unknown keys inside a
  channels[]/plugins[] entry don't survive channel/plugin CLI ops (tool-managed arrays by design).
- MCP `scheduled_list` per-task `chatKey` output is now redundant (always the caller's own).
- Pending-final queue front-trim (40 chunks) can make the parked-notice count overstate for
  giant answers.
