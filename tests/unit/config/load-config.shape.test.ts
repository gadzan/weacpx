import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../../src/config/load-config";

test("throws when an agent entry is missing driver", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-shape-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: {} },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow('agent "codex"');
  await rm(dir, { recursive: true, force: true });
});

test("throws when a workspace entry is missing cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-shape-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow('workspace "backend"');
  await rm(dir, { recursive: true, force: true });
});

test("throws when an agent command is empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-shape-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: {
        codex: {
          driver: "codex",
          command: "",
        },
      },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow('agent "codex" command');
  await rm(dir, { recursive: true, force: true });
});

test("throws when workspace allowed_agents is present but invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-shape-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: [123],
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow('workspace "backend" allowed_agents');
  await rm(dir, { recursive: true, force: true });
});
