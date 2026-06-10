# Codebase Review Fixes (2026-06-10)

Source: full-codebase review (6 parallel review agents, top findings hand-verified).
Branch: `worktree-fix+review-batch-2026-06`. Execution: subagent-driven development, one task at a time.

## Tasks

### Task 1 — Stop wiping WeChat credentials on shutdown; remove unauthenticated `/logout` chat command (P0)
- `MessageChannelRegistry.stopAll()` (`src/channels/channel-registry.ts`) implements "stop" as `channel.logout()`. For the built-in Weixin channel this chains to `clearContextTokensForAccount()` + `clearAllWeixinAccounts()` (`src/weixin/auth/accounts.ts`), physically deleting `~/.openclaw/openclaw-weixin/accounts/*.json` on every graceful stop (SIGTERM/`xacpx stop`/startup-error cleanup in `run-console.ts`). A second instance losing the consumer lock also wipes the healthy daemon's credentials.
- Fix: add optional non-destructive `stop()` to the channel runtime interface (`src/channels/types.ts`); `stopAll()` prefers `channel.stop?.()` and falls back to `logout()` only when `stop` is absent (plugin compat: feishu/yuanbao `logout()` is a benign client stop). `WeixinChannel.stop()` must not touch credential files. Explicit `xacpx logout` CLI keeps calling `logout()`.
- Remove the `/logout` case from `src/weixin/messaging/slash-commands.ts` (any chat peer could wipe all bot credentials; no auth on that path). CLI logout remains the only logout surface.

### Task 2 — SessionService: preserve background results; don't inherit transport agent command across agents (P0)
- `useSession`/`usePreviousSession` (`src/sessions/session-service.ts`) rebuild the chat context object and drop `background_results`, so the switch-back replay (`takeBackgroundResult`) never fires and ● unread markers vanish. Fix: preserve existing context fields when switching.
- `removeSession` deletes the whole chat context when removing the current session, destroying other sessions' background results and `previous_session`. Fix: prune only references to the removed alias (promote `previous_session` if available).
- `createLogicalSession`/`resolveSession` carry the old same-alias session's `transport_agent_command`, `mode_id`, `reply_mode` onto a new session even when the agent differs → prompts go to the wrong backend. Fix: carry these over only when the agent matches.

### Task 3 — Bridge transport: permissionPolicy plumbing + stdin backpressure (P0)
- `transport.permissionPolicy` never reaches the bridge: spawn env doesn't include it and the `updatePermissionPolicy` RPC dispatch in `src/bridge/bridge-server.ts` forwards only `permissionMode`/`nonInteractivePermissions`. `BridgeRuntime` already supports it (`--permission-policy`). Fix: pass through spawn env (`bridge-env`) and the RPC dispatch; add to `SpawnedBridgeClientOptions`.
- `AcpxBridgeClient.request` treats `stdin.write(...) === false` (backpressure) as a fatal "buffer full" error and rejects/deletes the pending entry, while the request still executes → ghost execution + lost output for >~16KB prompts. Fix: `false` is not an error; only fail on actual write errors.

### Task 4 — orchestration-server: accept `parallel` in delegate parsing (P0)
- `parseRequestDelegateRpcInput` (`src/orchestration/orchestration-server.ts`) omits `parallel` from the `requireOnlyKeys` allowlist and never copies it, so every `delegate_request`/`delegate_batch` entry that sets `parallel` fails with `ORCHESTRATION_INVALID_REQUEST`. MCP tools advertise it and the service supports it. Fix: allow + validate boolean + forward.

### Task 5 — Scheduler robustness (daemon crash + validation bypass)
- `scheduled-scheduler.ts` `tick()` is `try/finally` with no catch; a thrown `claimDueTasks()`/`markFailed()` (state save failure) escapes `void this.tick()` as an unhandled rejection → kills the daemon. Fix: catch + log.
- `parse-later-time.ts`: overflow durations produce Invalid Date; NaN compares false against min/max so validation passes, then `toISOString()` throws a raw internal error. Fix: treat NaN as out-of-range (friendly error).

### Task 6 — queue-owner-reaper: dedupe by composite key
- `reapQueueOwners` dedupes targets by `transportSession` name only; same-named sessions in different workspaces/agents resolve to different acpx records, second is never reaped. Fix: dedupe on composite identity (agent + cwd + transportSession).

### Task 7 — Plugin legacy-name handling
- `removePlugin` (`src/plugins/plugin-cli.ts`) matches via normalized `findPlugin` but filters config by raw input name → legacy `@ganglion/weacpx-channel-*` names uninstall the package yet leave a ghost config entry. Fix: filter with normalized names.
- `plugin-doctor.ts` `filterByName` same raw comparison → normalize.
- `plugin-doctor.ts` orphan-channel scan iterates all channels including `enabled: false` → wrong error verdict for deliberately disabled channels. Fix: only consider enabled channels (mirror `plugin-cli.ts` `activeChannels`).

### Task 8 — app-logger: logging must not take down message handling
- `app-logger.ts` returns raw write promises; a failing log file (disk full/EACCES) rejects every `await logger.info(...)` — `ConsoleAgent.chat` and `runConsole` startup then fail. Fix: logger methods never reject (degrade gracefully; one-time stderr note is fine).
- `rotating-file-writer.ts` `cleanupExpiredRotatedLogs` `stat()` has no ENOENT tolerance; racing deletion fails `buildApp`. Fix: tolerate ENOENT.

### Task 9 — daemon status.json: atomic write
- `daemon-status.ts` writes status.json non-atomically while the 30s heartbeat rewrites it; readers can see truncated JSON → `xacpx status` exits "indeterminate", concurrent `start` throws "status metadata is missing". Fix: tmp-file + rename in the same directory.

### Task 10 — Windows spawn fixes
- `cli-update.ts` `runCapture`/`runInherit` spawn `npm` without `shell` → fails on Windows (npm is npm.cmd). Fix: `shell: process.platform === "win32"` (pattern already used in `src/recovery/`).
- `create-daemon-controller.ts` PowerShell launcher passes `-ArgumentList @($env:XACPX_DAEMON_ARG0, ...)`; PS 5.1 joins without quoting → install paths containing spaces break `xacpx start`. Fix: quote the arguments inside the PowerShell command.

### Task 11 — Bridge ensureSession timeout
- Bridge-side `ensureSession` has no time bound (`AcpxBridgeClient.request` never times out; `BridgeRuntime.ensureSession`/`spawnCapture` unbounded), unlike acpx-cli's `sessionInitTimeoutMs` (120s default). A hung agent init wedges the session's whole request lane until daemon restart. Fix: apply the configured/default session-init timeout to bridge ensureSession (kill the spawned acpx process on expiry, surface a clear error).

## Deferred (follow-ups, not in this batch)
- Config save rewrites the whole file (drops unknown keys, expands `~`, pins defaults) — needs a design pass on config round-tripping.
- state.json strict parse bricks startup on one bad/old record — needs migration/quarantine design.
- Orchestration socket auth + scheduled_list/cancel chat scoping — security design decision.
- Group `isOwner` detection (weixin/feishu never set it) + chatType fail-open policy — cross-channel contract change.
- Command parser quote/case handling; `/session new` alias-collision refusal; paginated final-answer parking with zero-quota heads-up; `/clear` non-native transport session leak; pairing.ts regex escape (dead code today).
