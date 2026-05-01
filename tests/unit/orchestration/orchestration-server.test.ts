import { expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

import { resolveOrchestrationEndpoint } from "../../../src/orchestration/orchestration-ipc";
import { OrchestrationServer } from "../../../src/orchestration/orchestration-server";
import { skipIfLocalIpcUnavailable } from "../../helpers/ipc-capability";

async function sendRequest(endpointPath: string, request: Record<string, unknown>) {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(endpointPath);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = buffer.slice(0, newlineIndex);
      socket.end();
      resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}

function makeServerHandlers(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    registerExternalCoordinator: async (input: Record<string, unknown>) => ({
      coordinatorSession: input.coordinatorSession,
      workspace: input.workspace,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    }),
    requestDelegate: async () => ({ taskId: "task-1", status: "needs_confirmation" }),
    getTask: async () => null,
    listTasks: async () => [],
    waitTask: async (input: Record<string, unknown>) => ({ status: "timeout", task: { taskId: input.taskId, status: "running" } }),
    approveTask: async (input: Record<string, unknown>) => ({
      taskId: input.taskId,
      coordinatorSession: input.coordinatorSession,
      status: "running",
    }),
    rejectTask: async (input: Record<string, unknown>) => ({
      taskId: input.taskId,
      coordinatorSession: input.coordinatorSession,
      status: "cancelled",
      summary: "rejected",
    }),
    cancelTask: async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "cancelled" }),
    recordWorkerReply: async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "completed" }),
    workerRaiseQuestion: async () => ({ taskId: "task-1", questionId: "question-1", status: "blocked" }),
    coordinatorAnswerQuestion: async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "running" }),
    coordinatorRetractAnswer: async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "waiting_for_human" }),
    coordinatorRequestHumanInput: async () => ({ packageId: "pkg-1", queuedTaskIds: [] }),
    coordinatorFollowUpHumanPackage: async () => ({ packageId: "pkg-1", messageId: "msg-1" }),
    coordinatorReviewContestedResult: async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "completed" }),
    createGroup: async () => ({
      groupId: "g-1",
      coordinatorSession: "backend:main",
      title: "review batch",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }),
    getGroupSummary: async () => null,
    listGroupSummaries: async () => [],
    cancelGroup: async () => ({
      summary: {
        group: {
          groupId: "g-1",
          coordinatorSession: "backend:main",
          title: "review batch",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        tasks: [],
        totalTasks: 0,
        pendingApprovalTasks: 0,
        runningTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        cancelledTasks: 0,
        terminal: true,
      },
      cancelledTaskIds: [],
      skippedTaskIds: [],
    }),
    ...overrides,
  } as unknown as ConstructorParameters<typeof OrchestrationServer>[1];
}



test("forwards task wait RPC to handlers", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const waitTask = mock(async (input: Record<string, unknown>) => ({
    status: "timeout",
    task: { taskId: input.taskId, status: "running" },
  }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ waitTask }));

  await expect(
    server.handleLine(JSON.stringify({
      id: "req-task-wait",
      method: "task.wait",
      params: {
        coordinatorSession: "backend:main",
        taskId: "task-1",
        timeoutMs: 1_200_000,
        pollIntervalMs: 50,
      },
    })),
  ).resolves.toBe(`${JSON.stringify({
    id: "req-task-wait",
    ok: true,
    result: { status: "timeout", task: { taskId: "task-1", status: "running" } },
  })}\n`);

  expect(waitTask).toHaveBeenCalledWith({
    coordinatorSession: "backend:main",
    taskId: "task-1",
    timeoutMs: 1_200_000,
    pollIntervalMs: 50,
  });
});

