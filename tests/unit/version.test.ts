import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "bun:test";

import { readVersion } from "../../src/version";

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "weacpx-version-"));
  return root;
}

test("readVersion resolves installed-package layout (dist/cli.js → ../package.json)", async () => {
  const root = await createWorkspace();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@ganglion/xacpx", version: "9.9.9" }));
    await mkdir(join(root, "dist"), { recursive: true });
    const cliPath = join(root, "dist", "cli.js");
    await writeFile(cliPath, "// fake bundle\n");

    const moduleUrl = pathToFileURL(cliPath).toString();
    expect(readVersion(moduleUrl)).toBe("9.9.9");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVersion resolves dev/source layout (src/version.ts → ../package.json)", async () => {
  const root = await createWorkspace();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@ganglion/xacpx", version: "1.2.3" }));
    await mkdir(join(root, "src"), { recursive: true });
    const sourcePath = join(root, "src", "version.ts");
    await writeFile(sourcePath, "// dev source\n");

    const moduleUrl = pathToFileURL(sourcePath).toString();
    expect(readVersion(moduleUrl)).toBe("1.2.3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVersion ignores package.json that does not belong to weacpx", async () => {
  const root = await createWorkspace();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "some-other-pkg", version: "0.0.1" }));
    await mkdir(join(root, "dist"), { recursive: true });
    const cliPath = join(root, "dist", "cli.js");
    await writeFile(cliPath, "// fake\n");

    const moduleUrl = pathToFileURL(cliPath).toString();
    expect(readVersion(moduleUrl)).toBe("unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVersion returns unknown when no candidate package.json exists", async () => {
  const root = await createWorkspace();
  try {
    await mkdir(join(root, "dist"), { recursive: true });
    const cliPath = join(root, "dist", "cli.js");
    await writeFile(cliPath, "// fake\n");

    const moduleUrl = pathToFileURL(cliPath).toString();
    expect(readVersion(moduleUrl)).toBe("unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVersion uses dev fallback when first candidate is missing", async () => {
  const root = await createWorkspace();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@ganglion/xacpx", version: "2.0.0" }));
    await mkdir(join(root, "src", "nested"), { recursive: true });
    const sourcePath = join(root, "src", "nested", "deep.ts");
    await writeFile(sourcePath, "// dev source from a deeper path\n");

    const moduleUrl = pathToFileURL(sourcePath).toString();
    expect(readVersion(moduleUrl)).toBe("2.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readVersion called from real source location returns repo package version", () => {
  const version = readVersion();
  expect(version).not.toBe("unknown");
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
