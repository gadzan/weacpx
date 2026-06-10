import { expect, test, spyOn } from "bun:test";
import { appendFile, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { rotateIfNeeded, cleanupExpiredRotatedLogs } from "../../../src/logging/rotating-file-writer";

test("rotateIfNeeded renames .log → .log.1 when threshold exceeded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-rfw-"));
  const file = join(dir, "test.log");
  await appendFile(file, "X".repeat(1000), "utf8");

  await rotateIfNeeded(file, 100, 1024, 3);

  const files = await readdir(dir);
  expect(files.sort()).toEqual(["test.log.1"]);

  await rm(dir, { recursive: true, force: true });
});

test("rotateIfNeeded is a no-op when under threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-rfw-"));
  const file = join(dir, "test.log");
  await appendFile(file, "X".repeat(100), "utf8");

  await rotateIfNeeded(file, 50, 1024, 3);

  const files = await readdir(dir);
  expect(files).toEqual(["test.log"]);

  await rm(dir, { recursive: true, force: true });
});

test("cleanupExpiredRotatedLogs deletes rotated files older than retentionDays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-rfw-"));
  const expired = join(dir, "test.log.2");
  const fresh = join(dir, "test.log.1");
  await writeFile(expired, "expired");
  await writeFile(fresh, "fresh");

  const now = new Date("2026-05-15T00:00:00Z");
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { utimes } = await import("node:fs/promises");
  await utimes(expired, eightDaysAgo, eightDaysAgo);
  await utimes(fresh, oneDayAgo, oneDayAgo);

  await cleanupExpiredRotatedLogs(join(dir, "test.log"), 7, () => now);

  const files = await readdir(dir);
  expect(files).toEqual(["test.log.1"]);

  await rm(dir, { recursive: true, force: true });
});

// --- Bug B: candidate disappearing between readdir and stat must not reject ---

test("cleanupExpiredRotatedLogs tolerates ENOENT from stat mid-iteration and still processes other candidates", async () => {
  // Simulates the race where a rotated file is removed between readdir and stat
  // (concurrent cleanup in another process, manual deletion). Both candidates
  // exist on disk so readdir lists them; the spy then makes stat throw ENOENT
  // for candidate1 only. Cleanup must skip it without rejecting and continue
  // on to delete the stale candidate2.
  const dir = await mkdtemp(join(tmpdir(), "weacpx-rfw-race-"));
  const logFile = join(dir, "test.log");
  const candidate1 = join(dir, "test.log.1");
  const candidate2 = join(dir, "test.log.2");
  await writeFile(candidate1, "stale-1");
  await writeFile(candidate2, "stale-2");

  const now = new Date("2026-05-15T00:00:00Z");
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const { utimes } = await import("node:fs/promises");
  await utimes(candidate1, eightDaysAgo, eightDaysAgo);
  await utimes(candidate2, eightDaysAgo, eightDaysAgo);

  const fsPromises = await import("node:fs/promises");
  // Capture the real stat BEFORE spying — the mock must call through to the
  // original, not the spied binding (that would recurse infinitely).
  const realStat = fsPromises.stat;
  const statSpy = spyOn(fsPromises, "stat").mockImplementation(((
    path: Parameters<typeof realStat>[0],
    ...args: unknown[]
  ) => {
    if (typeof path === "string" && path === candidate1) {
      return Promise.reject(
        Object.assign(new Error("ENOENT: no such file or directory (simulated race)"), {
          code: "ENOENT",
        }),
      );
    }
    return (realStat as (...a: unknown[]) => Promise<unknown>)(path, ...args);
  }) as typeof realStat);

  let threw = false;
  try {
    await cleanupExpiredRotatedLogs(logFile, 7, () => now);
  } catch {
    threw = true;
  }
  statSpy.mockRestore();

  expect(threw).toBe(false);
  const files = await readdir(dir);
  // candidate1 was skipped (stat "raced") so it remains on disk untouched.
  expect(files).toContain("test.log.1");
  // candidate2 was stale and statted fine — it must still have been deleted.
  expect(files).not.toContain("test.log.2");

  await rm(dir, { recursive: true, force: true });
});
