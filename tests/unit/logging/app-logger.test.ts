import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAppLogger } from "../../../src/logging/app-logger";

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
