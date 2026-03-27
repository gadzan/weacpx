import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { type DaemonPaths } from "../../../src/daemon/daemon-files";
import { DaemonRuntime } from "../../../src/daemon/daemon-runtime";
import { DaemonStatusStore } from "../../../src/daemon/daemon-status";

test("writes startup status and pid metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-runtime-"));
  const paths = createPaths(dir);
  const runtime = new DaemonRuntime(paths, {
    pid: 4242,
    now: () => "2026-03-26T00:00:00.000Z",
  });

  await runtime.start({
    configPath: "/cfg",
    statePath: "/state",
  });

  await expect(Bun.file(paths.pidFile).text()).resolves.toBe("4242\n");
  await expect(new DaemonStatusStore(paths.statusFile).load()).resolves.toEqual({
    pid: 4242,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:00:00.000Z",
    config_path: "/cfg",
    state_path: "/state",
    app_log: paths.appLog,
    stdout_log: paths.stdoutLog,
    stderr_log: paths.stderrLog,
  });

  await rm(dir, { recursive: true, force: true });
});

test("updates the heartbeat timestamp without changing startup metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-runtime-"));
  const paths = createPaths(dir);
  let now = "2026-03-26T00:00:00.000Z";
  const runtime = new DaemonRuntime(paths, {
    pid: 4242,
    now: () => now,
  });

  await runtime.start({
    configPath: "/cfg",
    statePath: "/state",
  });

  now = "2026-03-26T00:05:00.000Z";
  await runtime.heartbeat();

  await expect(new DaemonStatusStore(paths.statusFile).load()).resolves.toEqual({
    pid: 4242,
    started_at: "2026-03-26T00:00:00.000Z",
    heartbeat_at: "2026-03-26T00:05:00.000Z",
    config_path: "/cfg",
    state_path: "/state",
    app_log: paths.appLog,
    stdout_log: paths.stdoutLog,
    stderr_log: paths.stderrLog,
  });

  await rm(dir, { recursive: true, force: true });
});

test("clears runtime metadata on stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-daemon-runtime-"));
  const paths = createPaths(dir);
  const runtime = new DaemonRuntime(paths, {
    pid: 4242,
    now: () => "2026-03-26T00:00:00.000Z",
  });

  await runtime.start({
    configPath: "/cfg",
    statePath: "/state",
  });
  await runtime.stop();

  await expect(Bun.file(paths.pidFile).exists()).resolves.toBe(false);
  await expect(new DaemonStatusStore(paths.statusFile).load()).resolves.toBeNull();

  await rm(dir, { recursive: true, force: true });
});

function createPaths(runtimeDir: string): DaemonPaths {
  return {
    runtimeDir,
    pidFile: join(runtimeDir, "daemon.pid"),
    statusFile: join(runtimeDir, "status.json"),
    appLog: join(runtimeDir, "app.log"),
    stdoutLog: join(runtimeDir, "stdout.log"),
    stderrLog: join(runtimeDir, "stderr.log"),
  };
}
