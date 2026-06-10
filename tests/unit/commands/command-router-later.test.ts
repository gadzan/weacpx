import { expect, mock, test, beforeAll } from "bun:test";
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
import type { ResolvedSession } from "../../../src/transport/types";
import { setLocale, t } from "../../../src/i18n";

beforeAll(() => {
  setLocale("zh");
});

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
        ...(input.sessionMode ? { session_mode: input.sessionMode } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
        ...(input.accountId ? { account_id: input.accountId } : {}),
        ...(input.replyContextToken ? { reply_context_token: input.replyContextToken } : {}),
      };
      tasks.push(task);
      return task;
    }),
    listPending: mock((chatKey: string) => tasks.filter((t) => t.status === "pending" && t.chat_key === chatKey)),
    cancelPending: mock(async (id: string, chatKey: string) => {
      const task = tasks.find((t) => t.id === id.replace(/^#/, "").toLowerCase());
      if (!task || task.status !== "pending" || task.chat_key !== chatKey) return false;
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
  expect(reply.text).toContain(t().scheduledRender.helpUsage);
});

test("shows not-enabled message when scheduled service missing", async () => {
  const { router } = buildRouter();
  const reply = await router.handle("wx:user", "/lt");
  expect(reply.text).toContain(t().later.serviceNotEnabled);
});

test("/lt in 2h 检查 CI creates a task recording the current session as origin", async () => {
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
  expect(reply.text).toContain(t().scheduledRender.taskCreated("k8f2"));
  expect(scheduled.createTask).toHaveBeenCalledTimes(1);
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.chatKey).toBe("wx:user");
  expect(call.message).toBe("检查 CI");
  expect(call.accountId).toBe("acct-1");
  expect(call.replyContextToken).toBe("ctx-token");
  expect(call.sessionAlias).toBe("backend:codex");
});

test("/lt stores the message verbatim — quotes and internal spacing intact", async () => {
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

  const cases: Array<{ input: string; message: string }> = [
    // Curly quotes from Chinese IMEs must not be stripped from the body.
    { input: "/later in 2h 提醒我看“报告”", message: "提醒我看“报告”" },
    // Straight quotes and a multi-space run survive.
    { input: '/lt in 2h remind me to say "hello"  twice', message: 'remind me to say "hello"  twice' },
    // A body that starts with a quoted word keeps its opening quote.
    { input: '/lt in 2h "hello world" now', message: '"hello world" now' },
    // A leading --temp flag is still consumed before the time spec.
    { input: "/lt --temp in 2h 检查＂版本＂号", message: "检查＂版本＂号" },
  ];

  for (const { input, message } of cases) {
    const scheduled = createMockScheduled();
    const { router } = buildRouter({ scheduled, state });
    await router.handle("wx:user", input);
    expect(scheduled.createTask).toHaveBeenCalledTimes(1);
    const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
    expect(call.message).toBe(message);
  }
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

  expect(reply.text).toContain(t().scheduledRender.unsupportedChannel);
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
  expect(reply.text).toContain(t().later.slashMessageRejected);
  expect(reply.text).toContain(t().later.slashMessageExample);
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
  expect(reply.text).toContain(t().later.slashMessageRejected);
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/lt list renders pending tasks scoped to the requesting chat", async () => {
  const scheduled = createMockScheduled({
    listPending: mock((chatKey: string) =>
      [
        {
          id: "k8f2",
          chat_key: "wx:user",
          session_alias: "weixin:backend-codex",
          execute_at: "2026-05-23T12:00:00.000Z",
          message: "检查 CI",
          status: "pending" as const,
          created_at: "2026-05-23T10:00:00.000Z",
        },
        {
          id: "z9y8",
          chat_key: "wx:other",
          session_alias: "weixin:backend-codex",
          execute_at: "2026-05-23T13:00:00.000Z",
          message: "别人的秘密任务",
          status: "pending" as const,
          created_at: "2026-05-23T10:00:00.000Z",
        },
      ].filter((task) => task.chat_key === chatKey)),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt list");
  expect(scheduled.listPending).toHaveBeenCalledWith("wx:user");
  expect(reply.text).toContain(t().scheduledRender.listHeader);
  expect(reply.text).toContain("#k8f2");
  expect(reply.text).toContain("检查 CI");
  expect(reply.text).toContain(t().scheduledRender.boundSession("backend-codex"));
  expect(reply.text).not.toContain("weixin:backend-codex");
  // Another chat's task never leaks into this chat's list.
  expect(reply.text).not.toContain("#z9y8");
  expect(reply.text).not.toContain("别人的秘密任务");
});

test("/lt list from another chat does not show this chat's tasks", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router } = buildRouter({ scheduled, state });
  await router.handle("wx:user", "/lt in 2h 检查 CI");

  const replyOther = await router.handle("wx:intruder", "/lt list");
  expect(scheduled.listPending).toHaveBeenLastCalledWith("wx:intruder");
  expect(replyOther.text).toContain(t().scheduledRender.listEmpty);
  expect(replyOther.text).not.toContain("#k8f2");

  const replyOwner = await router.handle("wx:user", "/lt list");
  expect(replyOwner.text).toContain("#k8f2");
});

test("/lt list renders empty when no tasks", async () => {
  const scheduled = createMockScheduled();
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt list");
  expect(reply.text).toContain(t().scheduledRender.listEmpty);
});

test("/lt cancel #K8F2 cancels and renders success", async () => {
  const scheduled = createMockScheduled({
    cancelPending: mock(async () => true),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt cancel #K8F2");
  expect(reply.text).toContain(t().later.cancelSuccess("k8f2"));
  expect(scheduled.cancelPending).toHaveBeenCalledWith("#K8F2", "wx:user");
});

test("/lt cancel from another chat renders not found and leaves the task pending", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router } = buildRouter({ scheduled, state });
  await router.handle("wx:user", "/lt in 2h 检查 CI");

  const replyIntruder = await router.handle("wx:intruder", "/lt cancel #k8f2");
  expect(scheduled.cancelPending).toHaveBeenLastCalledWith("#k8f2", "wx:intruder");
  expect(replyIntruder.text).toContain(t().later.cancelNotFound("k8f2"));

  // The owner can still see and cancel the task afterwards.
  const replyOwner = await router.handle("wx:user", "/lt cancel #k8f2");
  expect(replyOwner.text).toContain(t().later.cancelSuccess("k8f2"));
});

test("/lt cancel with not found renders not found", async () => {
  const scheduled = createMockScheduled({
    cancelPending: mock(async () => false),
  });
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt cancel #NOPE");
  expect(reply.text).toContain(t().later.cancelNotFound("nope"));
});

test("no current session create returns no-session guidance", async () => {
  const scheduled = createMockScheduled();
  const { router } = buildRouter({ scheduled });
  const reply = await router.handle("wx:user", "/lt in 2h 检查 CI");
  expect(reply.text).toContain(t().later.noSession);
  expect(reply.text).toContain(t().later.noSessionExampleNew);
  expect(reply.text).toContain(t().later.noSessionExampleUse);
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/help later returns later help topic", async () => {
  const { router } = buildRouter({ scheduled: createMockScheduled() });
  const reply = await router.handle("wx:user", "/help later");
  expect(reply.text).toContain(t().later.helpSummary);
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

function seedCurrentSession(state: ReturnType<typeof createEmptyState>) {
  state.sessions["backend:codex"] = {
    alias: "backend:codex",
    agent: "codex",
    workspace: "backend",
    transport_session: "backend:backend:codex",
    created_at: "2026-05-23T09:00:00.000Z",
    last_used_at: "2026-05-23T09:00:00.000Z",
  };
  state.chat_contexts["wx:user"] = { current_session: "backend:codex" };
}

test("/lt defaults to a temp task snapshotting current agent/workspace", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt in 2h 检查 CI");
  expect(reply.text).toContain(t().scheduledRender.tempSession("backend", "codex"));
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.sessionMode).toBe("temp");
  expect(call.agent).toBe("codex");
  expect(call.workspace).toBe("backend");
  expect(call.sessionAlias).toBe("backend:codex");
});

test("/lt --bind creates a bound task without agent/workspace snapshot", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt --bind in 2h 检查 CI");
  expect(reply.text).toContain(t().scheduledRender.boundSession("backend:codex"));
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.sessionMode).toBe("bound");
  expect(call.agent).toBeUndefined();
  expect(call.workspace).toBeUndefined();
  expect(call.message).toBe("检查 CI");
});

