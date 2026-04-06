import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWeixinConsumerLock } from "../../../src/weixin/monitor/consumer-lock";

test("rejects when an active consumer lock already exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-consumer-lock-"));
  const lockFilePath = join(dir, "weixin-consumer.lock.json");
  await writeFile(lockFilePath, JSON.stringify({
    pid: 123,
    mode: "foreground",
    startedAt: "2026-04-05T00:00:00.000Z",
    configPath: "/cfg",
    statePath: "/state",
  }));

  const lock = createWeixinConsumerLock({
    lockFilePath,
    isProcessRunning: (pid) => pid === 123,
  });

  try {
    await lock.acquire({
      pid: 456,
      mode: "daemon",
      startedAt: "2026-04-05T00:01:00.000Z",
      configPath: "/cfg2",
      statePath: "/state2",
    });
    throw new Error("expected acquire to fail");
  } catch (error) {
    expect((error as Error).message).toContain("weacpx Weixin consumer is already running.");
    expect((error as Error).message).toContain("pid: 123");
    expect((error as Error).message).toContain("mode: foreground");
    expect((error as Error).message).toContain(
      "Try stopping the existing instance or close the foreground `weacpx run` process before starting a new one.",
    );
  }
});

test("replaces a stale consumer lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-consumer-lock-"));
  const lockFilePath = join(dir, "weixin-consumer.lock.json");
  await writeFile(lockFilePath, JSON.stringify({
    pid: 123,
    mode: "foreground",
    startedAt: "2026-04-05T00:00:00.000Z",
    configPath: "/cfg",
    statePath: "/state",
  }));

  const lock = createWeixinConsumerLock({
    lockFilePath,
    isProcessRunning: () => false,
  });

  await lock.acquire({
    pid: 456,
    mode: "daemon",
    startedAt: "2026-04-05T00:01:00.000Z",
    configPath: "/cfg2",
    statePath: "/state2",
  });

  const stored = JSON.parse(await readFile(lockFilePath, "utf8")) as { pid: number; mode: string };
  expect(stored).toEqual(expect.objectContaining({ pid: 456, mode: "daemon" }));
});

test("emits diagnostics when it replaces a stale lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-consumer-lock-"));
  const lockFilePath = join(dir, "weixin-consumer.lock.json");
  const diagnostics: string[] = [];
  await writeFile(lockFilePath, JSON.stringify({
    pid: 123,
    mode: "foreground",
    startedAt: "2026-04-05T00:00:00.000Z",
    configPath: "/cfg",
    statePath: "/state",
  }));

  const lock = createWeixinConsumerLock({
    lockFilePath,
    isProcessRunning: () => false,
    onDiagnostic: async (event, context) => {
      diagnostics.push(`${event}:${JSON.stringify(context)}`);
    },
  });

  await lock.acquire({
    pid: 456,
    mode: "daemon",
    startedAt: "2026-04-05T00:01:00.000Z",
    configPath: "/cfg2",
    statePath: "/state2",
  });

  expect(diagnostics.some((line) => line.includes("lock_exists"))).toBe(true);
  expect(diagnostics.some((line) => line.includes("lock_stale_removed"))).toBe(true);
  expect(diagnostics.some((line) => line.includes("\"reason\":\"owner_process_not_running\""))).toBe(true);
  expect(diagnostics.some((line) => line.includes("lock_acquired"))).toBe(true);
});
