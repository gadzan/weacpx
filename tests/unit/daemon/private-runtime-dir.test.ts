import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensurePrivateRuntimeDir } from "../../../src/daemon/private-runtime-dir";

const isWindows = process.platform === "win32";

test("creates a missing runtime dir user-private (0700)", async () => {
  if (isWindows) return;
  const base = await mkdtemp(join(tmpdir(), "weacpx-private-runtime-"));
  const runtimeDir = join(base, "runtime");

  try {
    await ensurePrivateRuntimeDir(runtimeDir);
    expect(((await stat(runtimeDir)).mode & 0o777)).toBe(0o700);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("repairs a pre-existing loose runtime dir to 0700", async () => {
  if (isWindows) return;
  const base = await mkdtemp(join(tmpdir(), "weacpx-private-runtime-"));
  const runtimeDir = join(base, "runtime");

  try {
    await mkdir(runtimeDir, { recursive: true, mode: 0o755 });
    await chmod(runtimeDir, 0o755);
    await ensurePrivateRuntimeDir(runtimeDir);
    expect(((await stat(runtimeDir)).mode & 0o777)).toBe(0o700);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("skips the chmod repair on win32 (named pipes rely on the default DACL)", async () => {
  if (isWindows) return;
  const base = await mkdtemp(join(tmpdir(), "weacpx-private-runtime-"));
  const runtimeDir = join(base, "runtime");

  try {
    await mkdir(runtimeDir, { recursive: true, mode: 0o755 });
    await chmod(runtimeDir, 0o755);
    await ensurePrivateRuntimeDir(runtimeDir, { platform: "win32" });
    expect(((await stat(runtimeDir)).mode & 0o777)).toBe(0o755);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("chmod failures are best-effort: reported via onChmodError, never thrown", async () => {
  if (isWindows) return;
  const base = await mkdtemp(join(tmpdir(), "weacpx-private-runtime-"));
  const runtimeDir = join(base, "runtime");
  const errors: unknown[] = [];

  try {
    await expect(
      ensurePrivateRuntimeDir(runtimeDir, {
        chmodImpl: async () => {
          throw new Error("chmod denied");
        },
        onChmodError: (error) => {
          errors.push(error);
        },
      }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("chmod denied");
    // mkdir mode still applied on creation even though the explicit chmod failed.
    expect(((await stat(runtimeDir)).mode & 0o777)).toBe(0o700);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
