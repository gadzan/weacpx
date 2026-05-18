import { expect, test } from "bun:test";

import { buildWeacpxMcpToolRegistry } from "../../../src/mcp/weacpx-mcp-tools";
import { createMemoryTransport } from "../../../src/mcp/weacpx-mcp-transport";
import { QuotaDeferredError } from "../../../src/weixin/messaging/quota-errors";

test("builds 14 MCP tools and appends blocker-loop actions after the original orchestration tools", async () => {
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
      cancelTask: async () => {
        throw new Error("cancel not implemented");
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

  expect(registry).toHaveLength(14);
  expect(registry.map((tool) => tool.name)).toEqual([
    "delegate_request",
    "group_new",
    "group_get",
    "group_list",
    "group_cancel",
    "task_get",
    "task_list",
    "task_approve",
    "task_cancel",
    "task_watch",
    "worker_raise_question",
    "coordinator_answer_question",
    "coordinator_request_human_input",
    "coordinator_review_contested_result",
  ]);

  const delegateTool = registry.find((tool) => tool.name === "delegate_request");
  expect(delegateTool).toBeDefined();
  expect(delegateTool?.description).toContain("workingDirectory");
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
  const response = await delegateTool?.handler({
    targetAgent: "claude",
    task: "review",
    workingDirectory: "/repo/weacpx",
    role: "reviewer",
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
      sourceHandle: "backend:worker",
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    },
  ]);
  expect(response).toEqual({
    content: [
      {
        type: "text",
        text:
          "Delegation task \"task-9\" created.\n- Status: needs_confirmation\n"
          + "Next: this delegation requires user approval. "
          + "Tell the user, then call task_approve or task_cancel based on their response.",
      },
    ],
    structuredContent: { taskId: "task-9", status: "needs_confirmation" },
  });
  expect(workerResponse).toEqual({
    content: [{ type: "text", text: "Blocker question submitted for task \"task-1\".\n- questionId: question-1" }],
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
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
        coordinatorRequestHumanInput: async () => {
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
  // chatKey is an internal weixin routing identifier and intentionally not
  // surfaced to MCP hosts; only the deferred_quota status is exposed.
  expect(requestResult?.structuredContent).toEqual({
    status: "deferred_quota",
  });
  expect(requestResult?.content[0]).toMatchObject({ type: "text" });
  expect((requestResult?.content[0] as { text: string }).text).toContain("Outbound budget exhausted");
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

test("delegate_request running result appends a non-blocking Next hint", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-running", status: "running" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
      },
    ),
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });

  const delegate = registry.find((tool) => tool.name === "delegate_request");
  const result = await delegate?.handler({
    targetAgent: "opencode",
    task: "introduce yourself",
    workingDirectory: "/repo",
  });

  const text = (result?.content[0] as { text: string }).text;
  expect(text).toContain("Delegation task \"task-running\" created.");
  expect(text).toContain("- Status: running");
  expect(text).toContain("Next: task \"task-running\" is running.");
  expect(text).toContain("Return this taskId to the user");
  expect(text).toContain("task_get/task_list for non-blocking progress snapshots");
  expect(text).toContain("task_watch to long-poll for the next event or terminal state");
});

test("task_watch description states the native watcher is single-shot", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "running" })),
    coordinatorSession: "backend:main",
  });
  const taskWatch = registry.find((tool) => tool.name === "task_watch");
  expect(taskWatch?.description).toContain("single-shot");
  expect(taskWatch?.description).toContain("afterSeq set to the returned nextAfterSeq");
});

test("tool descriptions reference the next step in the lifecycle", () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "running" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("approve not implemented");
        },
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
      },
    ),
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });
  const byName = new Map(registry.map((tool) => [tool.name, tool]));

  expect(byName.get("delegate_request")?.description).toContain("task_get/task_list for non-blocking progress snapshots");
  expect(byName.get("delegate_request")?.description).toContain("task_watch to long-poll");
  expect(byName.get("task_watch")?.description).toContain("Long-poll a task");
  expect(byName.get("task_watch")?.description).toContain("single-shot");
  expect(byName.get("task_get")?.description).toContain("inspect a task snapshot non-blockingly");
  expect(byName.get("task_approve")?.description).toContain("needs_confirmation");
  expect(byName.get("coordinator_answer_question")?.description).toContain("task_get/task_list for snapshots");
  expect(byName.get("worker_raise_question")?.description).toContain("Worker-side only");
});

test("task_approve result text points the coordinator back to task_watch", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "needs_confirmation" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => ({ taskId: "task-approved", status: "running" }),
        cancelTask: async () => {
          throw new Error("cancel not implemented");
        },
      },
    ),
    coordinatorSession: "backend:main",
  });

  const approveTool = registry.find((tool) => tool.name === "task_approve");
  const text = (
    (await approveTool?.handler({ taskId: "task-approved" }))?.content[0] as { text: string }
  ).text;

  expect(text).toContain("Task \"task-approved\" approved.");
  expect(text).toContain("- Current status: running");
  expect(text).toContain("Next: use task_get/task_list for non-blocking progress snapshots");
  expect(text).toContain("task_watch to long-poll until the worker finishes");
});

test("registry hides human-input package tools when the coordinator is external", () => {
  const transport = createMemoryTransport(
    async () => ({ taskId: "task-1", status: "running" }),
    {
      getTask: async () => null,
      listTasks: async () => [],
      approveTask: async () => {
        throw new Error("approve not implemented");
      },
      cancelTask: async () => {
        throw new Error("cancel not implemented");
      },
    },
  );

  const externalRegistry = buildWeacpxMcpToolRegistry({
    transport,
    coordinatorSession: "external_claude-code:backend",
    isExternalCoordinator: true,
  });
  const externalNames = externalRegistry.map((tool) => tool.name);
  // coordinator_request_human_input hard-throws "human input routing is not configured for
  // external coordinator" in orchestration-service.ts. Don't advertise dead tools.
  expect(externalNames).not.toContain("coordinator_request_human_input");
  // Other coordinator-side tools must remain available — answering questions, reviewing
  // contested results, approving / rejecting / cancelling all work for external coordinators.
  expect(externalNames).toContain("delegate_request");
  expect(externalNames).toContain("task_watch");
  expect(externalNames).toContain("coordinator_answer_question");
  expect(externalNames).toContain("coordinator_review_contested_result");
  expect(externalRegistry).toHaveLength(13);

  const internalRegistry = buildWeacpxMcpToolRegistry({
    transport,
    coordinatorSession: "backend:main",
  });
  expect(internalRegistry).toHaveLength(14);
  expect(internalRegistry.map((tool) => tool.name)).toContain("coordinator_request_human_input");
});
