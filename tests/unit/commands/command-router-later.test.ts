import { expect, mock, test } from "bun:test";
import { CommandRouter } from "../../../src/commands/command-router";
import {
  MemoryConfigStore,
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createTransport,
} from "./command-router-test-support";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";
import type { ScheduledDeliveryCapabilityOps, ScheduledRouterOps } from "../../../src/commands/router-types";
import type { CreateScheduledTaskInput } from "../../../src/scheduled/scheduled-service";
import type { AppState } from "../../../src/state/types";

function createMockScheduled(overrides?: Partial<ScheduledRouterOps>): ScheduledRouterOps {
  const tasks: ScheduledTaskRecord[] = [];
  return {
    createTask: mock(async (input: CreateScheduledTaskInput) => {
      const task: ScheduledTaskRecord = {
        id: "k8f2",
        chat_key: input.chatKey,
        session_alias: input.sessionAlias,
        execute_at: input.executeAt.toISOString(),
        message: input.message,
        status: "pending",
        created_at: "2026-05-23T10:00:00.000Z",
        ...(input.accountId ? { account_id: input.accountId } : {}),
        ...(input.replyContextToken ? { reply_context_token: input.replyContextToken } : {}),
      };
      tasks.push(task);
      return task;
    }),
    listPending: mock(() => tasks.filter((t) => t.status === "pending")),
    cancelPending: mock(async (id: string) => {
      const task = tasks.find((t) => t.id === id.replace(/^#/, "").toLowerCase());
      if (!task || task.status !== "pending") return false;
      task.status = "cancelled";
      return true;
    }),
    ...overrides,
  };
}

function buildRouter(opts?: { scheduled?: ScheduledRouterOps; scheduledDelivery?: ScheduledDeliveryCapabilityOps; state?: AppState }) {
  const config = createConfig();
  config.agents.codex = { driver: "codex" };
  config.workspaces.backend = { cwd: "/tmp/backend" };
  const state = opts?.state ?? createEmptyState();
  const sessions = new SessionService(config, new MemoryStateStore(), state);
  const transport = createTransport();
  const scheduled = opts?.scheduled;
  const scheduledDelivery = opts?.scheduledDelivery ?? (scheduled ? { supportsScheduledMessages: () => true } : undefined);
  const router = new CommandRouter(
    sessions,
    transport,
    config,
    new MemoryConfigStore(config),
    undefined,
    undefined,
    undefined,
    undefined,
    scheduled,
    scheduledDelivery,
  );
  return { router, transport, sessions, config, state };
}

test("/lt shows help", async () => {
  const { router } = buildRouter({ scheduled: createMockScheduled() });
  const reply = await router.handle("wx:user", "/lt");
  expect(reply.text).toContain("/lt in 2h");
  expect(reply.text).toContain("/lt list");
  expect(reply.text).toContain("/lt cancel");
});

test("/later shows help", async () => {
  const { router } = buildRouter({ scheduled: createMockScheduled() });
  const reply = await router.handle("wx:user", "/later");
  expect(reply.text).toContain("定时任务");
});

test("shows not-enabled message when scheduled service missing", async () => {
  const { router } = buildRouter();
  const reply = await router.handle("wx:user", "/lt");
  expect(reply.text).toContain("定时任务服务未启用");
});

test("/lt in 2h 检查 CI creates task bound to current session", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:backend:codex",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["wx:user"] = { current_session: "backend:codex" };
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt in 2h 检查 CI", undefined, "ctx-token", "acct-1");
  expect(reply.text).toContain("#k8f2");
  expect(reply.text).toContain("已创建定时任务");
  expect(scheduled.createTask).toHaveBeenCalledTimes(1);
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.chatKey).toBe("wx:user");
  expect(call.message).toBe("检查 CI");
  expect(call.accountId).toBe("acct-1");
  expect(call.replyContextToken).toBe("ctx-token");
  expect(call.sessionAlias).toBe("backend:codex");
});

