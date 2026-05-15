import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPerfLogWriter } from "../../../src/perf/perf-log-writer";

test("appends lines through drain and survives concurrent marks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-pfw-"));
  const file = join(dir, "perf.log");
  const writer = createPerfLogWriter({
    filePath: file,
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    onPermanentFailure: () => {},
  });

  for (let i = 0; i < 100; i += 1) {
    writer.enqueue(`line${i}\n`);
  }
  await writer.flush();

  const content = await readFile(file, "utf8");
  const lines = content.trim().split("\n");
  expect(lines.length).toBe(100);
  expect(new Set(lines).size).toBe(100); // no duplicates
  expect(lines[0]).toBe("line0");
  expect(lines[99]).toBe("line99");

  await rm(dir, { recursive: true, force: true });
});

test("rotates before append when threshold reached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-pfw-"));
  const file = join(dir, "perf.log");
  const writer = createPerfLogWriter({
    filePath: file,
    maxSizeBytes: 50,
    maxFiles: 2,
    onPermanentFailure: () => {},
  });

  writer.enqueue("A".repeat(40) + "\n");
  await writer.flush();
  writer.enqueue("B".repeat(40) + "\n");
  await writer.flush();

  const rotated = await readFile(`${file}.1`, "utf8");
  const current = await readFile(file, "utf8");
  expect(rotated.startsWith("A")).toBe(true);
  expect(current.startsWith("B")).toBe(true);

  await rm(dir, { recursive: true, force: true });
});

test("invokes onPermanentFailure after 5 consecutive failures (mkdir fails)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-pfw-"));
  const file = join(dir, "does-not-exist-dir", "perf.log");
  let callCount = 0;
  let lastFailure: { perfLogPath: string; failureCount: number; lastError: string } | undefined;
  const writer = createPerfLogWriter({
    filePath: file,
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    onPermanentFailure: (info) => { callCount += 1; lastFailure = info; },
    mkdirImpl: async () => { throw new Error("EACCES"); },
  });

  for (let i = 0; i < 6; i += 1) {
    writer.enqueue(`line${i}\n`);
    await writer.flush();
  }

  expect(callCount).toBe(1);
  expect(lastFailure?.failureCount).toBe(5);
  expect(lastFailure?.lastError).toContain("EACCES");

  await rm(dir, { recursive: true, force: true });
});

test("resets failure counter after a successful write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-pfw-"));
  const file = join(dir, "perf.log");
  let permanentCalled = 0;
  let fail = true;
  const writer = createPerfLogWriter({
    filePath: file,
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    onPermanentFailure: () => { permanentCalled += 1; },
    appendImpl: async (path, data) => {
      if (fail) throw new Error("EIO");
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, data, "utf8");
    },
  });

  for (let i = 0; i < 3; i += 1) {
    writer.enqueue(`x\n`);
    await writer.flush();
  }
  fail = false;
  writer.enqueue("y\n");
  await writer.flush();
  fail = true;
  for (let i = 0; i < 4; i += 1) {
    writer.enqueue(`x\n`);
    await writer.flush();
  }

  // 3 fails, then 1 success resets to 0, then 4 fails → below 5 threshold, no permanent.
  expect(permanentCalled).toBe(0);

  await rm(dir, { recursive: true, force: true });
});
