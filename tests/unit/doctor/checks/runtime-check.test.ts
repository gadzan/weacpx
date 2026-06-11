import { constants } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { checkRuntime } from "../../../../src/doctor/checks/runtime-check";

const DIRECTORY_USABLE = constants.W_OK | constants.X_OK;

interface ProbeOptions {
  directories: string[];
  /** path -> POSIX mode (mask 0o777) returned by stat for that directory. */
  modes?: Record<string, number>;
  deniedAccess?: string[];
}

function createRuntimeProbe(options: ProbeOptions): {
  probe: {
    stat: (path: string) => Promise<{ isDirectory: () => boolean; mode?: number }>;
    access: (path: string, mode: number) => Promise<void>;
  };
} {
  const directories = new Set(options.directories);
  const deniedAccess = new Set(options.deniedAccess ?? []);
  const modes = options.modes ?? {};

  return {
    probe: {
      async stat(path: string) {
        if (directories.has(path)) {
          const mode = modes[path];
          return {
            isDirectory: () => true,
            ...(mode === undefined ? {} : { mode }),
          };
        }
        throw createErrno("ENOENT", path);
      },
      async access(path: string, mode: number) {
        if (!directories.has(path) || deniedAccess.has(path)) {
          throw createErrno("EACCES", path);
        }
      },
    },
  };
}

function createErrno(code: string, path: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: ${path}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function runtimeDirOf(home: string): string {
  return join(home, ".xacpx", "runtime");
}

test("runtime check warns and attaches a fix when the runtime dir has group/other bits set", async () => {
  const home = "/home/user";
  const runtimeDir = runtimeDirOf(home);
  const probe = createRuntimeProbe({
    directories: [home, runtimeDir],
    modes: { [runtimeDir]: 0o755 },
  });

  const ensureCalls: string[] = [];
  const result = await checkRuntime({
    home,
    probe: probe.probe,
    platform: "linux",
    ensurePrivateRuntimeDir: async (dir) => {
      ensureCalls.push(dir);
    },
  });

  expect(result.severity).toBe("warn");
  const fix = result.fixes?.find((entry) => entry.id === "runtime.ensure-private-dir");
  expect(fix).toBeDefined();
  expect(fix?.withheld).toBeUndefined();

  const outcome = await fix!.run();
  expect(outcome.ok).toBe(true);
  expect(outcome.message).toContain(runtimeDir);
  expect(ensureCalls).toEqual([runtimeDir]);
});

test("runtime check attaches the ensure-private-dir fix when the runtime dir is missing", async () => {
  const home = "/home/user";
  const runtimeDir = runtimeDirOf(home);
  // Parent exists and is writable so the dir is still creatable (check passes),
  // but the dir itself is absent, so the repair primitive should be offered.
  const probe = createRuntimeProbe({
    directories: [home, join(home, ".xacpx")],
  });

  const ensureCalls: string[] = [];
  const result = await checkRuntime({
    home,
    probe: probe.probe,
    platform: "linux",
    ensurePrivateRuntimeDir: async (dir) => {
      ensureCalls.push(dir);
    },
  });

  const fix = result.fixes?.find((entry) => entry.id === "runtime.ensure-private-dir");
  expect(fix).toBeDefined();

  await fix!.run();
  expect(ensureCalls).toEqual([runtimeDir]);
});

test("runtime check does not attach a perms fix when the runtime dir is already 0700", async () => {
  const home = "/home/user";
  const runtimeDir = runtimeDirOf(home);
  const probe = createRuntimeProbe({
    directories: [home, runtimeDir],
    modes: { [runtimeDir]: 0o700 },
  });

  const result = await checkRuntime({
    home,
    probe: probe.probe,
    platform: "linux",
  });

  expect(result.severity).toBe("pass");
  expect(result.fixes ?? []).toEqual([]);
});

test("runtime check does not attach a perms fix on win32 even with wide bits", async () => {
  const home = "/home/user";
  const runtimeDir = runtimeDirOf(home);
  const probe = createRuntimeProbe({
    directories: [home, runtimeDir],
    modes: { [runtimeDir]: 0o777 },
  });

  const result = await checkRuntime({
    home,
    probe: probe.probe,
    platform: "win32",
  });

  expect(result.fixes ?? []).toEqual([]);
});

test("runtime check still fails (no perms fix) when a critical path is not usable", async () => {
  const home = "/home/user";
  const runtimeDir = runtimeDirOf(home);
  const probe = createRuntimeProbe({
    directories: [home, runtimeDir],
    modes: { [runtimeDir]: 0o755 },
    deniedAccess: [runtimeDir],
  });

  const result = await checkRuntime({
    home,
    probe: probe.probe,
    platform: "linux",
  });

  expect(result.severity).toBe("fail");
});
