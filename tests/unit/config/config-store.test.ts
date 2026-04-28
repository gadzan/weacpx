import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ConfigStore } from "../../../src/config/config-store";

test("loads config from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: { backend: { cwd: "/tmp/backend" } },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.load();

  expect(config.transport.type).toBe("acpx-bridge");
  expect(config.workspaces.backend).toEqual({ cwd: "/tmp/backend" });

  await rm(dir, { recursive: true, force: true });
});

test("upserts a workspace while preserving transport and agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge", command: "acpx" },
      agents: {
        codex: { driver: "codex", command: "./node_modules/.bin/codex-acp" },
        custom: { driver: "custom", command: "npx some-agent" },
      },
      workspaces: { backend: { cwd: "/tmp/backend" } },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.upsertWorkspace("frontend", "/tmp/frontend", "frontend repo");

  expect(config.transport).toEqual({
    type: "acpx-bridge",
    command: "acpx",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });
  expect(config.agents.codex).toEqual({
    driver: "codex",
  });
  expect(config.agents.custom).toEqual({ driver: "custom", command: "npx some-agent" });
  expect(config.workspaces.frontend).toEqual({
    cwd: "/tmp/frontend",
    description: "frontend repo",
  });

  const saved = JSON.parse(await readFile(path, "utf8")) as {
    workspaces: Record<string, unknown>;
  };
  expect(saved.workspaces.frontend).toEqual({
    cwd: "/tmp/frontend",
    description: "frontend repo",
  });

  await rm(dir, { recursive: true, force: true });
});

test("removes a workspace and keeps the rest of the config intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { claude: { driver: "claude" } },
      workspaces: {
        backend: { cwd: "/tmp/backend" },
        frontend: { cwd: "/tmp/frontend" },
      },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.removeWorkspace("backend");

  expect(config.transport).toEqual({
    type: "acpx-cli",
    command: "acpx",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });
  expect(config.agents).toEqual({ claude: { driver: "claude" } });
  expect(config.workspaces).toEqual({ frontend: { cwd: "/tmp/frontend" } });

  await rm(dir, { recursive: true, force: true });
});

test("updates transport permissions while preserving unrelated transport config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: {
        type: "acpx-cli",
        command: "custom-acpx",
        sessionInitTimeoutMs: 45000,
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
      agents: { codex: { driver: "codex" } },
      workspaces: { backend: { cwd: "/tmp/backend" } },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.updateTransport({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });

  expect(config.transport).toEqual({
    type: "acpx-cli",
    command: "custom-acpx",
    sessionInitTimeoutMs: 45000,
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });

  const saved = JSON.parse(await readFile(path, "utf8")) as {
    transport: Record<string, unknown>;
  };
  expect(saved.transport).toEqual({
    type: "acpx-cli",
    command: "custom-acpx",
    sessionInitTimeoutMs: 45000,
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });

  await rm(dir, { recursive: true, force: true });
});

test("updates wechat reply mode while preserving unrelated config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: {
        type: "acpx-cli",
        command: "custom-acpx",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
      wechat: {
        replyMode: "stream",
      },
      agents: { codex: { driver: "codex" } },
      workspaces: { backend: { cwd: "/tmp/backend" } },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.updateWechat({
    replyMode: "final",
  });

  expect(config.wechat).toEqual({
    replyMode: "final",
  });

  const saved = JSON.parse(await readFile(path, "utf8")) as {
    wechat: Record<string, unknown>;
  };
  expect(saved.wechat).toEqual({
    replyMode: "final",
  });

  await rm(dir, { recursive: true, force: true });
});


test("saves config with owner-only file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");
  const store = new ConfigStore(path);

  await store.save({
    transport: { type: "acpx-bridge", command: "acpx", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    agents: { codex: { driver: "codex" } },
    workspaces: { backend: { cwd: "/tmp/backend" } },
  });

  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  expect(await readFile(path, "utf8")).toContain('"workspaces"');

  await rm(dir, { recursive: true, force: true });
});
