import { expect, test } from "bun:test";
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