test("/lt rejects creation when channel lacks scheduled-message support", async () => {
  const scheduled = createMockScheduled();
  const scheduledDelivery: ScheduledDeliveryCapabilityOps = {
    supportsScheduledMessages: mock(() => false),
  };
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:backend:codex",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["feishu:default:oc_chat123"] = { current_session: "backend:codex" };

  const { router } = buildRouter({ scheduled, scheduledDelivery, state });
  const reply = await router.handle("feishu:default:oc_chat123", "/lt in 2h 检查 CI", undefined, "om_message_1", "default");

  expect(reply.text).toContain("当前频道暂不支持定时任务");
  expect(reply.text).toContain("未创建任务");
  expect(scheduledDelivery.supportsScheduledMessages).toHaveBeenCalledWith("feishu:default:oc_chat123");
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/lt in 2h /status rejects command-looking message", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:backend:codex",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["wx:user"] = { current_session: "backend:codex" };
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt in 2h /status");
  expect(reply.text).toContain("不支持延迟执行");
  expect(reply.text).toContain("/lt in 1h 请解释 /status 的作用");
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});


test("/lt rejects unknown slash-looking messages", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:backend:codex",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["wx:user"] = { current_session: "backend:codex" };
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt in 2h /unknown arg");
  expect(reply.text).toContain("不支持延迟执行 / 开头的命令");
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/lt list renders pending tasks", async () => {
  const scheduled = createMockScheduled({
    listPending: mock(() => [
      {
        id: "k8f2",
        chat_key: "wx:user",
        session_alias: "weixin:backend-codex",
        execute_at: "2026-05-23T12:00:00.000Z",
        message: "检查 CI",
        status: "pending",
        created_at: "2026-05-23T10:00:00.000Z",
      },
    ]),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt list");
  expect(reply.text).toContain("待执行定时任务");
  expect(reply.text).toContain("#k8f2");
  expect(reply.text).toContain("检查 CI");
  expect(reply.text).toContain("会话：backend-codex");
  expect(reply.text).not.toContain("weixin:backend-codex");
});

test("/lt list renders empty when no tasks", async () => {
  const scheduled = createMockScheduled();
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt list");
  expect(reply.text).toContain("当前没有待执行定时任务");
});

test("/lt cancel #K8F2 cancels and renders success", async () => {
  const scheduled = createMockScheduled({
    cancelPending: mock(async () => true),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt cancel #K8F2");
  expect(reply.text).toContain("已取消");
  expect(reply.text).toContain("#k8f2");
  expect(scheduled.cancelPending).toHaveBeenCalledWith("#K8F2");
});

test("/lt cancel with not found renders not found", async () => {
  const scheduled = createMockScheduled({
    cancelPending: mock(async () => false),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt cancel #NOPE");
  expect(reply.text).toContain("未找到");
});

test("no current session create returns no-session guidance", async () => {
  const scheduled = createMockScheduled();
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt in 2h 检查 CI");
  expect(reply.text).toContain("当前没有会话");
  expect(reply.text).toContain("/ss codex");
  expect(reply.text).toContain("/use");
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/help later returns later help topic", async () => {
  const { router } = buildRouter({ scheduled: createMockScheduled() });
  const reply = await router.handle("wx:user", "/help later");
  expect(reply.text).toContain("定时任务");
  expect(reply.text).toContain("/lt");
});

test("scheduled prompt uses the bound session even after current session changes", async () => {
  const state = createEmptyState();
  state.sessions["weixin:bound"] = {
    alias: "weixin:bound",
    agent: "codex",
    workspace: "backend",
    transport_session: "transport-bound",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.sessions["weixin:current"] = {
    alias: "weixin:current",
    agent: "codex",
    workspace: "backend",
    transport_session: "transport-current",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["wx:user"] = { current_session: "weixin:current" };

  const { router, transport } = buildRouter({ scheduled: createMockScheduled(), state });
  const reply = await router.handle(
    "wx:user",
    "检查 CI",
    undefined,
    "ctx-token",
    "acct-1",
    undefined,
    { scheduledSessionAlias: "weixin:bound" },
  );

  expect(reply.text).toContain("agent:weixin:bound:检查 CI");
  expect(transport.prompt).toHaveBeenCalledTimes(1);
  const session = (transport.prompt as ReturnType<typeof mock>).mock.calls[0][0];
  expect(session.alias).toBe("weixin:bound");
  expect(session.transportSession).toBe("transport-bound");
});
