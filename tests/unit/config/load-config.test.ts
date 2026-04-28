import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../../src/config/load-config";

test("loads a valid config file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          description: "backend repo",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.transport.type).toBe("acpx-cli");
  expect(config.workspaces.backend.cwd).toBe("/tmp/backend");
  expect(config.transport.sessionInitTimeoutMs).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("loads a workspace without allowed_agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          description: "backend repo",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.workspaces.backend).toEqual({
    cwd: "/tmp/backend",
    description: "backend repo",
  });

  await rm(dir, { recursive: true, force: true });
});

test("defaults transport.type to acpx-bridge when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.transport.type).toBe("acpx-bridge");

  await rm(dir, { recursive: true, force: true });
});

test("loads an optional transport session init timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx", sessionInitTimeoutMs: 120000 },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.transport.sessionInitTimeoutMs).toBe(120000);

  await rm(dir, { recursive: true, force: true });
});

test("defaults transport permission policy to approve-all and deny", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.transport.permissionMode).toBe("approve-all");
  expect(config.transport.nonInteractivePermissions).toBe("deny");

  await rm(dir, { recursive: true, force: true });
});

test("loads explicit transport permission policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: {
        type: "acpx-bridge",
        command: "acpx",
        permissionMode: "approve-reads",
        nonInteractivePermissions: "deny",
      },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.transport.permissionMode).toBe("approve-reads");
  expect(config.transport.nonInteractivePermissions).toBe("deny");

  await rm(dir, { recursive: true, force: true });
});

test("rejects allow for explicit non-interactive permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: {
        type: "acpx-bridge",
        command: "acpx",
        permissionMode: "approve-all",
        nonInteractivePermissions: "allow",
      },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow("transport.nonInteractivePermissions must be deny or fail");

  await rm(dir, { recursive: true, force: true });
});

test("loads an optional raw agent command for non-codex agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: {
        custom: {
          driver: "custom",
          command: "npx some-agent",
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

  const config = await loadConfig(path);
  expect(config.agents.custom?.command).toBe("npx some-agent");

  await rm(dir, { recursive: true, force: true });
});

test("defaults logging to bounded info mode when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.logging).toEqual({
    level: "info",
    maxSizeBytes: 2 * 1024 * 1024,
    maxFiles: 5,
    retentionDays: 7,
  });
  expect(config.wechat).toEqual({
    replyMode: "verbose",
  });
  expect(config.orchestration).toEqual({
    maxPendingAgentRequestsPerCoordinator: 3,
    allowWorkerChainedRequests: false,
    allowedAgentRequestTargets: [],
    allowedAgentRequestRoles: [],
    progressHeartbeatSeconds: 300,
  });

  await rm(dir, { recursive: true, force: true });
});

test("loads explicit orchestration guardrail overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
      orchestration: {
        maxPendingAgentRequestsPerCoordinator: 5,
        allowWorkerChainedRequests: true,
        allowedAgentRequestTargets: ["claude", "codex"],
        allowedAgentRequestRoles: ["reviewer", "planner"],
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.orchestration).toEqual({
    maxPendingAgentRequestsPerCoordinator: 5,
    allowWorkerChainedRequests: true,
    allowedAgentRequestTargets: ["claude", "codex"],
    allowedAgentRequestRoles: ["reviewer", "planner"],
    progressHeartbeatSeconds: 300,
  });

  await rm(dir, { recursive: true, force: true });
});

test("defaults orchestration guardrails when omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.orchestration).toEqual({
    maxPendingAgentRequestsPerCoordinator: 3,
    allowWorkerChainedRequests: false,
    allowedAgentRequestTargets: [],
    allowedAgentRequestRoles: [],
    progressHeartbeatSeconds: 300,
  });

  await rm(dir, { recursive: true, force: true });
});

test("loads explicit wechat reply mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      wechat: { replyMode: "final" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.wechat.replyMode).toBe("final");

  await rm(dir, { recursive: true, force: true });
});

test("loads an explicit logging configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      logging: {
        level: "debug",
        maxSizeBytes: 65536,
        maxFiles: 3,
        retentionDays: 2,
      },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.logging).toEqual({
    level: "debug",
    maxSizeBytes: 65536,
    maxFiles: 3,
    retentionDays: 2,
  });

  await rm(dir, { recursive: true, force: true });
});

test("drops the legacy raw codex command so codex uses the built-in acpx alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: {
        codex: {
          driver: "codex",
          command: "./node_modules/.bin/codex-acp",
        },
      },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const config = await loadConfig(path);
  expect(config.agents.codex).toEqual({ driver: "codex" });

  await rm(dir, { recursive: true, force: true });
});

test("throws when transport.type is invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "nope" },
      agents: {},
      workspaces: {},
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow("transport.type");
  await rm(dir, { recursive: true, force: true });
});

test("throws when transport.sessionInitTimeoutMs is not a positive number", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-cli", sessionInitTimeoutMs: 0 },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow("transport.sessionInitTimeoutMs");
  await rm(dir, { recursive: true, force: true });
});
