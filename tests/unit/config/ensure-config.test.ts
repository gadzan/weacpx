import { expect, test } from "bun:test";

import { normalizeDefaultConfigTemplate } from "../../../src/config/ensure-config";

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
