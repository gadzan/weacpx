# Daemon Channel Best-Effort Startup — Design

Status: v1 — ready for implementation.
Date: 2026-05-15.
Companion plan: `docs/superpowers/plans/2026-05-15-daemon-channel-best-effort.md`.

## 1. Problem

`weacpx start` currently couples daemon lifetime to message-channel startup. The daemon starts orchestration IPC before starting channels, but if every enabled channel fails to start, `MessageChannelRegistry.startAll()` throws `all channels failed to start`; `runConsole()` then enters cleanup and stops the daemon runtime.

For Weixin this means a fresh machine with no stored login credentials will enter QR login during daemon startup. If nobody scans/confirms the QR code before the login wait timeout, the Weixin channel fails, all channels fail, and the daemon exits.

That behavior is reasonable for the original "WeChat console only" use case, but it blocks a newer use case: using the daemon as a standalone external MCP/orchestration service even when no interactive message channel is currently available.

## 2. Goals

- `weacpx start` should keep the daemon and orchestration IPC server alive when channel startup fails.
- External MCP clients should be able to connect to the daemon even if Weixin is not logged in or its startup/login times out.
- Foreground `weacpx run` should keep the existing strict behavior: if every channel fails, the command exits with an error.
- Channel failures must remain observable in structured logs.
- Shutdown behavior must remain clean: SIGINT/SIGTERM or `weacpx stop` still stops IPC, runtime resources, channels, and daemon metadata.

## 3. Non-goals

- Do not redesign Weixin QR login in this change.
- Do not add dynamic channel restart/retry after a later `weacpx login`.
- Do not change daemon status schema.
- Do not change external MCP protocol or tools.
- Do not change `MessageChannelRegistry.startAll()` semantics globally; callers may still rely on its current strict "all failed" rejection.

## 4. Proposed behavior

`runConsole()` receives an explicit `channelStartupPolicy` so callers do not infer mode from `daemonRuntime` presence. This matters because both background daemon runs and foreground `weacpx run` use daemon metadata/status helpers, but only the background daemon should use best-effort channel startup.

- Foreground policy (`channelStartupPolicy` omitted or `"require-one"`): unchanged. `deps.channels.startAll(...)` rejection escapes and the process exits after cleanup.
- Daemon policy (`channelStartupPolicy: "best-effort"`): if `deps.channels.startAll(...)` rejects, log a daemon-level error and then keep the process alive until the shutdown `AbortSignal` is triggered.

`create-daemon-controller` sets `WEACPX_DAEMON_RUN=1` for the detached `cli run` child. `defaultRun()` maps that environment marker to `channelStartupPolicy: "best-effort"`; direct `weacpx run` remains `"require-one"`.

This turns background daemon channel startup into best-effort without weakening the stricter `MessageChannelRegistry` contract or direct foreground `weacpx run`.

## 5. Implementation shape

Add a small helper in `src/run-console.ts`:

```ts
async function waitForShutdown(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
```

Wrap channel startup in `runConsole()`:

```ts
try {
  await deps.channels.startAll(...);
} catch (error) {
  if (deps.channelStartupPolicy !== "best-effort") throw error;
  await runtime.logger.error(
    "daemon.channels.start_failed",
    "all channels failed to start; daemon remains alive for orchestration IPC",
    { error: error instanceof Error ? error.message : String(error) },
  );
  await waitForShutdown(shutdownController.signal);
}
```

The existing `finally` cleanup path then runs normally after shutdown.

## 6. Alternatives considered

### Add a config flag

A config flag such as `daemon.channelStartupPolicy = "best-effort" | "require-one"` would be flexible, but this use case should work out of the box. The daemon already hosts non-channel services, so best-effort is the safer default for daemon mode.

### Change `MessageChannelRegistry.startAll()`

Changing the registry to never throw would affect foreground mode and tests that assert strict behavior. Keeping the registry strict and adapting only `runConsole()` makes the behavior boundary explicit.

### Disable auto-login in daemon mode

This would avoid the QR wait during daemon startup, but it is a larger UX change. It may be worth doing later, but it is not required to make external MCP usable after login timeout.

## 7. Test plan

- Add a unit test in `tests/unit/run-console.test.ts` where daemon mode channel startup rejects. Assert:
  - `runConsole()` does not resolve immediately.
  - daemon/orchestration startup happened.
  - a structured error was logged.
  - after simulated SIGTERM, cleanup runs and daemon stops.
- Keep existing foreground startup failure test unchanged to prove strict behavior remains.
- Run targeted unit tests and typecheck.
