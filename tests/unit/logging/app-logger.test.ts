import { expect, test, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAppLogger } from "../../../src/logging/app-logger";
import * as rotatingFileWriter from "../../../src/logging/rotating-file-writer";

test("writes structured log lines at or above the configured level", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 7,
  });

  await logger.debug("command.parsed", "parsed command", { command: "session.shortcut" });
  await logger.info("command.completed", "command finished", { durationMs: 42 });

  const content = await readFile(appLog, "utf8");
  expect(content).toContain("INFO command.completed");
  expect(content).toContain('durationMs=42');
  expect(content).not.toContain("DEBUG command.parsed");

  await rm(dir, { recursive: true, force: true });
});

test("creates the app log file with owner-only permissions", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 7,
  });

  await logger.info("command.completed", "command finished");

  const { mode } = await stat(appLog);
  expect(mode & 0o777).toBe(0o600);

  await rm(dir, { recursive: true, force: true });
});

test("hardens a pre-existing world-readable log file to 0600 on first write", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-"));
  const appLog = join(dir, "app.log");
  await writeFile(appLog, "pre-existing line\n");
  await chmod(appLog, 0o644);

  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    retentionDays: 7,
  });
  await logger.info("command.completed", "command finished");

  expect((await stat(appLog)).mode & 0o777).toBe(0o600);

  await rm(dir, { recursive: true, force: true });
});

test("rotates app log files when max size is exceeded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "debug",
    maxSizeBytes: 80,
    maxFiles: 3,
    retentionDays: 7,
  });

  await logger.info("command.one", "first message that should fill the file", {
    alias: "weacpx:codex",
  });
  await logger.info("command.two", "second message that should trigger rotation", {
    alias: "weacpx:claude",
  });

  const currentContent = await readFile(appLog, "utf8");
  const rotatedContent = await readFile(`${appLog}.1`, "utf8");
  expect(currentContent).toContain("command.two");
  expect(rotatedContent).toContain("command.one");

  await rm(dir, { recursive: true, force: true });
});

test("cleans expired rotated logs while keeping fresh files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-"));
  const appLog = join(dir, "app.log");
  const staleLog = `${appLog}.3`;
  const freshLog = `${appLog}.1`;
  await writeFile(staleLog, "stale");
  await writeFile(freshLog, "fresh");

  const now = new Date("2026-03-27T00:00:00.000Z");
  const staleAt = new Date("2026-03-20T00:00:00.000Z");
  const freshAt = new Date("2026-03-26T00:00:00.000Z");
  await utimes(staleLog, staleAt, staleAt);
  await utimes(freshLog, freshAt, freshAt);

  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 3,
    now: () => now,
  });

  await logger.cleanup();

  await expect(stat(freshLog)).resolves.toBeDefined();
  await expect(stat(staleLog)).rejects.toThrow();

  await rm(dir, { recursive: true, force: true });
});

// --- Bug A: write failures must not reject logger public methods ---

test("logger.info resolves (does not reject) when appendFile rejects", async () => {
  const fsPromises = await import("node:fs/promises");
  const appendFileSpy = spyOn(fsPromises, "appendFile").mockRejectedValueOnce(
    new Error("ENOSPC: no space left on device"),
  );

  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-mock-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 7,
  });

  let threw = false;
  try {
    await logger.info("test.event", "should not throw even when disk full");
  } catch {
    threw = true;
  }
  expect(threw).toBe(false);

  appendFileSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

test("logger emits a one-time console.error note on write failure, not per-call spam", async () => {
  // Set up temp dir BEFORE mocking so fs operations for dir creation succeed.
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-once-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 7,
  });

  // Now activate mocks — only affects calls made during logger.info invocations.
  const fsPromises = await import("node:fs/promises");
  const appendFileSpy = spyOn(fsPromises, "appendFile").mockRejectedValue(
    new Error("ENOSPC: no space left on device"),
  );
  const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

  // Call 5 times — should only emit one console.error
  for (let i = 0; i < 5; i++) {
    await logger.info("test.event", "repeated failure");
  }

  expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

  appendFileSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

test("logger.cleanup() resolves even when cleanupExpiredRotatedLogs throws", async () => {
  const cleanupSpy = spyOn(rotatingFileWriter, "cleanupExpiredRotatedLogs").mockRejectedValueOnce(
    new Error("EACCES: permission denied"),
  );

  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-logger-cleanup-"));
  const appLog = join(dir, "app.log");
  const logger = createAppLogger({
    filePath: appLog,
    level: "info",
    maxSizeBytes: 1024,
    maxFiles: 3,
    retentionDays: 7,
  });

  let threw = false;
  try {
    await logger.cleanup();
  } catch {
    threw = true;
  }
  expect(threw).toBe(false);

  cleanupSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});