test("/lt --bind --temp is rejected as mutually exclusive", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router } = buildRouter({ scheduled, state });
  const reply = await router.handle("wx:user", "/lt --bind --temp in 2h 检查 CI");
  expect(reply.text).toContain(t().later.bindAndTempMutuallyExclusive);
  expect(scheduled.createTask).toHaveBeenCalledTimes(0);
});

test("/lt honors later.defaultMode = bind from config", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router, config } = buildRouter({ scheduled, state });
  config.later = { defaultMode: "bind" };
  const reply = await router.handle("wx:user", "/lt in 2h 检查 CI");
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.sessionMode).toBe("bound");
  expect(reply.text).toContain(t().scheduledRender.boundSession("backend:codex"));
});

test("/lt --temp overrides config defaultMode = bind", async () => {
  const scheduled = createMockScheduled();
  const state = createEmptyState();
  seedCurrentSession(state);
  const { router, config } = buildRouter({ scheduled, state });
  config.later = { defaultMode: "bind" };
  await router.handle("wx:user", "/lt --temp in 2h 检查 CI");
  const call = (scheduled.createTask as ReturnType<typeof mock>).mock.calls[0][0] as CreateScheduledTaskInput;
  expect(call.sessionMode).toBe("temp");
  expect(call.agent).toBe("codex");
});

test("routes a scheduled prompt into a transient session via descriptor", async () => {
  const state = createEmptyState();
  const { router, transport } = buildRouter({ state });
  await router.handle(
    "wx:user",
    "检查 CI",
    undefined,
    undefined,
    undefined,
    undefined,
    {
      channel: "weixin",
      scheduledSessionDescriptor: {
        alias: "later-k8f2",
        agent: "codex",
        workspace: "backend",
        transportSession: "backend:later-k8f2",
      },
    },
  );

  const promptMock = transport.prompt as ReturnType<typeof mock>;
  expect(promptMock).toHaveBeenCalledTimes(1);
  const sessionArg = promptMock.mock.calls[0][0] as ResolvedSession;
  expect(sessionArg.alias).toBe("later-k8f2");
  expect(sessionArg.transportSession).toBe("backend:later-k8f2");
  expect(sessionArg.transient).toBe(true);
});
