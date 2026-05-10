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

test("updates channel reply mode while preserving unrelated config", async () => {
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
      channel: {
        type: "weixin",
        replyMode: "stream",
      },
      agents: { codex: { driver: "codex" } },
      workspaces: { backend: { cwd: "/tmp/backend" } },
    }),
  );

  const store = new ConfigStore(path);
  const config = await store.updateChannel({
    replyMode: "final",
  });

  expect(config.channel).toEqual({
    type: "weixin",
    replyMode: "final",
  });

  const saved = JSON.parse(await readFile(path, "utf8")) as {
    channel: Record<string, unknown>;
  };
  expect(saved.channel).toEqual({
    type: "weixin",
    replyMode: "final",
  });

  await rm(dir, { recursive: true, force: true });
});

test("saves canonical channel config without legacy wechat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");
  const store = new ConfigStore(path);

  await store.save({
    transport: { type: "acpx-bridge", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 2097152, maxFiles: 5, retentionDays: 7 },
    channel: { type: "weixin", replyMode: "stream" },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
    agents: { codex: { driver: "codex" } },
    workspaces: {},
    orchestration: {
      maxPendingAgentRequestsPerCoordinator: 3,
      allowWorkerChainedRequests: false,
      allowedAgentRequestTargets: [],
      allowedAgentRequestRoles: [],
      progressHeartbeatSeconds: 300,
    },
  });

  const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

  expect(saved.channel).toEqual({ type: "weixin", replyMode: "stream" });
  expect(saved.wechat).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});


test("saves config with owner-only file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-store-"));
  const path = join(dir, "config.json");
  const store = new ConfigStore(path);

  await store.save({
    transport: { type: "acpx-bridge", command: "acpx", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    channel: { type: "weixin", replyMode: "verbose" },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
    agents: { codex: { driver: "codex" } },
    workspaces: { backend: { cwd: "/tmp/backend" } },
    logging: { level: "info", maxSizeBytes: 2097152, maxFiles: 5, retentionDays: 7 },
    orchestration: {
      maxPendingAgentRequestsPerCoordinator: 3,
      allowWorkerChainedRequests: false,
      allowedAgentRequestTargets: [],
      allowedAgentRequestRoles: [],
      progressHeartbeatSeconds: 300,
    },
  });

  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  expect(await readFile(path, "utf8")).toContain('"workspaces"');

  await rm(dir, { recursive: true, force: true });
});
