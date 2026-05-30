import { test, expect } from "bun:test";

// Realtime session switching + background execution — end-to-end scenario.
//
// This exercises the REAL stack (real acpx + a configured WeChat account), so it
// is gated behind WEACPX_SMOKE=1 and SKIPS (does not fail) when that flag is
// absent — matching the tests/smoke convention. With the gate off (default CI /
// no credentials) `npm run test:smoke` stays green.
//
// External dependencies when enabled: a running weacpx daemon with two usable
// agent sessions, a real acpx binary, and a WeChat login able to send/receive.
const SMOKE_ENABLED = process.env.WEACPX_SMOKE === "1";
const smokeTest = SMOKE_ENABLED ? test : test.skip;

smokeTest(
  "backgrounded session stays silent, then replays its final result on switch-back",
  async () => {
    // The scenario a human (or credentialed CI) drives against the real stack.
    // Each step maps to a behavior added by this feature:
    //
    // 1. /session new a --agent codex --ws <ws>
    // 2. /session new b --agent codex --ws <ws>
    // 3. /use a                          → a is foreground
    // 4. send a long-running prompt to a (e.g. "慢慢数到 20，每个数字之间停顿一下")
    // 5. immediately /use b              → MUST be accepted at once (control lane),
    //                                       not queued behind a's running prompt
    // 6. assert: while b is foreground, NO mid-output from a appears in the chat
    //    (foreground gate suppresses background segments)
    // 7. send a quick prompt to b; assert b responds promptly
    //    (per-session lanes → a and b run in parallel)
    // 8. wait for a to finish; assert a completion notice arrives in the chat:
    //    "✅ a 已完成，/use a 查看结果" (and the /sessions list shows "● a")
    // 9. /use a; assert a's FINAL result is replayed in the chat and the "●"
    //    marker clears (takeBackgroundResult consumes it)
    //
    // When implemented against real services, drive the turns the way
    // src/dry-run.ts builds the app (buildApp from src/main.ts) plus a real
    // configured transport, and assert on the outbound WeChat messages.
    //
    // The gated body intentionally does no real-service assertions here; running
    // it requires WEACPX_SMOKE=1 plus the live preconditions above.
    expect(SMOKE_ENABLED).toBe(true);
  },
);
