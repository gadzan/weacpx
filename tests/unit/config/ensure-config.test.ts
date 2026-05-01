import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { ensureConfigExists, normalizeDefaultConfigTemplate } from "../../../src/config/ensure-config";
import { loadConfig } from "../../../src/config/load-config";

test("normalizes the default config template through the shared config parser", () => {
  const config = normalizeDefaultConfigTemplate({
    transport: { type: "acpx-bridge" },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {
      backend: { cwd: "/tmp/backend" },
    },
  });

  expect(config).toMatchObject({
    transport: {
      type: "acpx-bridge",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {},
  });
  expect(config.logging).toEqual({
    level: "info",
    maxSizeBytes: 2 * 1024 * 1024,
    maxFiles: 5,
    retentionDays: 7,
  });
});

test("rejects an invalid default config template", () => {
  expect(() =>
    normalizeDefaultConfigTemplate({
      transport: { type: "bogus" },
      agents: {
        codex: { driver: "codex" },
      },
      workspaces: {},
    })
  ).toThrow("transport.type must be acpx-cli or acpx-bridge");
});

test("ensureConfigExists falls back to the built-in default template when bundled template is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-ensure-config-"));
  const configPath = join(dir, "config.json");

  try {
    await ensureConfigExists(configPath, {
      readDefaultConfigTemplate: async () => {
        const error = new Error("missing template") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    expect(raw).toMatchObject({
      transport: {
        type: "acpx-bridge",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
      agents: {
        codex: { driver: "codex" },
        claude: { driver: "claude" },
      },
      workspaces: {},
    });

    const parsed = await loadConfig(configPath);
    expect(parsed.orchestration.progressHeartbeatSeconds).toBe(300);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureConfigExists normalizes injected default config templates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-ensure-config-"));
  const configPath = join(dir, "config.json");

  try {
    await ensureConfigExists(configPath, {
      readDefaultConfigTemplate: async () =>
        ({
          transport: { type: "acpx-bridge" },
          agents: { codex: { driver: "codex" } },
          workspaces: { backend: { cwd: "/tmp/backend" } },
        }) as never,
    });

    const parsed = await loadConfig(configPath);
    expect(parsed.transport).toMatchObject({
      type: "acpx-bridge",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    });
    expect(parsed.workspaces).toEqual({});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
