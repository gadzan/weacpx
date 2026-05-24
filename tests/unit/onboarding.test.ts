import { expect, test } from "bun:test";
import type { AppConfig } from "../../src/config/types";
import { createEmptyState } from "../../src/state/types";
import { isFirstUse, maybeRunFirstUseOnboarding } from "../../src/onboarding";

function config(): AppConfig {
  return {
    transport: { type: "acpx-bridge", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
    logging: { level: "info", maxSizeBytes: 1, maxFiles: 1, retentionDays: 1 },
    channel: { type: "weixin", replyMode: "stream" },
    channels: [],
    plugins: [],
    agents: {},
    workspaces: {},
    orchestration: { maxPendingAgentRequestsPerCoordinator: 1, allowWorkerChainedRequests: false, allowedAgentRequestTargets: [], allowedAgentRequestRoles: [], progressHeartbeatSeconds: 0 },
  };
}

test("isFirstUse treats a config carrying only the seeded home workspace as first use", () => {
  const cfg = config();
  cfg.workspaces = { home: { cwd: "/Users/test" } };
  expect(isFirstUse(cfg, createEmptyState())).toBe(true);
});

test("isFirstUse is false once a non-default workspace exists", () => {
  const cfg = config();
  cfg.workspaces = { home: { cwd: "/Users/test" }, myrepo: { cwd: "/tmp/myrepo" } };
  expect(isFirstUse(cfg, createEmptyState())).toBe(false);
});

test("interactive onboarding still fires when only the seeded home workspace is present", async () => {
  const cfg = config();
  cfg.workspaces = { home: { cwd: "/Users/test" } };
  const state = createEmptyState();
  const result = await maybeRunFirstUseOnboarding({
    config: cfg,
    state,
    saveConfig: async () => {},
    deps: {
      cwd: () => "/tmp/myrepo",
      print: () => {},
      isInteractive: () => true,
      promptText: async () => "",
    },
  });

  expect(result).toMatchObject({ created: true, workspace: "myrepo", alias: "myrepo:codex" });
  // The seeded home workspace and the onboarding-created project workspace coexist.
  expect(Object.keys(cfg.workspaces).sort()).toEqual(["home", "myrepo"]);
});

test("first-use onboarding creates current directory workspace and initial session", async () => {
  const cfg = config();
  const state = createEmptyState();
  const answers = ["", "1"];
  const result = await maybeRunFirstUseOnboarding({
    config: cfg,
    state,
    saveConfig: async () => {},
    deps: {
      cwd: () => "/tmp/myrepo",
      print: () => {},
      isInteractive: () => true,
      promptText: async () => answers.shift() ?? "",
    },
  });

  expect(result.created).toBe(true);
  expect(cfg.workspaces.myrepo.cwd).toBe("/tmp/myrepo");
  expect(result).toMatchObject({
    created: true,
    alias: "myrepo:codex",
    agent: "codex",
    workspace: "myrepo",
    rollback: { workspaceExisted: false, agentExisted: false },
  });
  expect(state.sessions["myrepo:codex"]).toBeUndefined();
});

test("first-use onboarding skips non-interactive mode", async () => {
  const cfg = config();
  const state = createEmptyState();
  const result = await maybeRunFirstUseOnboarding({
    config: cfg,
    state,
    saveConfig: async () => { throw new Error("should not save"); },
    deps: { cwd: () => "/tmp/myrepo", print: () => {}, isInteractive: () => false, promptText: async () => "" },
  });

  expect(result.created).toBe(false);
  expect(Object.keys(cfg.workspaces)).toEqual([]);
});

test("first-use onboarding sanitizes workspace names for session aliases", async () => {
  const cfg = config();
  const state = createEmptyState();
  const result = await maybeRunFirstUseOnboarding({
    config: cfg,
    state,
    saveConfig: async () => {},
    deps: {
      cwd: () => "/tmp/my repo!",
      print: () => {},
      isInteractive: () => true,
      promptText: async () => "",
    },
  });

  expect(result).toMatchObject({ created: true, workspace: "my-repo", alias: "my-repo:codex" });
});

test("first-use onboarding records rollback metadata for existing agents", async () => {
  const cfg = config();
  cfg.agents.codex = { driver: "codex" };
  const state = createEmptyState();

  const result = await maybeRunFirstUseOnboarding({
    config: cfg,
    state,
    saveConfig: async () => {},
    deps: {
      cwd: () => "/tmp/myrepo",
      print: () => {},
      isInteractive: () => true,
      promptText: async () => "",
    },
  });

  expect(result).toMatchObject({
    created: true,
    rollback: { workspaceExisted: false, agentExisted: true },
  });
});
