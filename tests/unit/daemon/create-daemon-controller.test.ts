import { expect, test } from "bun:test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDaemonController,
  terminateProcessTree,
} from "../../../src/daemon/create-daemon-controller";
import { type DaemonPaths } from "../../../src/daemon/daemon-files";

test("spawns a detached run command and records the child pid", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "weacpx-daemon-factory-"));
  const paths = createPaths(runtimeDir);
  const spawnCalls: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
  }> = [];

  const controller = createDaemonController(paths, {
    processExecPath: "/usr/local/bin/node",
    cliEntryPath: "/app/dist/cli.js",
    cwd: "/app",
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    platform: "linux",
    spawnProcess: ({ command, args, options }) => {
      spawnCalls.push({ command, args, options });
      return Promise.resolve(43210);
    },
    isProcessRunning: () => false,
    terminateProcess: async () => {},
  });

  await expect(controller.start()).resolves.toEqual({
    state: "started",
    pid: 43210,
  });

  expect(spawnCalls).toEqual([
    {
      command: "/usr/local/bin/node",
      args: ["/app/dist/cli.js", "run"],
      options: expect.objectContaining({
        cwd: "/app",
        detached: true,
        env: { HOME: "/home/test", PATH: "/usr/bin" },
      }),
    },
  ]);
  await expect(readFile(paths.pidFile, "utf8")).resolves.toBe("43210\n");

  await rm(runtimeDir, { recursive: true, force: true });
});

test("appends daemon stdout and stderr to runtime log files", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "weacpx-daemon-factory-"));
  const paths = createPaths(runtimeDir);
  let stdoutFd = -1;
  let stderrFd = -1;

  const controller = createDaemonController(paths, {
    processExecPath: "/usr/local/bin/node",
    cliEntryPath: "/app/dist/cli.js",
    cwd: "/app",
    env: {},
    platform: "linux",
    spawnProcess: async ({ options }) => {
      const stdio = options.stdio as unknown[];
      stdoutFd = Number(stdio[1]);
      stderrFd = Number(stdio[2]);
      return 54321;
    },
    isProcessRunning: () => false,
    terminateProcess: async () => {},
  });

  await controller.start();

  expect(stdoutFd).toBeGreaterThan(0);
  expect(stderrFd).toBeGreaterThan(0);

  const stdoutHandle = await open(paths.stdoutLog, "a");
  const stderrHandle = await open(paths.stderrLog, "a");
  await stdoutHandle.close();
  await stderrHandle.close();

  await rm(runtimeDir, { recursive: true, force: true });
});

test("uses a hidden powershell launcher when spawning the daemon on win32", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "weacpx-daemon-factory-"));
  const paths = createPaths(runtimeDir);
  const spawnCalls: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
  }> = [];

  const controller = createDaemonController(paths, {
    processExecPath: "C:\\node\\node.exe",
    cliEntryPath: "C:\\app\\dist\\cli.js",
    cwd: "C:\\app",
    env: {},
    platform: "win32",
    spawnProcess: async ({ command, args, options }) => {
      spawnCalls.push({ command, args, options });
      return 65432;
    },
    isProcessRunning: () => false,
    terminateProcess: async () => {},
  });

  await controller.start();

  expect(spawnCalls).toEqual([
    {
      command: "powershell.exe",
      args: expect.arrayContaining(["-NoProfile", "-NonInteractive", "-EncodedCommand"]),
      options: expect.objectContaining({
        windowsHide: true,
        env: expect.objectContaining({
          WEACPX_DAEMON_COMMAND: "C:\\node\\node.exe",
          WEACPX_DAEMON_ARG0: "C:\\app\\dist\\cli.js",
          WEACPX_DAEMON_ARG1: "run",
          WEACPX_DAEMON_STDOUT: paths.stdoutLog,
          WEACPX_DAEMON_STDERR: paths.stderrLog,
        }),
      }),
    },
  ]);

  await rm(runtimeDir, { recursive: true, force: true });
});

test("returns as soon as the hidden windows launcher prints a pid", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "weacpx-daemon-factory-"));
  const paths = createPaths(runtimeDir);
  let capturedCommand = "";

  const controller = createDaemonController(paths, {
    processExecPath: "C:\\node\\node.exe",
    cliEntryPath: "C:\\app\\dist\\cli.js",
    cwd: "C:\\app",
    env: {},
    platform: "win32",
    spawnProcess: async ({ command }) => {
      capturedCommand = command;
      return await new Promise<number>((resolve) => {
        setTimeout(() => resolve(76543), 10);
      });
    },
    isProcessRunning: () => false,
    terminateProcess: async () => {},
  });

  await expect(controller.start()).resolves.toEqual({
    state: "started",
    pid: 76543,
  });
  expect(capturedCommand).toBe("powershell.exe");

  await rm(runtimeDir, { recursive: true, force: true });
});

test("terminates the full process tree on win32", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  await terminateProcessTree(43210, "win32", async (command, args) => {
    calls.push({ command, args });
    return 0;
  });

  expect(calls).toEqual([
    {
      command: "taskkill",
      args: ["/PID", "43210", "/T", "/F"],
    },
  ]);
});

function createPaths(runtimeDir: string): DaemonPaths {
  return {
    runtimeDir,
    pidFile: join(runtimeDir, "daemon.pid"),
    statusFile: join(runtimeDir, "status.json"),
    stdoutLog: join(runtimeDir, "stdout.log"),
    stderrLog: join(runtimeDir, "stderr.log"),
  };
}
