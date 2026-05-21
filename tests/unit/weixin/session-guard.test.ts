import { describe, expect, test } from "bun:test";
import { pauseSession, isSessionPaused, resetSessionPause, _resetForTest } from "../../../src/weixin/api/session-guard";

describe("session-guard: resetSessionPause", () => {
  test("resetSessionPause clears the pause for the given account", () => {
    _resetForTest();
    pauseSession("acct-a");
    expect(isSessionPaused("acct-a")).toBe(true);

    resetSessionPause("acct-a");
    expect(isSessionPaused("acct-a")).toBe(false);
  });

  test("resetSessionPause for a non-paused account is a no-op", () => {
    _resetForTest();
    expect(isSessionPaused("acct-b")).toBe(false);

    resetSessionPause("acct-b");
    expect(isSessionPaused("acct-b")).toBe(false);
  });

  test("resetSessionPause only clears the specified account, not others", () => {
    _resetForTest();
    pauseSession("acct-a");
    pauseSession("acct-b");
    expect(isSessionPaused("acct-a")).toBe(true);
    expect(isSessionPaused("acct-b")).toBe(true);

    resetSessionPause("acct-a");
    expect(isSessionPaused("acct-a")).toBe(false);
    expect(isSessionPaused("acct-b")).toBe(true);
  });
});
