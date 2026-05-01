import { expect, test } from "bun:test";

import { buildWeacpxMcpToolRegistry } from "../../../src/mcp/weacpx-mcp-tools";
import { createMemoryTransport } from "../../../src/mcp/weacpx-mcp-transport";
import { QuotaDeferredError } from "../../../src/weixin/messaging/quota-errors";

test("builds 16 MCP tools and appends blocker-loop actions after the original orchestration tools", async () => {
  const calls: unknown[] = [];
  const transport = createMemoryTransport(
    async (input) => {
      calls.push(input);
      return { taskId: "task-9", status: "needs_confirmation" };
    },
    {
      getTask: async () => null,
      listTasks: async () => [],
      approveTask: async () => {
        throw new Error("approve not implemented");
      },
      rejectTask: async () => {
        throw new Error("reject not implemented");
      },
      cancelTask: async () => {
        throw new Error("cancel not implemented");
      },
      waitTask: async (input) => {
        calls.push(input);
        return { status: "timeout", task: null };
      },
      workerRaiseQuestion: async (input) => {
        calls.push(input);
        return { taskId: "task-1", questionId: "question-1", status: "blocked" };
      },
    },
  );

  const registry = buildWeacpxMcpToolRegistry({
    transport,
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });

  expect(registry).toHaveLength(16);
  expect(registry.map((tool) => tool.name)).toEqual([
    "delegate_request",
    "group_new",
    "group_get",
    "group_list",
    "group_cancel",
    "task_get",
    "task_list",
    "task_approve",
    "task_reject",
    "task_cancel",
    "task_wait",
    "worker_raise_question",
    "coordinator_answer_question",
    "coordinator_request_human_input",
    "coordinator_follow_up_human_package",
    "coordinator_review_contested_result",
  ]);

  const delegateTool = registry.find((tool) => tool.name === "delegate_request");
  expect(delegateTool).toBeDefined();
  expect(
    delegateTool?.inputSchema.safeParse({
      sourceHandle: "spoofed",
      targetAgent: "claude",
      task: "review",
    }).success,
  ).toBe(false);
  expect(
    delegateTool?.inputSchema.safeParse({
      coordinatorSession: "spoofed",
      targetAgent: "claude",
      task: "review",
      workingDirectory: "/repo/weacpx",
    }).success,
  ).toBe(false);
  const workerRaiseQuestionTool = registry.find((tool) => tool.name === "worker_raise_question");
  expect(workerRaiseQuestionTool).toBeDefined();
  expect(
    workerRaiseQuestionTool?.inputSchema.safeParse({
      coordinatorSession: "spoofed",
      sourceHandle: "spoofed",
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    }).success,
  ).toBe(false);
  const taskListTool = registry.find((tool) => tool.name === "task_list");
  expect(taskListTool).toBeDefined();
  expect(taskListTool?.inputSchema.safeParse({ status: "blocked" }).success).toBe(true);
  expect(taskListTool?.inputSchema.safeParse({ status: "waiting_for_human" }).success).toBe(true);
  const taskWaitTool = registry.find((tool) => tool.name === "task_wait");
  expect(taskWaitTool).toBeDefined();
  expect(taskWaitTool?.inputSchema.safeParse({ taskId: "task-1", timeoutMs: 1000, pollIntervalMs: 50 }).success).toBe(true);
  expect(taskWaitTool?.inputSchema.safeParse({ taskId: "task-1", timeoutMs: 1_200_000 }).success).toBe(true);
  expect(taskWaitTool?.inputSchema.safeParse({ taskId: "task-1", timeoutMs: 1_200_001 }).success).toBe(false);

  const response = await delegateTool?.handler({
    targetAgent: "claude",
    task: "review",
    workingDirectory: "/repo/weacpx",
    role: "reviewer",
  });
  const waitResponse = await taskWaitTool?.handler({
    taskId: "task-1",
    timeoutMs: 1000,
    pollIntervalMs: 50,
  });
  const workerResponse = await workerRaiseQuestionTool?.handler({
    taskId: "task-1",
    question: "Need environment details",
    whyBlocked: "Requirement is ambiguous",
    whatIsNeeded: "Clarify the target environment",
  });

  expect(calls).toEqual([
    {
      coordinatorSession: "backend:main",
      sourceHandle: "backend:worker",
      targetAgent: "claude",
      task: "review",
      workingDirectory: "/repo/weacpx",
      role: "reviewer",
    },
    {
      coordinatorSession: "backend:main",
      taskId: "task-1",
      timeoutMs: 1000,
      pollIntervalMs: 50,
    },
    {
      sourceHandle: "backend:worker",
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    },
  ]);
  expect(response).toEqual({
    content: [{ type: "text", text: "Delegation task task-9 is needs_confirmation." }],
    structuredContent: { taskId: "task-9", status: "needs_confirmation" },
  });
  expect(waitResponse).toEqual({
    content: [{ type: "text", text: "Task wait timeout; current state is unavailable." }],
    structuredContent: { status: "timeout", task: null },
  });
  expect(workerResponse).toEqual({
    content: [{ type: "text", text: "任务「task-1」已提交 blocker 问题。\n- questionId：question-1" }],
    structuredContent: { taskId: "task-1", questionId: "question-1", status: "blocked" },
  });
});

