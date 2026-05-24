import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../../src/config/load-config";

async function writeConfig(raw: unknown): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-later-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(raw));
  return { path, dir };
}

const base = {
  transport: { type: "acpx-cli", command: "acpx" },
  agents: { codex: { driver: "codex" } },
  workspaces: { backend: { cwd: "/tmp/backend" } },
};

test("defaults later.defaultMode to temp when absent", async () => {
  const { path, dir } = await writeConfig(base);
  const config = await loadConfig(path);
  expect(config.later?.defaultMode).toBe("temp");
  await rm(dir, { recursive: true, force: true });
});

test("honors later.defaultMode = bind", async () => {
  const { path, dir } = await writeConfig({ ...base, later: { defaultMode: "bind" } });
  const config = await loadConfig(path);
  expect(config.later?.defaultMode).toBe("bind");
  await rm(dir, { recursive: true, force: true });
});

test("falls back to temp for an invalid later.defaultMode", async () => {
  const { path, dir } = await writeConfig({ ...base, later: { defaultMode: "nonsense" } });
  const config = await loadConfig(path);
  expect(config.later?.defaultMode).toBe("temp");
  await rm(dir, { recursive: true, force: true });
});

test("defaults to temp when later is not an object", async () => {
  const { path, dir } = await writeConfig({ ...base, later: 42 });
  const config = await loadConfig(path);
  expect(config.later?.defaultMode).toBe("temp");
  await rm(dir, { recursive: true, force: true });
});
