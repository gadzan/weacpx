import { expect, test } from "bun:test";

import type { CreateScheduledTaskInput } from "../../../src/scheduled/scheduled-service";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";
import { createScheduledTaskFromRoute } from "../../../src/scheduled/scheduled-route-create";
import { createEmptyState } from "../../../src/state/types";
import type { ResolvedSession } from "../../../src/transport/types";

const now = new Date("2026-05-25T00:00:00.000Z");

function session(overrides: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    alias: "main",
    agent: "codex",
    workspace: "backend",
    transportSession: "backend:main",
    cwd: "/repo/backend",
    ...overrides,
  };
}

function taskFromInput(input: CreateScheduledTaskInput): ScheduledTaskRecord {
  return {
    id: "k8f2",
    chat_key: input.chatKey,
    session_alias: input.sessionAlias,
    execute_at: input.executeAt.toISOString(),
    message: input.message,
    status: "pending",
    created_at: now.toISOString(),
    ...(input.sessionMode ? { session_mode: input.sessionMode } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.accountId ? { account_id: input.accountId } : {}),
    ...(input.replyContextToken ? { reply_context_token: input.replyContextToken } : {}),
    ...(input.sourceLabel ? { source_label: input.sourceLabel } : {}),
  };
}

test("creates a temp scheduled task from the coordinator route's logical session alias", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:user",
    sessionAlias: "main",
    accountId: "acc-1",
    replyContextToken: "ctx-1",
    chatType: "direct",
    updatedAt: now.toISOString(),
  };
  const creates: CreateScheduledTaskInput[] = [];

  const task = await createScheduledTaskFromRoute(
    {
      coordinatorSession: "backend:main",
      timeText: "in 2h",
      message: "检查 CI",
    },
    {
      state,
      config: { later: { defaultMode: "temp" } },
      sessions: {
        getSession: async (alias) => session({ alias }),
        getPreferredSessionForTransport: async () => session({ alias: "wrong-shared-alias" }),
      },
      scheduled: {
        createTask: async (input) => {
          creates.push(input);
          return taskFromInput(input);
        },
      },
      supportsScheduledMessages: () => true,
      now: () => now,
    },
  );

  expect(creates).toHaveLength(1);
  expect(creates[0]).toEqual({
    chatKey: "wx:user",
    sessionAlias: "main",
    executeAt: new Date("2026-05-25T02:00:00.000Z"),
    message: "检查 CI",
    sessionMode: "temp",
    agent: "codex",
    workspace: "backend",
    accountId: "acc-1",
    replyContextToken: "ctx-1",
    sourceLabel: "mcp:scheduled_create",
  });
  expect(task).toMatchObject({
    id: "k8f2",
    chat_key: "wx:user",
    session_alias: "main",
    session_mode: "temp",
    agent: "codex",
    workspace: "backend",
    source_label: "mcp:scheduled_create",
  });
});

test("rejects scheduled_create from non-owner group routes", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:group",
    sessionAlias: "main",
    chatType: "group",
    isOwner: false,
    updatedAt: now.toISOString(),
  };
  const creates: CreateScheduledTaskInput[] = [];

  await expect(
    createScheduledTaskFromRoute(
      {
        coordinatorSession: "backend:main",
        timeText: "in 2h",
        message: "检查 CI",
      },
      {
        state,
        config: { later: { defaultMode: "temp" } },
        sessions: { getSession: async () => session(), getPreferredSessionForTransport: async () => session() },
        scheduled: {
          createTask: async (input) => {
            creates.push(input);
            return taskFromInput(input);
          },
        },
        now: () => now,
      },
    ),
  ).rejects.toThrow("scheduled_create is owner-only in group chats");

  expect(creates).toEqual([]);
});

test("rejects routes missing direct/group chat metadata", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:legacy",
    sessionAlias: "main",
    updatedAt: now.toISOString(),
  };

  await expect(
    createScheduledTaskFromRoute(
      {
        coordinatorSession: "backend:main",
        timeText: "in 2h",
        message: "检查 CI",
      },
      {
        state,
        config: { later: { defaultMode: "temp" } },
        sessions: { getSession: async () => session(), getPreferredSessionForTransport: async () => session() },
        scheduled: { createTask: async (input) => taskFromInput(input) },
        now: () => now,
      },
    ),
  ).rejects.toThrow("scheduled_create requires current chat route metadata");
});

