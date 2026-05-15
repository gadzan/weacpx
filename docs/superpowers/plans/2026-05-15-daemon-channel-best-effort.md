# Daemon Channel Best-Effort Startup Plan

> **For agentic workers:** Use the superpower workflow: keep this plan updated while implementing, and verify behavior with focused tests before broader checks.

**Goal:** Let `weacpx start` keep daemon orchestration IPC alive even when all message channels fail to start, so external MCP usage works without an active Weixin login.

**Spec:** `docs/superpowers/specs/2026-05-15-daemon-channel-best-effort-design.md`.

**Implementation note:** detached daemon children set `WEACPX_DAEMON_RUN=1`, and `defaultRun()` maps that marker to `channelStartupPolicy: "best-effort"`; direct `weacpx run` remains strict (`"require-one"`).

## Tasks

- [x] Add a daemon-mode unit test for channel startup failure that remains alive until shutdown.
  - File: `tests/unit/run-console.test.ts`
  - Simulate `channels.startAll` throwing `all channels failed to start`.
  - Capture process signal handlers.
  - Assert the promise is still pending before simulated SIGTERM.
  - Assert cleanup after SIGTERM.

- [x] Implement best-effort daemon behavior in `src/run-console.ts`.
  - Foreground behavior remains unchanged.
  - Best-effort policy catches `channels.startAll` rejection, logs `daemon.channels.start_failed`, then waits for shutdown.
  - Existing cleanup sequence remains the single cleanup path.

- [x] Run targeted tests.
  - `npm run test:unit -- tests/unit/run-console.test.ts`

- [x] Run validation.
  - `npx tsc --noEmit`
  - Optionally `npm test` if time permits.
