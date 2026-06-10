# Deferred Batch (2026-06-10)

Source: design research on the deferred list of `2026-06-10-codebase-review-fixes.md`
(4 parallel research agents, findings hand-verified). User approved all four groups.
Branch: `fix/deferred-batch-2026-06`, stacked on `worktree-fix+review-batch-2026-06` (PR #20).
Execution: subagent-driven development, one task at a time.

## Group A — Security

### Task A1 — Scope scheduled list/cancel to the originating chat (M)
- Bug: tasks store `chat_key` (`src/scheduled/scheduled-types.ts:17`, populated at
  `scheduled-route-create.ts:77` and `later-handler.ts:99-108`) but `listPending()` returns ALL
  pending tasks globally and `cancelPending(id)` cancels any task with no ownership check
  (`src/scheduled/scheduled-service.ts:71-87`). Any chat can read other chats' task messages
  (information disclosure — `scheduled_list` even returns `chatKey` + message preview,
  `src/mcp/xacpx-mcp-tools.ts:430-439`) and cancel them.
- Fix: thread the caller's chat key into both surfaces and filter/verify on `task.chat_key`:
  - MCP path: `resolveOwnedCoordinatorRoute` (`src/scheduled/scheduled-route-manage.ts:46-66`)
    already returns the route; `listScheduled`/`cancelScheduled` (`scheduled-route-manage.ts:30-41`)
    must pass `route.chatKey` down. `listPending(chatKey)` filters; `cancelPending(id, chatKey)`
    verifies match before cancelling (mismatch behaves as not-found).
  - Chat path: `/later list` / `/later cancel` handlers (`src/commands/handlers/later-handler.ts:112-124`)
    receive `chatKey` from the router (`src/commands/command-router.ts:297-323`, already in scope there).
- Keep the existing group owner-only gate on top. No `--all` flag (no global-admin principal exists).

### Task A2 — Harden orchestration socket filesystem permissions (S)
- Today: runtime dir and `orchestration.sock` are 0755 (`mkdir` with no mode at
  `src/daemon/create-daemon-controller.ts:39`; socket created in
  `src/orchestration/orchestration-ipc.ts:119-135`); cross-uid denial currently rests only on the
  incidental socket write-bit. The server has zero auth (`orchestration-server.ts:83-108`).
- Fix: chmod the runtime dir to 0o700 and the socket to 0o600 after `listen()` (POSIX only; Windows
  named pipes keep default DACL — document). Mirrors upstream acpx (`lease-store.ts` uses 0700 dir).
- Also ensure every `mkdir` that creates the runtime dir passes `mode: 0o700` (check
  `create-daemon-controller.ts`, `main.ts`, anywhere `runtimeDir` is created).
- Document the trust boundary in `docs/external-mcp.md`: same user account = trusted; any process
  running as the user can drive agents (same stance as ssh-agent / rootless Docker).
- Do NOT add token handshake or SO_PEERCRED (same-uid attacker reads the token anyway; FS perms
  already cover cross-uid).

## Group B — Group authorization

### Task B1 — `ownerIds` config + chatType fail-closed for real channel turns (S-M)
- Today: `authorizeCommandForChat` (`src/commands/command-policy.ts:28-45`) requires
  `metadata.isOwner` for privileged commands in groups, but weixin
  (`src/weixin/messaging/handle-weixin-message-turn.ts:437-447`) and feishu
  (`packages/channel-feishu/src/inbound.ts:37-49`) never set it → groups are fail-closed-for-all
  (operator included); `scheduled_*` in groups always throws. Yuanbao sets it from `bot_owner_id`
  (`packages/channel-yuanbao/src/channel.ts:500-508`). The weixin protocol carries no group-role
  info at all (`src/weixin/api/types.ts:154-169`) so SDK detection is impossible.
- Fix part 1 (`ownerIds`): per-channel config list of trusted sender ids (precedent: feishu
  `allowFrom`, `docs/config-reference.md:266-268`). Compute at one seam (router entry and/or where
  route metadata is recorded, `session-handler.ts:763-784`):
  `effectiveIsOwner = metadata.isOwner === true || senderId ∈ ownerIds`. Needs the sender id in
  metadata (weixin: `from_user_id`; feishu: sender open id — check what each turn already carries).
  Config plumbing: `load-config.ts` + `config-reference.md` + types. Sender ids are discoverable
  from existing `command.blocked` logs (command-router.ts:151-157).
- Fix part 2 (chatType fail-closed): in `authorizeCommandForChat`, when `metadata.channel` is
  present but `chatType` is missing → treat privileged commands as denied + log a contract-violation
  warning. Metadata-absent internal callers (dry-run `src/dry-run.ts:51-55`, weixin scheduled turns
  `scheduled-turn.ts:150-154`) keep current behavior — gate the fail-closed branch on
  `metadata.channel` being present. Update dry-run to pass `chatType: "direct"` explicitly.
- Watch the route merge `orchestration-service.ts:4488-4516` (`input.isOwner ?? existing?.isOwner`):
  compute effectiveIsOwner per-turn before recording so stale `true` can't linger.
- Do NOT implement feishu chat-owner API lookup (wrong trust anchor, extra scope) and do NOT loosen
  `GROUP_PUBLIC_COMMAND_KINDS`.

## Group C — Persistence robustness

### Task C1 — Config raw-patch writes (M)
- Today: every mutator does load → `parseConfig` (closed object, drops unknown keys, expands `~`
  via `load-config.ts:282`, materializes ALL defaults at `load-config.ts:313-362`) → `save()`
  whole-object stringify (`src/config/config-store.ts:13-15`). One `/config set` or `/agent add`
  rewrites a hand-edited file: unknown keys gone (e.g. validated-but-unserialized
  `workspaces.*.allowed_agents`, `load-config.ts:259-264` vs `:280-285`), `~` expanded (defeating
  `ensure-config.ts:110-115`'s deliberate literal `~`), defaults pinned (e.g.
  `queueOwnerTtlSeconds: 1800` frozen against future default changes).
- Fix: the parsed `AppConfig` is a READ model, never a WRITE model. Rework `ConfigStore`
  (`src/config/config-store.ts`) so mutations are raw patches: `readFile` → `JSON.parse` (no
  parseConfig) → mutate only the targeted subtree → `writePrivateFileAtomic`. Keep `parseConfig`
  read-side only.
  - The six mutators (`upsertWorkspace`/`removeWorkspace`/`upsertAgent`/`removeAgent`/
    `updateTransport`/`updateChannel`) become raw-patch operations.
  - Replace `save(fullConfig)` call sites with a patch-style API: `config-handler.ts:83` (+ rollback
    `:88` re-applies the old raw value), `cli.ts:537,562,978,1103,1131`.
  - `workspace-handler.ts:52` stores the user's raw cwd (with `~`) — normalize at load/use only.
  - Slim the seed template `ensure-config.ts:13-44`: stop pinning `sessionInitTimeoutMs`/
    `permissionMode`/logging numbers at first run.
- Do NOT add JSON5/comment-preserving editing (strict JSON.parse today means no user file has
  comments); do NOT keep a public whole-object `save()`.

### Task C2 — state.json per-record quarantine + backup (M)
- Today: `StateStore.load` (`src/state/state-store.ts:656-679`) → `parseState` → strict sub-parsers
  throw on the FIRST bad record (sessions `:467`, chat contexts `:482`, scheduled `:586`,
  orchestration `:358-416`, plus cross-record `validateExternalCoordinatorIdentityCollisions`
  `:621-647`). A throw bricks the daemon child (`main.ts:194`), the `xacpx start` parent
  (onboarding loads state, `cli.ts:556-558`), and `xacpx mcp-stdio` (`cli.ts:1015`). Realistic
  trigger: version downgrade after a new enum value/field was written (shape churn is routine in
  git history). Precedent already in-repo: `native_session_lists` is deliberately lenient
  (`:520-536`).
- Fix: convert strict loops to collect-and-skip. `StateStore.load()` exposes a load report
  (`dropped: {section, key, reason}[]`); when anything was dropped, copy the ORIGINAL file to
  `state.json.quarantine-<ts>` BEFORE any subsequent save (debounced saves at `main.ts:196-204`
  fire ~50ms after load, so the backup must happen inside `load`), and `buildApp` logs each drop at
  error level. `validateExternalCoordinatorIdentityCollisions` becomes a repair (drop the
  regenerable `externalCoordinators` side) instead of a throw. Whole-file JSON syntax error →
  rename to `state.json.corrupt-<ts>` + start empty + loud log.
- Add a `state.version` field written on every save (cheap forward-compat hook; do NOT build a
  migration chain yet).
- Do NOT loosen the enum/field checks themselves — an invalid record quarantines, it never flows
  into dispatch logic with fabricated values.

## Group D — Small fixes

### Task D1 — `/clear` closes the previous transport session for non-native sessions too (S)
- `src/commands/handlers/session-reset-handler.ts:88-105`: close is gated on `wasNative`; plain
  sessions re-point the alias to `…:reset-<now>` and orphan the old transport session (warm owner
  until TTL). The alias-sharing guard (`countAliasesSharingTransport === 0`, `:91`) already makes
  closing safe. Fix: drop the `wasNative` gate; close best-effort whenever no other alias shares it.

### Task D2 — Command-name case-insensitivity + smart-quote tokenization (S)
- Case: `isKnownXacpxCommandPrefix` lowercases (`src/commands/command-list.ts:35`) but
  `normalizeCommand` (`parse-command.ts:623-630`) does not → `/Status` is recognized yet matches no
  branch → "invalid command". Fix: lowercase the command token in `normalizeCommand` (subcommand
  tokens stay as-is unless already case-insensitive).
- Quotes: `tokenizeCommand` (`parse-command.ts:651-687`) handles `"`/`'` but not curly/full-width
  quotes（“ ” ‘ ’ ＂）which mobile keyboards auto-substitute. Fix: treat them as quote chars,
  mapping open/close pairs.

### Task D3 — `/session new` refuses an existing alias (S, decision: refuse)
- Today `handleSessionNew` (`session-handler.ts:192-226`) + `createLogicalSession`
  (`session-service.ts:690`) silently overwrite: same workspace → silently reuses the old transport
  session with all history ("new" is a lie); different workspace/agent → old transport session is
  orphaned; a native session's `agent_session_id` is silently dropped (`session-service.ts:674-675`).
- Fix: if the alias already exists for this user, refuse with a message pointing to `/use <alias>`
  and `/session rm <alias>` (en + zh i18n). Note in the message which workspace/agent the existing
  session has. Internal/repair paths that intentionally recreate (`resolveSession`,
  `session-service.ts:113-114`) are NOT affected — only the user-facing `/session new`.

### Task D4 — Zero-quota paginated final answer: send a parking heads-up (S, decision: heads-up bypasses final quota)
- Today (`src/weixin/messaging/handle-weixin-message-turn.ts:507-565`): with `finalRemaining=0` the
  wave is empty, the heads-up tail is only attached when `wave.length > 0`, so ALL pages are parked
  silently; they are only drained by `/jx` and any other inbound DROPS them
  (`quota-manager.ts:101-107`) — the answer is silently lost and the user was never told `/jx`
  exists. The same-window single-chunk case (`:489-494`) is dropped outright without parking.
- Fix: when pages are parked (or a final is dropped) and zero pages could be sent, send ONE short
  notice ("N pages parked, reply /jx to receive" — i18n en+zh) that bypasses the final quota (it is
  a fixed-size system notice, not model output; without the bypass it is unsendable by
  construction, which is the root cause). Also park (not drop) the single-chunk zero-quota case if
  low-risk; otherwise at minimum send the notice.

### Task D5 — Delete dead `pairing.ts` (S)
- `src/weixin/auth/pairing.ts` is a vendored mirror never wired in:
  `resolveFrameworkAllowFromPath`/`readFrameworkAllowFromList`/`registerUserInAllowFromStore` have
  zero callers in `src/`, `tests/`, `packages/`. Its `deny` regex is also subtly wrong post-bd1e602
  (matches literal `\.\.` not `..`). Delete the module (and its test file if one exists).

## Deferred (noted, not in this batch)
- Bridge `ensureSession` worst-case budget ≈2× `sessionInitTimeoutMs` (ensure + new each get a full
  budget, untimed `sessions show` between) — share one deadline if it ever bites.
- Plugin spec validation: reject `"` (cmd.exe quote-escape) and warn on `%` in specs on Windows
  before they reach `shellSpawnPlan`.
- `WeixinChannel.stop()` nulls fields while an in-flight scheduled tick may still run → cosmetic
  spurious task failure at shutdown.
- `markExecuted` save failure records a successfully-dispatched task as FAILED.
- `pluginRemoved(packageName)` success message echoes the raw legacy input (cosmetic).
