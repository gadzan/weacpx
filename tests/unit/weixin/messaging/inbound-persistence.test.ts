import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  clearContextTokensForAccount,
  findAccountIdsByContextToken,
  getContextToken,
  restoreContextTokens,
  setContextToken,
} from "../../../../src/weixin/messaging/inbound";

/**
 * NOTE (deviation from plan): the plan was written assuming vitest with
 * `vi.mock` + `vi.resetModules()`. This repo uses `bun:test` and has no vitest
 * installed (see scripts/run-tests-lib.mjs → `bun test ...`). We achieve the
 * same intent by:
 *  - Redirecting `resolveStateDir()` via the OPENCLAW_STATE_DIR env var
 *    (state-dir.ts honors it).
 *  - Using a fresh `accountId` per test case so the module-level
 *    `contextTokenStore` Map does not leak across cases (no need to reset
 *    the module). "Daemon restart" is simulated by `clearContextTokensForAccount`
 *    against a *different* account than the one we restore from disk
 *    (impossible since clear wipes disk too) — so instead we write the
 *    persistence file via `setContextToken`, then drop the in-memory entries
 *    by writing the file *directly* and calling `restoreContextTokens` on
 *    a brand-new account id whose in-memory cache is empty.
 */

let prevStateDir: string | undefined;
let stateDir: string;

beforeEach(() => {
  prevStateDir = process.env.OPENCLAW_STATE_DIR;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weacpx-ctx-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  if (prevStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = prevStateDir;
  try {
    fs.rmSync(stateDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function tokenFilePath(accountId: string): string {
  return path.join(stateDir, "openclaw-weixin", "accounts", `${accountId}.context-tokens.json`);
}

describe("contextToken disk persistence", () => {
  it("setContextToken writes to disk and restoreContextTokens reads it back", () => {
    setContextToken("acct-A1", "user-1", "tok-111");
    setContextToken("acct-A1", "user-2", "tok-222");

    // Verify file was written.
    const filePath = tokenFilePath("acct-A1");
    expect(fs.existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, string>;
    expect(onDisk).toEqual({ "user-1": "tok-111", "user-2": "tok-222" });

    // Simulate daemon restart: use a *new* account id whose in-memory map is
    // empty, but seed disk with the same tokens we expect to see restored.
    const restoredId = "acct-A1-restart";
    const restorePath = tokenFilePath(restoredId);
    fs.mkdirSync(path.dirname(restorePath), { recursive: true });
    fs.writeFileSync(restorePath, JSON.stringify({ "user-1": "tok-111", "user-2": "tok-222" }));

    expect(getContextToken(restoredId, "user-1")).toBeUndefined();
    restoreContextTokens(restoredId);
    expect(getContextToken(restoredId, "user-1")).toBe("tok-111");
    expect(getContextToken(restoredId, "user-2")).toBe("tok-222");
  });

  it("setContextToken writes the persistence file with owner-only permissions", () => {
    if (process.platform === "win32") return;
    setContextToken("acct-perm", "user-1", "tok-perm");
    expect(fs.statSync(tokenFilePath("acct-perm")).mode & 0o777).toBe(0o600);
  });

  it("clearContextTokensForAccount removes memory + disk entries", () => {
    setContextToken("acct-B1", "user-1", "tok-xyz");
    expect(getContextToken("acct-B1", "user-1")).toBe("tok-xyz");
    expect(fs.existsSync(tokenFilePath("acct-B1"))).toBe(true);

    clearContextTokensForAccount("acct-B1");
    expect(getContextToken("acct-B1", "user-1")).toBeUndefined();
    expect(fs.existsSync(tokenFilePath("acct-B1"))).toBe(false);

    // Even on a brand-new restart, restore from the (now-missing) disk file
    // must not resurrect anything.
    restoreContextTokens("acct-B1");
    expect(getContextToken("acct-B1", "user-1")).toBeUndefined();
  });

  it("findAccountIdsByContextToken returns accounts that have an active token for user", () => {
    setContextToken("acct-C1", "user-1", "tA");
    setContextToken("acct-C2", "user-1", "tB");
    setContextToken("acct-C2", "user-2", "tB2");

    expect(findAccountIdsByContextToken(["acct-C1", "acct-C2"], "user-1")).toEqual([
      "acct-C1",
      "acct-C2",
    ]);
    expect(findAccountIdsByContextToken(["acct-C1", "acct-C2"], "user-2")).toEqual(["acct-C2"]);
  });

  it("findAccountIdsByContextToken normalizes chat-key prefixed user ids", () => {
    setContextToken("acct-D1", "user-1", "tok-norm");
    // Chat-key form: `weixin:acct-D1:user-1` should resolve back to user-1.
    expect(findAccountIdsByContextToken(["acct-D1"], "weixin:acct-D1:user-1")).toEqual([
      "acct-D1",
    ]);
  });
});
