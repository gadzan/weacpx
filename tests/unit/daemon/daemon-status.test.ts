import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DaemonStatusStore, type DaemonStatus } from "../../../src/daemon/daemon-status";

test("returns null when the daemon status file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-status-"));
  const store = new DaemonStatusStore(join(dir, "status.json"));

  await expect(store.load()).resolves.toBeNull();

  await rm(dir, { recursive: true, force: true });
});

test("persists and reloads daemon status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-status-"));
  const store = new DaemonStatusStore(join(dir, "status.json"));
  const status: DaemonStatus = {
    pid: 12345,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:01:00.000Z",
    config_path: "/Users/tester/.weacpx/config.json",
    state_path: "/Users/tester/.weacpx/state.json",
    app_log: "/Users/tester/.weacpx/runtime/app.log",
    stdout_log: "/Users/tester/.weacpx/runtime/stdout.log",
    stderr_log: "/Users/tester/.weacpx/runtime/stderr.log",
  };

  await store.save(status);
  await expect(store.load()).resolves.toEqual(status);

  await rm(dir, { recursive: true, force: true });
});

test("clears the daemon status file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-status-"));
  const store = new DaemonStatusStore(join(dir, "status.json"));

  await store.save({
    pid: 12345,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:01:00.000Z",
    config_path: "/Users/tester/.weacpx/config.json",
    state_path: "/Users/tester/.weacpx/state.json",
    app_log: "/Users/tester/.weacpx/runtime/app.log",
    stdout_log: "/Users/tester/.weacpx/runtime/stdout.log",
    stderr_log: "/Users/tester/.weacpx/runtime/stderr.log",
  });

  await store.clear();
  await expect(store.load()).resolves.toBeNull();

  await rm(dir, { recursive: true, force: true });
});
