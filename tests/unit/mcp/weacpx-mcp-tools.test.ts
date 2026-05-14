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
  const taskWaitTool = registry.find((tool) => tool.name === "task_wait");
  expect(taskWaitTool).toBeDefined();
  expect(taskWaitTool?.description).toContain("Defaults: timeout 300000 ms");
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
    content: [
      {
        type: "text",
        text:
          "Delegation task \"task-9\" created.\n- Status: needs_confirmation\n"
          + "Next: this delegation requires user approval; do not call task_wait yet. "
          + "Tell the user, then call task_approve or task_reject based on their response.",
      },
    ],
    structuredContent: { taskId: "task-9", status: "needs_confirmation" },
  });
  expect(waitResponse).toEqual({
    content: [{ type: "text", text: "Task wait timeout; current state is unavailable." }],
    structuredContent: { status: "timeout", task: null },
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
  // chatKey is an internal weixin routing identifier and intentionally not
  // surfaced to MCP hosts; only the deferred_quota status is exposed.
  expect(requestResult?.structuredContent).toEqual({
    status: "deferred_quota",
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

test("delegate_request running result appends a Next: hint pointing at task_wait", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-running", status: "running" }),
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

  const delegate = registry.find((tool) => tool.name === "delegate_request");
  const result = await delegate?.handler({
    targetAgent: "opencode",
    task: "introduce yourself",
    workingDirectory: "/repo",
  });

  const text = (result?.content[0] as { text: string }).text;
  expect(text).toContain("Delegation task \"task-running\" created.");
  expect(text).toContain("- Status: running");
  expect(text).toContain("Next: call task_wait with taskId=\"task-running\"");
  expect(text).toContain("task_get to read the result");
});

test("task_wait terminal / attention / timeout each include the matching Next: hint", async () => {
  let nextStatus: "terminal" | "attention_required" | "timeout" = "terminal";
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
        waitTask: async () => ({
          status: nextStatus,
          task: { taskId: "task-1", status: nextStatus === "timeout" ? "running" : nextStatus === "terminal" ? "completed" : "blocked" },
        }),
      },
    ),
    coordinatorSession: "backend:main",
  });

  const waitTool = registry.find((tool) => tool.name === "task_wait");

  nextStatus = "terminal";
  const terminalText = (
    (await waitTool?.handler({ taskId: "task-1" }))?.content[0] as { text: string }
  ).text;
  expect(terminalText).toContain("reached terminal state");
  expect(terminalText).toContain("Next: call task_get to read the worker's final result");

  nextStatus = "attention_required";
  const attentionText = (
    (await waitTool?.handler({ taskId: "task-1" }))?.content[0] as { text: string }
  ).text;
  expect(attentionText).toContain("requires attention");
  // Must mention task_get-then-branch instead of dumping the user into coordinator_answer_question
  // for every attention_required case (needs_confirmation / reviewPending would throw).
  expect(attentionText).toContain("call task_get");
  expect(attentionText).toContain("needs_confirmation -> task_approve");
  expect(attentionText).toContain("blocked or waiting_for_human -> coordinator_answer_question");
  expect(attentionText).toContain("reviewPending set -> coordinator_review_contested_result");
  expect(attentionText).toContain("call task_wait again");
  // Must NOT advertise coordinator_request_human_input on this path: it throws for external
  // coordinators (the MCP server's primary use case) per orchestration-service.ts:1564.
  expect(attentionText).not.toContain("coordinator_request_human_input");
  // pending is unreachable through task_approve today (assertNeedsConfirmation only accepts
  // needs_confirmation), so the guidance must not promise it.
  expect(attentionText).not.toContain("pending or needs_confirmation");

  nextStatus = "timeout";
  const timeoutText = (
    (await waitTool?.handler({ taskId: "task-1" }))?.content[0] as { text: string }
  ).text;
  expect(timeoutText).toContain("wait timed out");
  expect(timeoutText).toContain("Next: call task_wait again");
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
  const byName = new Map(registry.map((tool) => [tool.name, tool]));

  expect(byName.get("delegate_request")?.description).toContain("call task_wait with the returned taskId");
  expect(byName.get("task_wait")?.description).toContain("immediately after delegate_request");
  expect(byName.get("task_wait")?.description).toContain("attention_required");
  // task_wait description must spell out the attention_required branches so the LLM
  // does not blindly route every attention_required task into coordinator_answer_question.
  expect(byName.get("task_wait")?.description).toContain("needs_confirmation -> task_approve");
  expect(byName.get("task_wait")?.description).toContain("blocked or waiting_for_human -> coordinator_answer_question");
  expect(byName.get("task_wait")?.description).toContain("reviewPending set -> coordinator_review_contested_result");
  // External coordinators are the MCP server's main case and cannot use coordinator_request_human_input.
  expect(byName.get("task_wait")?.description ?? "").not.toContain("coordinator_request_human_input");
  expect(byName.get("task_get")?.description).toContain("after task_wait returns");
  expect(byName.get("task_approve")?.description).toContain("needs_confirmation");
  expect(byName.get("coordinator_answer_question")?.description).toContain("task_wait again");
  expect(byName.get("worker_raise_question")?.description).toContain("Worker-side only");
});

test("task_approve result text points the coordinator back to task_wait", async () => {
  const registry = buildWeacpxMcpToolRegistry({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-1", status: "needs_confirmation" }),
      {
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => ({ taskId: "task-approved", status: "running" }),
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

  const approveTool = registry.find((tool) => tool.name === "task_approve");
  const text = (
    (await approveTool?.handler({ taskId: "task-approved" }))?.content[0] as { text: string }
  ).text;

  expect(text).toContain("Task \"task-approved\" approved.");
  expect(text).toContain("- Current status: running");
  expect(text).toContain("Next: call task_wait with taskId=\"task-approved\"");
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
      rejectTask: async () => {
        throw new Error("reject not implemented");
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
  // Both human-input package tools hard-throw "human input routing is not configured for
  // external coordinator" in orchestration-service.ts. Don't advertise dead tools.
  expect(externalNames).not.toContain("coordinator_request_human_input");
  expect(externalNames).not.toContain("coordinator_follow_up_human_package");
  // Other coordinator-side tools must remain available — answering questions, reviewing
  // contested results, approving / rejecting / cancelling all work for external coordinators.
  expect(externalNames).toContain("delegate_request");
  expect(externalNames).toContain("task_wait");
  expect(externalNames).toContain("coordinator_answer_question");
  expect(externalNames).toContain("coordinator_review_contested_result");
  expect(externalRegistry).toHaveLength(14);

  const internalRegistry = buildWeacpxMcpToolRegistry({
    transport,
    coordinatorSession: "backend:main",
  });
  expect(internalRegistry).toHaveLength(16);
  expect(internalRegistry.map((tool) => tool.name)).toContain("coordinator_request_human_input");
  expect(internalRegistry.map((tool) => tool.name)).toContain("coordinator_follow_up_human_package");
});
