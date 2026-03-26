import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { StateStore } from "../../../src/state/state-store";
import { SessionService } from "../../../src/sessions/session-service";

function createConfig(): AppConfig {
  return {
    transport: { type: "acpx-cli", command: "acpx" },
    agents: {
      codex: { driver: "codex" },
      claude: { driver: "claude" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
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

test("rejects unknown workspaces", async () => {
  const store = new MemoryStateStore();
  const service = new SessionService(createConfig(), store, createEmptyState());

  await expect(service.createSession("x", "codex", "missing")).rejects.toThrow('workspace "missing"');
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