test("rejects malformed task wait option ranges before dispatch", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const waitTask = mock(async (input: Record<string, unknown>) => ({
    status: "timeout",
    task: { taskId: input.taskId, status: "running" },
  }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ waitTask }));

  for (const params of [
    { timeoutMs: -1 },
    { timeoutMs: 1_200_001 },
    { timeoutMs: 1.5 },
    { pollIntervalMs: 0 },
    { pollIntervalMs: 10_001 },
    { pollIntervalMs: 1.5 },
  ]) {
    const response = JSON.parse(await server.handleLine(JSON.stringify({
      id: "req-bad-wait",
      method: "task.wait",
      params: {
        coordinatorSession: "backend:main",
        taskId: "task-1",
        ...params,
      },
    })));

    expect(response).toMatchObject({
      id: "req-bad-wait",
      ok: false,
      error: { code: "ORCHESTRATION_INVALID_REQUEST" },
    });
  }

  expect(waitTask).not.toHaveBeenCalled();
});

test("forwards coordinator answer retraction RPC to handlers", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const coordinatorRetractAnswer = mock(async (input: Record<string, unknown>) => ({
    taskId: input.taskId,
    questionId: input.questionId,
    status: "waiting_for_human",
  }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ coordinatorRetractAnswer }));

  await expect(
    server.handleLine(JSON.stringify({
      id: "req-retract",
      method: "coordinator.retract_answer",
      params: {
        coordinatorSession: "backend:main",
        taskId: "task-1",
        questionId: "question-1",
      },
    })),
  ).resolves.toBe(`${JSON.stringify({
    id: "req-retract",
    ok: true,
    result: { taskId: "task-1", questionId: "question-1", status: "waiting_for_human" },
  })}\n`);

  expect(coordinatorRetractAnswer).toHaveBeenCalledWith({
    coordinatorSession: "backend:main",
    taskId: "task-1",
    questionId: "question-1",
  });
});

test("forwards external coordinator registration RPC to handlers", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const registerExternalCoordinator = mock(async (input: Record<string, unknown>) => ({
    coordinatorSession: input.coordinatorSession,
    workspace: input.workspace,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ registerExternalCoordinator }));

  await expect(
    server.handleLine(JSON.stringify({
      id: "req-register-external",
      method: "coordinator.register_external",
      params: {
        coordinatorSession: "codex:backend",
        workspace: "backend",
      },
    })),
  ).resolves.toBe(`${JSON.stringify({
    id: "req-register-external",
    ok: true,
    result: {
      coordinatorSession: "codex:backend",
      workspace: "backend",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    },
  })}\n`);

  expect(registerExternalCoordinator).toHaveBeenCalledWith({
    coordinatorSession: "codex:backend",
    workspace: "backend",
  });
});

test("task get and list require coordinator-scoped filters", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const server = new OrchestrationServer(endpoint, makeServerHandlers());

  for (const request of [
    { id: "req-get", method: "task.get", params: { taskId: "task-1" } },
    { id: "req-list", method: "task.list", params: {} },
    { id: "req-list-filter", method: "task.list", params: { filter: { status: "running" } } },
  ]) {
    const response = JSON.parse(await server.handleLine(JSON.stringify(request)));
    expect(response).toMatchObject({
      id: request.id,
      ok: false,
      error: { code: "ORCHESTRATION_INVALID_REQUEST" },
    });
  }
});

test("rejects malformed task list filters before dispatch", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const listTasks = mock(async () => []);
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ listTasks }));

  for (const filter of [
    { coordinatorSession: "backend:main", status: "bogus" },
    { coordinatorSession: "backend:main", stuck: "false" },
    { coordinatorSession: "backend:main", sort: "bogus" },
    { coordinatorSession: "backend:main", order: "bogus" },
    { coordinatorSession: "backend:main", targetAgent: "claude" },
  ]) {
    const response = JSON.parse(await server.handleLine(JSON.stringify({
      id: "req-bad-list",
      method: "task.list",
      params: { filter },
    })));
    expect(response).toMatchObject({
      id: "req-bad-list",
      ok: false,
      error: { code: "ORCHESTRATION_INVALID_REQUEST" },
    });
  }

  const response = JSON.parse(await server.handleLine(JSON.stringify({
    id: "req-bad-list-top",
    method: "task.list",
    params: { filter: { coordinatorSession: "backend:main" }, targetAgent: "claude" },
  })));
  expect(response).toMatchObject({
    id: "req-bad-list-top",
    ok: false,
    error: { code: "ORCHESTRATION_INVALID_REQUEST" },
  });

  expect(listTasks).not.toHaveBeenCalled();
});

