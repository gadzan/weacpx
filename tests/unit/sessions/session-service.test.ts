import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { StateStore } from "../../../src/state/state-store";
import { SessionService } from "../../../src/sessions/session-service";

function createConfig(): AppConfig {
  return {
    transport: { type: "acpx-cli", command: "acpx", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 1024, maxFiles: 2, retentionDays: 1 },
    wechat: { replyMode: "stream" },
    agents: {
      codex: { driver: "codex" },
      claude: { driver: "claude" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
    },
    orchestration: {
      maxPendingAgentRequestsPerCoordinator: 3,
      allowWorkerChainedRequests: false,
      allowedAgentRequestTargets: [],
      allowedAgentRequestRoles: [],
    },
  };
}

class MemoryStateStore implements Pick<StateStore, "save"> {
  public savedStates: AppState[] = [];

  async save(state: AppState): Promise<void> {
    this.savedStates.push(structuredClone(state));
  }
}

test("creates a session from a known agent and workspace", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  const session = await service.createSession("api-fix", "codex", "backend");

  expect(session.transportSession).toBe("backend:api-fix");
  expect(session.cwd).toBe("/tmp/backend");
  expect(session.agentCommand).toBeUndefined();
});

test("ignores a legacy raw codex command and falls back to the built-in codex alias", async () => {
  const store = new MemoryStateStore();
  const config = createConfig();
  config.agents.codex = {
    driver: "codex",
    command: "node E:/projects/weacpx/node_modules/@zed-industries/codex-acp/bin/codex-acp.js",
  };
  const service = new SessionService(config, store, createEmptyState());

  const session = await service.createSession("api-fix", "codex", "backend");

  expect(session.agentCommand).toBeUndefined();
});

test("attaches an existing transport session with a custom name", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  const session = await service.attachSession("review", "codex", "backend", "existing-review");

  expect(session.transportSession).toBe("existing-review");
  expect(session.cwd).toBe("/tmp/backend");
});

test("stores and resolves a session-level transport agent command", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.attachSession("review", "codex", "backend", "existing-review");
  await service.setSessionTransportAgentCommand("review", "npx @zed-industries/codex-acp@^0.9.5");
  const session = await service.getSession("review");

  expect(session).toMatchObject({
    alias: "review",
    transportSession: "existing-review",
    agentCommand: "npx @zed-industries/codex-acp@^0.9.5",
  });
});

test("rejects duplicate aliases", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("api-fix", "codex", "backend");
  await expect(service.createSession("api-fix", "codex", "backend")).resolves.toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
});

test("recreates an existing alias by overwriting its logical session binding", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.attachSession("api-fix", "codex", "backend", "stale-session");

  const session = await service.createSession("api-fix", "codex", "backend");

  expect(session.transportSession).toBe("backend:api-fix");
});

test("rebinds an existing alias to a different transport session", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("review", "codex", "backend");

  const session = await service.attachSession("review", "codex", "backend", "existing-review");

  expect(session.transportSession).toBe("existing-review");
});

test("sets and resolves current session by chat key", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("api-fix", "codex", "backend");
  await service.useSession("wx:user", "api-fix");

  await expect(service.getCurrentSession("wx:user")).resolves.toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
});

test("stores and resolves the current session mode", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("api-fix", "codex", "backend");
  await service.useSession("wx:user", "api-fix");
  await service.setCurrentSessionMode("wx:user", "plan");

  await expect(service.getCurrentSession("wx:user")).resolves.toMatchObject({
    alias: "api-fix",
    modeId: "plan",
  });
});

test("stores and resolves the current session reply mode", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("api-fix", "codex", "backend");
  await service.useSession("wx:user", "api-fix");
  await service.setCurrentSessionReplyMode("wx:user", "final");

  await expect(service.getCurrentSession("wx:user")).resolves.toMatchObject({
    alias: "api-fix",
    replyMode: "final",
  });
});

test("rejects unknown workspaces", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await expect(service.createSession("x", "codex", "missing")).rejects.toThrow("工作区「missing」未注册");
});

test("rejects blank session aliases", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await expect(service.createSession("   ", "codex", "backend")).rejects.toThrow('session alias must be a non-empty string');
});

test("allows any registered agent in a registered workspace", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await expect(service.createSession("x", "claude", "backend")).resolves.toMatchObject({
    alias: "x",
    agent: "claude",
    workspace: "backend",
  });
});

test("lists logical sessions with current markers", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("api-fix", "codex", "backend");
  await service.useSession("wx:user", "api-fix");

  expect(await service.listSessions("wx:user")).toEqual([
    {
      alias: "api-fix",
      agent: "codex",
      workspace: "backend",
      isCurrent: true,
    },
  ]);
});


test("returns a descriptive error when resolving a session whose agent was removed", async () => {
  const store = new MemoryStateStore();
  const config = createConfig();
  const state = createEmptyState();
  const service = new SessionService(config, store, state);

  await service.createSession("api-fix", "codex", "backend");
  delete config.agents.codex;

  await expect(service.getSession("api-fix")).rejects.toThrow(
    'session "api-fix" references agent "codex", but that agent is no longer registered',
  );
});

test("returns a descriptive error when resolving a session whose workspace was removed", async () => {
  const store = new MemoryStateStore();
  const config = createConfig();
  const state = createEmptyState();
  const service = new SessionService(config, store, state);

  await service.createSession("api-fix", "codex", "backend");
  delete config.workspaces.backend;

  await expect(service.getSession("api-fix")).rejects.toThrow(
    'session "api-fix" references workspace "backend", but that workspace is no longer registered',
  );
});

test("removes a session and clears chat contexts pointing to it", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await service.createSession("main", "codex", "backend");
  await service.createSession("other", "claude", "backend");
  await service.useSession("wx:user-1", "main");
  await service.useSession("wx:user-2", "main");

  const { wasActive } = await service.removeSession("main");

  expect(wasActive).toBe(true);
  expect(await service.getSession("main")).toBeNull();
  expect(await service.getSession("other")).not.toBeNull();
  expect(await service.getCurrentSession("wx:user-1")).toBeNull();
  expect(await service.getCurrentSession("wx:user-2")).toBeNull();
});

test("throws when removing a non-existent session", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  expect(service.removeSession("nope")).rejects.toThrow('session "nope" does not exist');
});
