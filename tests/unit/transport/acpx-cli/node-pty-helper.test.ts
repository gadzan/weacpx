import { expect, mock, test } from "bun:test";
import { join } from "node:path";

import { ensureNodePtyHelperExecutable, resolveNodePtyHelperPath } from "../../../../src/transport/acpx-cli/node-pty-helper";

test("resolves the macOS helper path from the node-pty package root", () => {
  expect(
    resolveNodePtyHelperPath(
      "/Users/me/project/node_modules/node-pty/package.json",
      "darwin",
      "x64",
    ),
  ).toBe(join("/Users/me/project/node_modules/node-pty", "prebuilds", "darwin-x64", "spawn-helper"));
});

test("returns null on win32 where spawn-helper is not used", () => {
  expect(
    resolveNodePtyHelperPath(
      "/Users/me/project/node_modules/node-pty/package.json",
      "win32",
      "x64",
    ),
  ).toBeNull();
});

test("chmods the helper path to be executable when present", async () => {
  const chmod = mock(async () => {});

  await ensureNodePtyHelperExecutable("/tmp/spawn-helper", chmod);

  expect(chmod).toHaveBeenCalledWith("/tmp/spawn-helper", 0o755);
});

test("ignores missing helper files", async () => {
  const chmod = mock(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });

  await expect(ensureNodePtyHelperExecutable("/tmp/missing", chmod)).resolves.toBeUndefined();
});
