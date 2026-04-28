import { expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

import { resolveOrchestrationEndpoint } from "../../../src/orchestration/orchestration-ipc";
import { OrchestrationServer } from "../../../src/orchestration/orchestration-server";

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
    requestDelegate: async () => ({ taskId: "task-1", status: "needs_confirmation" }),
    getTask: async () => null,
    listTasks: async () => [],
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

test("forwards supported orchestration RPC methods to handlers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-orch-server-"));
  const endpoint = resolveOrchestrationEndpoint(dir);
  const requestDelegate = mock(async (input: Record<string, unknown>) => ({
    taskId: "task-1",
    status: "needs_confirmation",
    input,
  }));
  const getTask = mock(async (taskId: string) => ({ taskId, status: "running" }));
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
        params: { taskId: "task-1" },
      }),
    ).resolves.toEqual({
      id: "req-2",
      ok: true,
      result: { taskId: "task-1", status: "running" },
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
        params: {},
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
