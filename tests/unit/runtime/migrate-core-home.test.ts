import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateCoreHome } from "../../../src/runtime/migrate-core-home";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "xacpx-migrate-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const logs: string[] = [];
const captureLog = (m: string) => { logs.push(m); };

test("fresh install (no legacy) is a no-op", () => {
  logs.length = 0;
  const result = migrateCoreHome(home, { log: captureLog });
  expect(result.reason).toBe("no-legacy");
  expect(result.migrated).toBe(false);
  expect(existsSync(join(home, ".xacpx"))).toBe(false);
});

test("legacy ~/.weacpx is copied to ~/.xacpx when no daemon is running", () => {
  logs.length = 0;
  const legacy = join(home, ".weacpx");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "config.json"), '{"transport":{}}');
  mkdirSync(join(legacy, "runtime"), { recursive: true });

  const result = migrateCoreHome(home, { log: captureLog, isProcessAlive: () => false });
  expect(result.reason).toBe("copied");
  expect(result.migrated).toBe(true);
  // copied to new dir
  expect(readFileSync(join(home, ".xacpx", "config.json"), "utf8")).toContain("transport");
  // legacy kept as backup
  expect(existsSync(join(home, ".weacpx", "config.json"))).toBe(true);
});

test("migration is skipped when a legacy daemon is still alive", () => {
  logs.length = 0;
  const legacy = join(home, ".weacpx");
  mkdirSync(join(legacy, "runtime"), { recursive: true });
  writeFileSync(join(legacy, "runtime", "daemon.pid"), "4242");

  const result = migrateCoreHome(home, { log: captureLog, isProcessAlive: (pid) => pid === 4242 });
  expect(result.reason).toBe("daemon-running");
  expect(result.migrated).toBe(false);
  expect(existsSync(join(home, ".xacpx"))).toBe(false);
  expect(logs.join("\n")).toContain("4242");
});

test("already-migrated (~/.xacpx exists) is a no-op even with legacy present", () => {
  logs.length = 0;
  mkdirSync(join(home, ".xacpx"), { recursive: true });
  mkdirSync(join(home, ".weacpx"), { recursive: true });

  const result = migrateCoreHome(home, { log: captureLog });
  expect(result.reason).toBe("already-current");
  expect(result.migrated).toBe(false);
});
