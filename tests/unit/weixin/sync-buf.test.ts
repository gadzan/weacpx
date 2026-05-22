import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, test } from "bun:test";

import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../../../src/weixin/storage/sync-buf";

let prevStateDir: string | undefined;
let stateDir: string;

beforeEach(() => {
  prevStateDir = process.env.OPENCLAW_STATE_DIR;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weacpx-syncbuf-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  if (prevStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = prevStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("saveGetUpdatesBuf round-trips and writes the file with owner-only permissions", () => {
  const filePath = getSyncBufFilePath("acct-sync");
  saveGetUpdatesBuf(filePath, "cursor-123");

  expect(loadGetUpdatesBuf(filePath)).toBe("cursor-123");
  if (process.platform !== "win32") {
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  }
});
