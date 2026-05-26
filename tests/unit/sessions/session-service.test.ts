import { beforeAll, expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { StateStore } from "../../../src/state/state-store";
import { SessionService } from "../../../src/sessions/session-service";
import { registerKnownChannelId } from "../../../src/channels/channel-scope";

beforeAll(() => {
  registerKnownChannelId("feishu");
});

function createConfig(): AppConfig {
  return {
    transport: { type: "acpx-cli", command: "acpx", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 1024, maxFiles: 2, retentionDays: 1 },
    channel: { type: "weixin", replyMode: "stream" },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
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

test("rejects creating a logical session that collides with an external coordinator handle", async () => {
  const store = new MemoryStateStore();
  const state = createEmptyState();
  state.orchestration.externalCoordinators["backend:api-fix"] = {
    coordinatorSession: "backend:api-fix",
    workspace: "backend",
    createdAt: "2026-04-28T10:00:00.000Z",
    updatedAt: "2026-04-28T10:00:00.000Z",
  };
  const service = new SessionService(createConfig(), store, state);

  await expect(service.createSession("api-fix", "codex", "backend")).rejects.toThrow(
    'transport session "backend:api-fix" conflicts with an external coordinator',
  );
});

test("rejects attaching a logical session that collides with an external coordinator handle", async () => {
  const store = new MemoryStateStore();
  const state = createEmptyState();
  state.orchestration.externalCoordinators["codex:backend"] = {
    coordinatorSession: "codex:backend",
    workspace: "backend",
    createdAt: "2026-04-28T10:00:00.000Z",
    updatedAt: "2026-04-28T10:00:00.000Z",
  };
  const service = new SessionService(createConfig(), store, state);

  await expect(service.attachSession("review", "codex", "backend", "codex:backend")).rejects.toThrow(
    'transport session "codex:backend" conflicts with an external coordinator',
  );
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
      internalAlias: "api-fix",
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

test("lists legacy and scoped weixin sessions with display aliases", async () => {
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  state.sessions["weixin:frontend:codex"] = {
    alias: "weixin:frontend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "frontend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  state.sessions["feishu:backend:codex"] = {
    alias: "feishu:backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "feishu:backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  const config = createConfig();
  const service = new SessionService(config, new MemoryStateStore(), state);

  const sessions = await service.listSessions("weixin:default:wxid_alice");

  expect(sessions.map((session) => session.alias)).toEqual(["backend:codex", "frontend:codex"]);
});

test("lists only feishu scoped sessions with display aliases", async () => {
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  state.sessions["feishu:backend:codex"] = {
    alias: "feishu:backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "feishu:backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  const service = new SessionService(createConfig(), new MemoryStateStore(), state);

  const sessions = await service.listSessions("feishu:default:oc_chat");

  expect(sessions.map((session) => session.alias)).toEqual(["backend:codex"]);
});

test("resolves display alias to internal alias per channel", async () => {
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  state.sessions["feishu:backend:codex"] = {
    alias: "feishu:backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "feishu:backend:codex",
    created_at: "2026-05-03T00:00:00.000Z",
    last_used_at: "2026-05-03T00:00:00.000Z",
  };
  const service = new SessionService(createConfig(), new MemoryStateStore(), state);

  expect(await service.resolveAliasForChat("weixin:default:wxid_alice", "backend:codex")).toBe("backend:codex");
  expect(await service.resolveAliasForChat("feishu:default:oc_chat", "backend:codex")).toBe("feishu:backend:codex");
});

test("listAllResolvedSessions resolves all sessions, dedups by transport session, and skips de-registered ones", async () => {
  const state = createEmptyState();
  const baseTimes = { created_at: "2026-05-03T00:00:00.000Z", last_used_at: "2026-05-03T00:00:00.000Z" };
  state.sessions["api-fix"] = { alias: "api-fix", agent: "codex", workspace: "backend", transport_session: "backend:api-fix", ...baseTimes };
  state.sessions["docs"] = { alias: "docs", agent: "claude", workspace: "backend", transport_session: "backend:docs", ...baseTimes };
  // Second alias bound to the same transport session as api-fix → must dedup.
  state.sessions["api-fix-mirror"] = { alias: "api-fix-mirror", agent: "codex", workspace: "backend", transport_session: "backend:api-fix", ...baseTimes };
  // Workspace de-registered after the session was created → must be skipped (no throw).
  state.sessions["orphan"] = { alias: "orphan", agent: "codex", workspace: "ghost-workspace", transport_session: "ghost-workspace:orphan", ...baseTimes };
  const service = new SessionService(createConfig(), new MemoryStateStore(), state);

  const resolved = service.listAllResolvedSessions();
  const transportSessions = resolved.map((s) => s.transportSession).sort();

  expect(transportSessions).toEqual(["backend:api-fix", "backend:docs"]);
  expect(resolved.every((s) => s.cwd === "/tmp/backend")).toBe(true);
});

test("stores native metadata when attaching a native session", async () => {
  const config = createConfig();
  config.workspaces.project = { cwd: "/tmp/project" };
  const state = createEmptyState();
  const sessions = new SessionService(config, new MemoryStateStore(), state);

  await sessions.attachNativeSession({
    alias: "project:codex",
    agent: "codex",
    workspace: "project",
    transportSession: "project:codex",
    agentSessionId: "thread-1",
    title: "Fix CI",
    updatedAt: "2026-05-26T01:00:00.000Z",
  });

  expect(state.sessions["project:codex"]).toMatchObject({
    source: "agent-side",
    agent_session_id: "thread-1",
    agent_session_title: "Fix CI",
    agent_session_updated_at: "2026-05-26T01:00:00.000Z",
  });
});

test("stores a native transport agent command when attaching a native session", async () => {
  const config = createConfig();
  config.workspaces.project = { cwd: "/tmp/project" };
  const state = createEmptyState();
  const sessions = new SessionService(config, new MemoryStateStore(), state);

  await sessions.attachNativeSession({
    alias: "project:codex",
    agent: "codex",
    workspace: "project",
    transportSession: "project:codex",
    transportAgentCommand: "npx @zed-industries/codex-acp@^0.9.5",
    agentSessionId: "thread-1",
  });

  expect(state.sessions["project:codex"]?.transport_agent_command).toBe(
    "npx @zed-industries/codex-acp@^0.9.5",
  );
});

test("clears native metadata when rewriting a native session as a normal logical session", async () => {
  const config = createConfig();
  config.workspaces.project = { cwd: "/tmp/project" };
  const state = createEmptyState();
  const sessions = new SessionService(config, new MemoryStateStore(), state);

  await sessions.attachNativeSession({
    alias: "project:codex",
    agent: "codex",
    workspace: "project",
    transportSession: "project:codex",
    agentSessionId: "thread-1",
    title: "Fix CI",
  });

  await sessions.attachSession("project:codex", "codex", "project", "project:codex-plain");

  expect(state.sessions["project:codex"]).toMatchObject({
    source: undefined,
    agent_session_id: undefined,
    agent_session_title: undefined,
    agent_session_updated_at: undefined,
    attached_at: undefined,
  });
  await expect(sessions.findAttachedNativeSession("wx:user", "codex", "thread-1")).resolves.toBeNull();
});

test("finds attached native sessions visible in the current channel", async () => {
  const config = createConfig();
  config.workspaces.project = { cwd: "/tmp/project" };
  const state = createEmptyState();
  state.sessions["project:codex"] = {
    alias: "project:codex",
    agent: "codex",
    workspace: "project",
    transport_session: "project:codex",
    source: "agent-side",
    agent_session_id: "thread-1",
    created_at: "2026-05-26T01:00:00.000Z",
    last_used_at: "2026-05-26T01:00:00.000Z",
  };
  state.sessions["feishu:project:codex"] = {
    alias: "feishu:project:codex",
    agent: "codex",
    workspace: "project",
    transport_session: "feishu:project:codex",
    source: "agent-side",
    agent_session_id: "thread-2",
    created_at: "2026-05-26T01:00:00.000Z",
    last_used_at: "2026-05-26T01:00:00.000Z",
  };
  const sessions = new SessionService(config, new MemoryStateStore(), state);

  await expect(sessions.findAttachedNativeSession("wx:user", "codex", "thread-1")).resolves.toMatchObject({
    alias: "project:codex",
    agentSessionId: "thread-1",
  });
  await expect(sessions.findAttachedNativeSession("wx:user", "codex", "thread-2")).resolves.toBeNull();
});

test("caches and expires native session lists", async () => {
  const state = createEmptyState();
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), state, { now: () => 1_000 });

  await sessions.cacheNativeSessionList("wx:user", {
    agent: "codex",
    workspace: "backend",
    cwd: "/tmp/backend",
    sessions: [{ sessionId: "thread-1", title: "Fix CI", cwd: "/tmp/backend" }],
    nextCursor: null,
  });

  expect(await sessions.getNativeSessionList("wx:user", 10_000)).toMatchObject({
    agent: "codex",
    sessions: [{ sessionId: "thread-1", title: "Fix CI" }],
  });

  const expired = new SessionService(createConfig(), new MemoryStateStore(), state, { now: () => 20_000 });
  expect(await expired.getNativeSessionList("wx:user", 10_000)).toBeNull();
});