test("worker_raise_question fails clearly when no host sourceHandle is bound", async () => {
  const calls: unknown[] = [];
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "needs_confirmation" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        rejectTask: async () => {
          throw new Error("reject not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
        workerRaiseQuestion: async (input) => {
          calls.push(input);
          return { taskId: "task-1", questionId: "question-1", status: "blocked" };
        },
      },
    ),
    coordinatorSession: "backend:main",
  });

  const workerRaiseQuestionTool = registry.find((tool) => tool.name === "worker_raise_question");
  const result = await workerRaiseQuestionTool?.handler({
    taskId: "task-1",
    question: "Need environment details",
    whyBlocked: "Requirement is ambiguous",
    whatIsNeeded: "Clarify the target environment",
  });

  expect(calls).toEqual([]);
  expect(result).toEqual({
    isError: true,
    content: [
      {
        type: "text",
        text: "worker_raise_question requires a bound sourceHandle; start mcp-stdio with --source-handle or WEACPX_SOURCE_HANDLE",
      },
    ],
  });
});

test("QuotaDeferredError from coordinator_request_human_input becomes a soft deferred_quota result", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "needs_confirmation" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        rejectTask: async () => {
          throw new Error("reject not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
        coordinatorRequestHumanInput: async () => {
          throw new QuotaDeferredError({ chatKey: "wx:user-deferred", reason: "exhausted" });
        },
        coordinatorFollowUpHumanPackage: async () => {
          throw new QuotaDeferredError({ chatKey: "wx:user-deferred", reason: "exhausted" });
        },
      },
    ),
    coordinatorSession: "backend:main",
  });

  const requestTool = registry.find((tool) => tool.name === "coordinator_request_human_input");
  const requestResult = await requestTool?.handler({
    taskQuestions: [{ taskId: "task-1", questionId: "q-1" }],
    promptText: "需要您的判断",
  });

  expect(requestResult?.isError).toBe(false);
  expect(requestResult?.structuredContent).toEqual({
    status: "deferred_quota",
    chatKey: "wx:user-deferred",
  });
  expect(requestResult?.content[0]).toMatchObject({ type: "text" });
  expect((requestResult?.content[0] as { text: string }).text).toContain("Outbound budget exhausted");

  const followUpTool = registry.find((tool) => tool.name === "coordinator_follow_up_human_package");
  const followUpResult = await followUpTool?.handler({
    packageId: "pkg-1",
    priorMessageId: "msg-1",
    taskQuestions: [{ taskId: "task-1", questionId: "q-1" }],
    promptText: "follow-up",
  });
  expect(followUpResult?.isError).toBe(false);
  expect(followUpResult?.structuredContent).toEqual({
    status: "deferred_quota",
    chatKey: "wx:user-deferred",
  });
});

test("generic Error remains a hard error result (backward compatible)", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => {
        throw new Error("rpc blew up");
      },
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        rejectTask: async () => {
          throw new Error("reject not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
      },
    ),
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });

  const delegateTool = registry.find((tool) => tool.name === "delegate_request");
  const result = await delegateTool?.handler({
    targetAgent: "claude",
    task: "review",
  });

  expect(result?.isError).toBe(true);
  expect((result?.content[0] as { text: string }).text).toContain("rpc blew up");
});

test("task_get renders not-found as text plus structured null wrapper", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "needs_confirmation" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        rejectTask: async () => {
          throw new Error("reject not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
      },
    ),
    coordinatorSession: "backend:main",
  });

  const taskGet = registry.find((tool) => tool.name === "task_get");
  const result = await taskGet?.handler({ taskId: "task-missing" });

  expect(result).toEqual({
    content: [{ type: "text", text: "Task not found." }],
    structuredContent: { task: null },
  });
});
