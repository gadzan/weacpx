import { expect, test } from "bun:test";
import { CommandRouter } from "../../../src/commands/command-router";
import {
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createTransport,
  getCancelMock,
  getPromptMock,
  getSetModeMock,
} from "./command-router-test-support";

test("routes plain text to the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "check this stack trace");

  expect(reply.text).toContain("agent:api-fix:check this stack trace");
});

test("returns a corrective hint when no current session exists", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "check this stack trace");

  expect(reply.text).toContain("当前还没有选中的会话");
});

test("cancels the current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/cancel");

  expect(reply.text).toContain("cancelled");
});

test("treats stop as cancel", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/stop");

  expect(reply.text).toContain("cancelled");
});

test("resets the current session by recreating its transport session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const beforeReset = await sessions.getCurrentSession("wx:user");
  const reply = await router.handle("wx:user", "/session reset");
  const afterReset = await sessions.getCurrentSession("wx:user");

  expect(reply.text).toBe('会话「api-fix」已重置');
  expect(beforeReset).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
  expect(afterReset).toMatchObject({
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
  expect(afterReset?.transportSession).not.toBe("backend:api-fix");
  expect(afterReset?.transportSession.startsWith("backend:api-fix:reset-")).toBe(true);
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
  expect((transport.ensureSession as ReturnType<typeof mock>).mock.calls.at(-1)?.[0].transportSession).toBe(
    afterReset?.transportSession,
  );
});

test("treats clear as a reset alias", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  const reply = await router.handle("wx:user", "/clear");

  expect(reply.text).toBe('会话「api-fix」已重置');
});

test("returns a corrective hint when resetting without a current session", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  const reply = await router.handle("wx:user", "/session reset");

  expect(reply.text).toContain("当前还没有选中的会话");
});

test("routes prompts and cancel to the currently selected session after switching", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  await router.handle("wx:user", "/session new infra-fix --agent codex --ws backend");
  await router.handle("wx:user", "/use api-fix");
  await router.handle("wx:user", "check logs");
  await router.handle("wx:user", "/use infra-fix");
  await router.handle("wx:user", "/cancel");

  expect(getPromptMock(transport).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "api-fix",
    transportSession: "backend:api-fix",
  });
  expect(getCancelMock(transport).mock.calls.at(-1)?.[0]).toMatchObject({
    alias: "infra-fix",
    transportSession: "backend:infra-fix",
  });
});