test("rejects group routes missing owner metadata", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:group",
    sessionAlias: "main",
    chatType: "group",
    updatedAt: now.toISOString(),
  };

  await expect(
    createScheduledTaskFromRoute(
      {
        coordinatorSession: "backend:main",
        timeText: "in 2h",
        message: "检查 CI",
      },
      {
        state,
        config: { later: { defaultMode: "temp" } },
        sessions: { getSession: async () => session(), getPreferredSessionForTransport: async () => session() },
        scheduled: { createTask: async (input) => taskFromInput(input) },
        now: () => now,
      },
    ),
  ).rejects.toThrow("scheduled_create is owner-only in group chats");
});

test("rejects unsupported scheduled delivery routes before creating a task", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "feishu:chat",
    sessionAlias: "main",
    chatType: "direct",
    updatedAt: now.toISOString(),
  };
  const creates: CreateScheduledTaskInput[] = [];

  await expect(
    createScheduledTaskFromRoute(
      {
        coordinatorSession: "backend:main",
        timeText: "in 2h",
        message: "检查 CI",
      },
      {
        state,
        config: { later: { defaultMode: "temp" } },
        sessions: { getSession: async () => session(), getPreferredSessionForTransport: async () => session() },
        scheduled: {
          createTask: async (input) => {
            creates.push(input);
            return taskFromInput(input);
          },
        },
        supportsScheduledMessages: () => false,
        now: () => now,
      },
    ),
  ).rejects.toThrow("current channel does not support scheduled tasks");

  expect(creates).toEqual([]);
});

test("rejects slash-prefixed delayed messages", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:user",
    sessionAlias: "main",
    chatType: "direct",
    updatedAt: now.toISOString(),
  };
  const creates: CreateScheduledTaskInput[] = [];

  await expect(
    createScheduledTaskFromRoute(
      {
        coordinatorSession: "backend:main",
        timeText: "in 2h",
        message: "/status",
      },
      {
        state,
        config: { later: { defaultMode: "temp" } },
        sessions: { getSession: async () => session(), getPreferredSessionForTransport: async () => session() },
        scheduled: {
          createTask: async (input) => {
            creates.push(input);
            return taskFromInput(input);
          },
        },
        now: () => now,
      },
    ),
  ).rejects.toThrow("scheduled_create does not support slash-prefixed xacpx commands");

  expect(creates).toEqual([]);
});

test("succeeds when session.transportSession has a :reset- suffix after /clear", async () => {
  // Regression: after /clear the logical session's transportSession becomes
  // "ws:alias:reset-<ts>" while the MCP tool sends the stable "ws:alias" as
  // coordinatorSession. The guard must normalize both sides before comparing.
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["ws:alias"] = {
    coordinatorSession: "ws:alias",
    chatKey: "wx:user",
    sessionAlias: "alias",
    chatType: "direct",
    updatedAt: now.toISOString(),
  };
  const creates: CreateScheduledTaskInput[] = [];

  const task = await createScheduledTaskFromRoute(
    {
      coordinatorSession: "ws:alias",
      timeText: "in 2h",
      message: "do something",
    },
    {
      state,
      config: { later: { defaultMode: "temp" } },
      sessions: {
        getSession: async (alias) =>
          session({ alias, workspace: "ws", transportSession: "ws:alias:reset-1700000000000" }),
        getPreferredSessionForTransport: async () => null,
      },
      scheduled: {
        createTask: async (input) => {
          creates.push(input);
          return taskFromInput(input);
        },
      },
      supportsScheduledMessages: () => true,
      now: () => now,
    },
  );

  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({ chatKey: "wx:user", sessionAlias: "alias" });
  expect(task).toMatchObject({ chat_key: "wx:user", session_alias: "alias" });
});
