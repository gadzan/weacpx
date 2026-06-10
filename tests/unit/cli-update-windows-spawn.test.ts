// Pins the Windows spawn behavior of `xacpx update`: npm/bun resolve to .cmd
// shims on win32, and since Node's batch-file security change spawning them
// without `shell: true` fails (EINVAL/ENOENT). These tests mock
// node:child_process and assert on the options runCapture/runInherit pass to
// spawn. This file must run in isolation (bun test <this file>) because it
// mocks a builtin module.
import { expect, test, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

interface RecordedSpawn {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

const spawnCalls: RecordedSpawn[] = [];
let nextStdout = "";

mock.module("node:child_process", () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(() => {
      child.stdout.end(nextStdout);
      child.emit("exit", 0);
      child.emit("close", 0);
    }, 0);
    return child;
  },
}));

const { getLatestNpmVersion, handleUpdateCli } = await import("../../src/cli-update");

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

test("runCapture spawns npm with shell: true on win32", async () => {
  spawnCalls.length = 0;
  nextStdout = '"1.2.3"';

  const version = await withPlatform("win32", async () => await getLatestNpmVersion("xacpx"));

  expect(version).toBe("1.2.3");
  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]!.command).toBe("npm");
  expect(spawnCalls[0]!.args).toEqual(["view", "xacpx", "version", "--json"]);
  expect(spawnCalls[0]!.options.shell).toBe(true);
});

test("runCapture spawns npm without a shell on posix", async () => {
  spawnCalls.length = 0;
  nextStdout = '"1.2.3"';

  const version = await withPlatform("linux", async () => await getLatestNpmVersion("xacpx"));

  expect(version).toBe("1.2.3");
  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]!.options.shell).toBe(false);
});

test("self-update via runInherit spawns npm with shell: true on win32", async () => {
  spawnCalls.length = 0;
  nextStdout = "";
  delete process.env.XACPX_PACKAGE_MANAGER;
  delete process.env.WEACPX_PACKAGE_MANAGER;

  const printed: string[] = [];
  const exitCode = await withPlatform("win32", async () => await handleUpdateCli(["xacpx"], {
    loadConfig: async () => ({}) as never,
    saveConfig: async () => {},
    readCurrentVersion: () => "0.0.1",
    print: (line) => { printed.push(line); },
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "xacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "9.9.9" : null),
    // updateSelf deliberately NOT injected: exercise the default npm path.
  }));

  expect(exitCode).toBe(0);
  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]!.command).toBe("npm");
  expect(spawnCalls[0]!.args).toEqual(["install", "-g", "xacpx"]);
  expect(spawnCalls[0]!.options.shell).toBe(true);
  expect(spawnCalls[0]!.options.stdio).toBe("inherit");
});

test("self-update via runInherit spawns npm without a shell on posix", async () => {
  spawnCalls.length = 0;
  nextStdout = "";
  delete process.env.XACPX_PACKAGE_MANAGER;
  delete process.env.WEACPX_PACKAGE_MANAGER;

  const exitCode = await withPlatform("darwin", async () => await handleUpdateCli(["xacpx"], {
    loadConfig: async () => ({}) as never,
    saveConfig: async () => {},
    readCurrentVersion: () => "0.0.1",
    print: () => {},
    isInteractive: () => false,
    promptText: async () => "",
    packageName: "xacpx",
    getLatestVersion: async (name) => (name === "xacpx" ? "9.9.9" : null),
  }));

  expect(exitCode).toBe(0);
  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]!.options.shell).toBe(false);
});