test("rejects malformed raw params for delegate cancel and worker reply before dispatch", async () => {
  const endpoint = resolveOrchestrationEndpoint("/tmp/weacpx-orch-server-test");
  const requestDelegate = mock(async () => ({ taskId: "task-1", status: "needs_confirmation" }));
  const cancelTask = mock(async () => ({ taskId: "task-1", status: "cancelled" }));
  const recordWorkerReply = mock(async () => ({ taskId: "task-1", status: "completed" }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({
    requestDelegate,
    cancelTask,
    recordWorkerReply,
  }));

  for (const request of [
    { id: "req-delegate", method: "delegate.request", params: { sourceHandle: "backend:main", task: "review" } },
    {
      id: "req-delegate-extra",
      method: "delegate.request",
      params: { sourceHandle: "backend:main", targetAgent: "claude", task: "review", coordinatorSession: "spoof" },
    },
    { id: "req-cancel", method: "task.cancel", params: { taskId: "task-1" } },
    {
      id: "req-cancel-extra",
      method: "task.cancel",
      params: { taskId: "task-1", coordinatorSession: "backend:main", workspace: "backend" },
    },
    { id: "req-reply", method: "worker.reply", params: { taskId: "task-1", sourceHandle: "worker-1", status: "running" } },
    {
      id: "req-reply-extra",
      method: "worker.reply",
      params: { taskId: "task-1", sourceHandle: "worker-1", resultText: "done", coordinatorSession: "spoof" },
    },
  ]) {
    const response = JSON.parse(await server.handleLine(JSON.stringify(request)));
    expect(response).toMatchObject({
      id: request.id,
      ok: false,
      error: { code: "ORCHESTRATION_INVALID_REQUEST" },
    });
  }

  expect(requestDelegate).not.toHaveBeenCalled();
  expect(cancelTask).not.toHaveBeenCalled();
  expect(recordWorkerReply).not.toHaveBeenCalled();
});

test("forwards supported orchestration RPC methods to handlers", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const requestDelegate = mock(async (input: Record<string, unknown>) => ({
    taskId: "task-1",
    status: "needs_confirmation",
    input,
  }));
  const getTask = mock(async (taskId: string) => ({ taskId, status: "running", coordinatorSession: "backend:main" }));
  const listTasks = mock(async (filter?: Record<string, unknown>) => [{ taskId: "task-1", filter }]);
  const approveTask = mock(async (input: Record<string, unknown>) => ({
    taskId: input.taskId,
    coordinatorSession: input.coordinatorSession,
    status: "running",
  }));
  const rejectTask = mock(async (input: Record<string, unknown>) => ({
    taskId: input.taskId,
    coordinatorSession: input.coordinatorSession,
    status: "cancelled",
    summary: "rejected",
  }));
  const cancelTask = mock(async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "cancelled" }));
  const recordWorkerReply = mock(async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "completed" }));
  const server = new OrchestrationServer(
    endpoint,
    makeServerHandlers({
      requestDelegate,
      getTask,
      listTasks,
      approveTask,
      rejectTask,
      cancelTask,
      recordWorkerReply,
    }),
  );

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-1",
        method: "delegate.request",
        params: {
          sourceHandle: "backend:main",
          targetAgent: "claude",
          task: "review",
        },
      }),
    ).resolves.toEqual({
      id: "req-1",
      ok: true,
      result: {
        taskId: "task-1",
        status: "needs_confirmation",
        input: {
          sourceHandle: "backend:main",
          targetAgent: "claude",
          task: "review",
        },
      },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-2",
        method: "task.get",
        params: { taskId: "task-1", coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-2",
      ok: true,
      result: { taskId: "task-1", status: "running", coordinatorSession: "backend:main" },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-3",
        method: "task.list",
        params: { filter: { coordinatorSession: "backend:main" } },
      }),
    ).resolves.toEqual({
      id: "req-3",
      ok: true,
      result: [{ taskId: "task-1", filter: { coordinatorSession: "backend:main" } }],
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-4",
        method: "task.cancel",
        params: { taskId: "task-1", sourceHandle: "wx:user" },
      }),
    ).resolves.toEqual({
      id: "req-4",
      ok: true,
      result: { taskId: "task-1", status: "cancelled" },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-4b",
        method: "task.approve",
        params: { taskId: "task-1", coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-4b",
      ok: true,
      result: { taskId: "task-1", coordinatorSession: "backend:main", status: "running" },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-4c",
        method: "task.reject",
        params: { taskId: "task-1", coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-4c",
      ok: true,
      result: {
        taskId: "task-1",
        coordinatorSession: "backend:main",
        status: "cancelled",
        summary: "rejected",
      },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-5",
        method: "worker.reply",
        params: { taskId: "task-1", sourceHandle: "worker-1", resultText: "done" },
      }),
    ).resolves.toEqual({
      id: "req-5",
      ok: true,
      result: { accepted: true },
    });

    expect(requestDelegate).toHaveBeenCalledWith({
      sourceHandle: "backend:main",
      targetAgent: "claude",
      task: "review",
    });
    expect(getTask).toHaveBeenCalledWith("task-1");
    expect(listTasks).toHaveBeenCalledWith({ coordinatorSession: "backend:main" });
    expect(approveTask).toHaveBeenCalledWith({ taskId: "task-1", coordinatorSession: "backend:main" });
    expect(rejectTask).toHaveBeenCalledWith({ taskId: "task-1", coordinatorSession: "backend:main" });
    expect(cancelTask).toHaveBeenCalledWith({ taskId: "task-1", sourceHandle: "wx:user" });
    expect(recordWorkerReply).toHaveBeenCalledWith({
      taskId: "task-1",
      sourceHandle: "worker-1",
      resultText: "done",
    });
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("task.cancel forwards coordinator ownership when provided", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const cancelTask = mock(async (input: Record<string, unknown>) => ({ taskId: input.taskId, status: "cancelled" }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ cancelTask }));

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-cancel-coordinator",
        method: "task.cancel",
        params: { taskId: "task-1", coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-cancel-coordinator",
      ok: true,
      result: { taskId: "task-1", status: "cancelled" },
    });

    expect(cancelTask).toHaveBeenCalledWith({
      taskId: "task-1",
      coordinatorSession: "backend:main",
    });
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("task.get returns null when coordinator ownership does not match", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const getTask = mock(async (taskId: string) => ({
    taskId,
    coordinatorSession: "backend:other",
    status: "running",
  }));
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ getTask }));

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-get-mismatch",
        method: "task.get",
        params: { taskId: "task-1", coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-get-mismatch",
      ok: true,
      result: null,
    });

    expect(getTask).toHaveBeenCalledWith("task-1");
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects malformed task.list filters instead of widening the request", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const server = new OrchestrationServer(endpoint, makeServerHandlers({ listTasks: mock(async () => []) }));

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-bad-filter",
        method: "task.list",
        params: { filter: "bad-filter" },
      }),
    ).resolves.toEqual({
      id: "req-bad-filter",
      ok: false,
      error: {
        code: "ORCHESTRATION_INVALID_REQUEST",
        message: "filter must be an object when provided",
      },
    });
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleans up stale unix sockets on start and stop", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  if (process.platform === "win32") {
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const server = new OrchestrationServer(endpoint, makeServerHandlers());

  try {
    await writeFile(endpoint.path, "stale");
    await server.start();
    await expect(
      sendRequest(endpoint.path, {
        id: "req-stale",
        method: "task.list",
        params: { filter: { coordinatorSession: "backend:main" } },
      }),
    ).resolves.toEqual({
      id: "req-stale",
      ok: true,
      result: [],
    });

    await server.stop();
    await expect(writeFile(endpoint.path, "fresh")).resolves.toBeUndefined();
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses to start when a live unix socket listener already owns the path", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  if (process.platform === "win32") {
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const first = new OrchestrationServer(endpoint, makeServerHandlers());
  const second = new OrchestrationServer(endpoint, makeServerHandlers());

  try {
    await first.start();
    await expect(second.start()).rejects.toThrow(`orchestration endpoint is already in use: ${endpoint.path}`);
  } finally {
    await second.stop();
    await first.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("forwards group lifecycle RPC methods to handlers", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const groupRecord = {
    groupId: "g-1",
    coordinatorSession: "backend:main",
    title: "parallel review",
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
  const summary = {
    group: groupRecord,
    tasks: [],
    totalTasks: 0,
    pendingApprovalTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    terminal: true,
  };
  const createGroup = mock(async () => groupRecord);
  const getGroupSummary = mock(async () => summary);
  const listGroupSummaries = mock(async (input: Record<string, unknown>) => [summary]);
  const cancelGroup = mock(async () => ({
    summary,
    cancelledTaskIds: ["task-1"],
    skippedTaskIds: ["task-2"],
  }));
  const server = new OrchestrationServer(
    endpoint,
    makeServerHandlers({ createGroup, getGroupSummary, listGroupSummaries, cancelGroup }),
  );

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-new",
        method: "group.new",
        params: { coordinatorSession: "backend:main", title: "parallel review" },
      }),
    ).resolves.toEqual({ id: "req-group-new", ok: true, result: groupRecord });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-get",
        method: "group.get",
        params: { coordinatorSession: "backend:main", groupId: "g-1" },
      }),
    ).resolves.toEqual({ id: "req-group-get", ok: true, result: summary });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-list",
        method: "group.list",
        params: {
          coordinatorSession: "backend:main",
          status: "running",
          stuck: true,
          sort: "createdAt",
          order: "asc",
        },
      }),
    ).resolves.toEqual({ id: "req-group-list", ok: true, result: [summary] });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-cancel",
        method: "group.cancel",
        params: { coordinatorSession: "backend:main", groupId: "g-1" },
      }),
    ).resolves.toEqual({
      id: "req-group-cancel",
      ok: true,
      result: { summary, cancelledTaskIds: ["task-1"], skippedTaskIds: ["task-2"] },
    });

    expect(createGroup).toHaveBeenCalledWith({ coordinatorSession: "backend:main", title: "parallel review" });
    expect(getGroupSummary).toHaveBeenCalledWith({ coordinatorSession: "backend:main", groupId: "g-1" });
    expect(listGroupSummaries).toHaveBeenCalledWith({
      coordinatorSession: "backend:main",
      status: "running",
      stuck: true,
      sort: "createdAt",
      order: "asc",
    });
    expect(cancelGroup).toHaveBeenCalledWith({ coordinatorSession: "backend:main", groupId: "g-1" });
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("group RPC methods reject missing required params", async () => {
  // Requires node:net listen; sandboxed runners may deny local IPC with EPERM.
  if (await skipIfLocalIpcUnavailable("orchestration-server socket integration tests")) return;

  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const server = new OrchestrationServer(endpoint, makeServerHandlers());

  try {
    await server.start();

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-new-bad",
        method: "group.new",
        params: { coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-group-new-bad",
      ok: false,
      error: { code: "ORCHESTRATION_INVALID_REQUEST", message: "title must be a non-empty string" },
    });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-group-get-bad",
        method: "group.get",
        params: { coordinatorSession: "backend:main" },
      }),
    ).resolves.toEqual({
      id: "req-group-get-bad",
      ok: false,
        error: { code: "ORCHESTRATION_INVALID_REQUEST", message: "groupId must be a non-empty string" },
      });

    await expect(
      sendRequest(endpoint.path, {
        id: "req-task-approve-bad",
        method: "task.approve",
        params: { taskId: "task-1" },
      }),
    ).resolves.toEqual({
      id: "req-task-approve-bad",
      ok: false,
      error: {
        code: "ORCHESTRATION_INVALID_REQUEST",
        message: "coordinatorSession must be a non-empty string",
      },
    });
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
