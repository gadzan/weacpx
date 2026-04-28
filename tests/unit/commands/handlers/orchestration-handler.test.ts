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
