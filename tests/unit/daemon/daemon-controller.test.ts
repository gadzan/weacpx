import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DaemonController } from "../../../src/daemon/daemon-controller";
import { type DaemonPaths } from "../../../src/daemon/daemon-files";
import { DaemonStatusStore } from "../../../src/daemon/daemon-status";

test("reports stopped when no pid or status files exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  const controller = createController(dir);

  await expect(controller.getStatus()).resolves.toEqual({
    state: "stopped",
  });

  await rm(dir, { recursive: true, force: true });
});

test("reports running when pid is alive and status exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  const controller = createController(dir, {
    isProcessRunning: (pid) => pid === 12345,
  });
  await writeFile(join(dir, "daemon.pid"), "12345\n");
  await new DaemonStatusStore(join(dir, "status.json")).save({
    pid: 12345,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:01:00.000Z",
    config_path: "/cfg",
    state_path: "/state",
    app_log: "/app",
    stdout_log: "/out",
    stderr_log: "/err",
  });

  await expect(controller.getStatus()).resolves.toMatchObject({
    state: "running",
    pid: 12345,
    status: {
      config_path: "/cfg",
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("treats dead pid files as stale and clears runtime files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  const controller = createController(dir, {
    isProcessRunning: () => false,
  });
  await writeFile(join(dir, "daemon.pid"), "12345\n");
  await new DaemonStatusStore(join(dir, "status.json")).save({
    pid: 12345,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:01:00.000Z",
    config_path: "/cfg",
    state_path: "/state",
    app_log: "/app",
    stdout_log: "/out",
    stderr_log: "/err",
  });

  await expect(controller.getStatus()).resolves.toEqual({
    state: "stopped",
    stale: true,
  });

  await expect(Bun.file(join(dir, "daemon.pid")).exists()).resolves.toBe(false);
  await expect(Bun.file(join(dir, "status.json")).exists()).resolves.toBe(false);

  await rm(dir, { recursive: true, force: true });
});

test("start reports already running without spawning again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  let spawned = false;
  const controller = createController(dir, {
    isProcessRunning: (pid) => pid === 22222,
    spawnDetached: async () => {
      spawned = true;
      return 33333;
    },
  });
  await writeFile(join(dir, "daemon.pid"), "22222\n");
  await new DaemonStatusStore(join(dir, "status.json")).save({
    pid: 22222,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:01:00.000Z",
    config_path: "/cfg",
    state_path: "/state",
    app_log: "/app",
    stdout_log: "/out",
    stderr_log: "/err",
  });

  await expect(controller.start()).resolves.toEqual({
    state: "already-running",
    pid: 22222,
  });
  expect(spawned).toBe(false);

  await rm(dir, { recursive: true, force: true });
});

test("start waits for daemon status metadata before returning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  const statusStore = new DaemonStatusStore(join(dir, "status.json"));
  let checks = 0;

  const controller = createController(dir, {
    isProcessRunning: (pid) => pid === 44444,
    spawnDetached: async () => {
      setTimeout(() => {
        void statusStore.save({
          pid: 44444,
          started_at: "2026-03-26T00:00:00.000Z",
          heartbeat_at: "2026-03-26T00:01:00.000Z",
          config_path: "/cfg",
          state_path: "/state",
          app_log: "/app",
          stdout_log: "/out",
          stderr_log: "/err",
        });
      }, 20);
      return 44444;
    },
    startupPollIntervalMs: 5,
    startupTimeoutMs: 200,
    onStartupPoll: async () => {
      checks += 1;
    },
  });

  await expect(controller.start()).resolves.toEqual({
    state: "started",
    pid: 44444,
  });
  expect(checks).toBeGreaterThan(0);
  await expect(statusStore.load()).resolves.toMatchObject({ pid: 44444 });

  await rm(dir, { recursive: true, force: true });
});

test("stop handles missing pid file gracefully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-controller-"));
  const controller = createController(dir);

  await expect(controller.stop()).resolves.toEqual({
    state: "stopped",
    detail: "not-running",
  });

  await rm(dir, { recursive: true, force: true });
});

function createController(
  runtimeDir: string,
  overrides: Partial<ControllerDeps> = {},
) {
  const paths: DaemonPaths = {
    runtimeDir,
    pidFile: join(runtimeDir, "daemon.pid"),
    statusFile: join(runtimeDir, "status.json"),
    appLog: join(runtimeDir, "app.log"),
    stdoutLog: join(runtimeDir, "stdout.log"),
    stderrLog: join(runtimeDir, "stderr.log"),
  };

  return new DaemonController(paths, {
    isProcessRunning: overrides.isProcessRunning ?? (() => false),
    spawnDetached: overrides.spawnDetached ?? (async () => 99999),
    terminateProcess: overrides.terminateProcess ?? (async () => {}),
    startupPollIntervalMs: overrides.startupPollIntervalMs ?? 1,
    startupTimeoutMs: overrides.startupTimeoutMs ?? 50,
    onStartupPoll: overrides.onStartupPoll ?? (async () => {}),
  });
}

interface ControllerDeps {
  isProcessRunning: (pid: number) => boolean;
  spawnDetached: () => Promise<number>;
  terminateProcess: (pid: number) => Promise<void>;
  startupPollIntervalMs: number;
  startupTimeoutMs: number;
  onStartupPoll: () => Promise<void>;
}
