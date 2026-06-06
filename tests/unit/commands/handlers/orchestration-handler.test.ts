import { expect, test } from "bun:test";

import { CommandRouter } from "../../../../src/commands/command-router";
import {
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createOrchestrationService,
  createTransport,
  getListTasksMock,
  getListGroupSummariesMock,
  getCancelTaskMock,
} from "../command-router-test-support";

test("handleTaskList forwards filter to the service", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const orchestration = createOrchestrationService();
  const router = new CommandRouter(sessions, transport, config, undefined, undefined, undefined, orchestration);

  await router.handle("wx:user", "/session new main --agent codex --ws backend");
  await router.handle("wx:user", "/tasks --status running --stuck");

  expect(getListTasksMock(orchestration).mock.calls.at(-1)?.[0]).toMatchObject({
    coordinatorSession: "backend:main",
    status: "running",
    stuck: true,
  });
});

test("handleGroupList forwards filter to the service", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const orchestration = createOrchestrationService();
  const router = new CommandRouter(sessions, transport, config, undefined, undefined, undefined, orchestration);

  await router.handle("wx:user", "/session new main --agent codex --ws backend");
  await router.handle("wx:user", "/groups --status pending --sort createdAt --order asc");

  expect(getListGroupSummariesMock(orchestration).mock.calls.at(-1)?.[0]).toMatchObject({
    coordinatorSession: "backend:main",
    status: "pending",
    sort: "createdAt",
    order: "asc",
  });
});

test("handleTaskCancel uses stable coordinator identity after /clear rotates transportSession", async () => {
  const config = createConfig();
  const sessions = new SessionService(config, new MemoryStateStore(), createEmptyState());
  const transport = createTransport();

  // Seed orchestration with a task owned by the pre-reset stable identity "backend:main"
  const orchestration = createOrchestrationService({
    taskId: "task-abc",
    tasks: [
      {
        taskId: "task-abc",
        sourceHandle: "backend:main",
        sourceKind: "coordinator",
        coordinatorSession: "backend:main",
        workspace: "backend",
        targetAgent: "codex",
        task: "do something",
        status: "running",
        summary: "",
        resultText: "",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  });
  const router = new CommandRouter(sessions, transport, config, undefined, undefined, undefined, orchestration);

  // Create session then simulate /clear by attaching the same alias with a :reset-<ts> transport name
  await router.handle("wx:user", "/session new main --agent codex --ws backend");
  // After /clear, the transport session becomes "backend:main:reset-<timestamp>"
  await sessions.attachSession("main", "codex", "backend", "backend:main:reset-1749168000000");
  await sessions.useSession("wx:user", "main");

  // /task cancel should reach requestTaskCancellation with coordinatorSession "backend:main",
  // NOT return taskNotFound because of the :reset-… mismatch
  await router.handle("wx:user", "/task cancel task-abc");

  const cancelMock = getCancelTaskMock(orchestration);
  expect(cancelMock.mock.calls.length).toBe(1);
  expect(cancelMock.mock.calls[0][0]).toMatchObject({
    taskId: "task-abc",
    coordinatorSession: "backend:main",
  });
});
