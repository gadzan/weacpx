import { EventEmitter } from "node:events";

import { expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, ListRootsRequestSchema, RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";

import {
  createWeacpxMcpServer,
  installMcpStdioShutdownHooks,
  WEACPX_MCP_SERVER_INSTRUCTIONS,
} from "../../../src/mcp/weacpx-mcp-server";
import { createMemoryTransport } from "../../../src/mcp/weacpx-mcp-transport";
import type { OrchestrationTaskRecord } from "../../../src/orchestration/orchestration-types";

test("lists 16 MCP tools and hides coordinator/source identity from input schemas", async () => {
  const transport = createMemoryTransport(
    async () => ({ taskId: "task-1", status: "needs_confirmation" }),
    {
      createGroup: async () => ({
        groupId: "g-1",
        coordinatorSession: "backend:main",
        title: "parallel review",
        createdAt: "a",
        updatedAt: "a",
      }),
      getGroup: async () => null,
      listGroups: async () => [],
      cancelGroup: async () => ({
        summary: {
          group: {
            groupId: "g-1",
            coordinatorSession: "backend:main",
            title: "parallel review",
            createdAt: "a",
            updatedAt: "a",
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
      workerRaiseQuestion: async () => ({ taskId: "task-1", questionId: "question-1", status: "blocked" }),
      coordinatorAnswerQuestion: async () => {
        throw new Error("unused");
      },
      coordinatorRequestHumanInput: async () => {
        throw new Error("unused");
      },
      coordinatorFollowUpHumanPackage: async () => {
        throw new Error("unused");
      },
      coordinatorReviewContestedResult: async () => {
        throw new Error("unused");
      },
    },
  );
  const server = createWeacpxMcpServer({
    transport,
    coordinatorSession: "backend:main",
    sourceHandle: "backend:main:worker",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const list = await client.listTools();
    expect(list.tools).toHaveLength(16);
    const delegate = list.tools.find((tool) => tool.name === "delegate_request");
    const workerRaiseQuestion = list.tools.find((tool) => tool.name === "worker_raise_question");
    const coordinatorAnswerQuestion = list.tools.find((tool) => tool.name === "coordinator_answer_question");
    const taskList = list.tools.find((tool) => tool.name === "task_list");
    const taskWait = list.tools.find((tool) => tool.name === "task_wait");
    expect(delegate?.inputSchema.properties).not.toHaveProperty("sourceHandle");
    expect(delegate?.inputSchema.properties).not.toHaveProperty("coordinatorSession");
    expect(delegate?.execution?.taskSupport).toBe("optional");
    expect(workerRaiseQuestion?.inputSchema.properties).not.toHaveProperty("sourceHandle");
    expect(workerRaiseQuestion?.inputSchema.properties).not.toHaveProperty("coordinatorSession");
    expect(coordinatorAnswerQuestion?.inputSchema.properties).not.toHaveProperty("coordinatorSession");
    expect(taskList?.inputSchema.properties?.status?.enum).toContain("blocked");
    expect(taskList?.inputSchema.properties?.status?.enum).toContain("waiting_for_human");
    expect(taskWait?.inputSchema.properties).not.toHaveProperty("coordinatorSession");
  } finally {
    await client.close();
    await server.close();
  }
});

test("delegate_request supports native MCP task execution", async () => {
  const task: OrchestrationTaskRecord = {
    taskId: "task-9",
    sourceHandle: "backend:main",
    sourceKind: "coordinator",
    coordinatorSession: "backend:main",
    workerSession: "backend:worker",
    workspace: "backend",
    targetAgent: "claude",
    task: "review",
    status: "completed",
    summary: "review complete",
    resultText: "No blocking issues.",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:01.000Z",
  };
  const calls: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async (input) => {
        calls.push(input);
        return { taskId: "task-9", status: "running" };
      },
      {
        getTask: async ({ taskId }) => taskId === "task-9" ? task : null,
        listTasks: async () => [task],
        cancelTask: async () => {
          throw new Error("unused");
        },
      },
    ),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const messages: Array<{ type: string; task?: { taskId: string; status: string }; result?: unknown }> = [];
    const stream = client.experimental.tasks.callToolStream(
      {
        name: "delegate_request",
        arguments: {
          targetAgent: "claude",
          task: "review",
          workingDirectory: "/repo/backend",
        },
      },
      CallToolResultSchema,
      { task: { ttl: 60_000, pollInterval: 1 } },
    );

    for await (const message of stream) {
      messages.push(message);
    }

    expect(calls).toEqual([
      {
        coordinatorSession: "backend:main",
        targetAgent: "claude",
        task: "review",
        workingDirectory: "/repo/backend",
      },
    ]);
    expect(messages[0]).toMatchObject({
      type: "taskCreated",
      task: { taskId: "task-9", status: "completed" },
    });
    expect(messages.at(-1)).toMatchObject({
      type: "result",
      result: {
        content: [{ type: "text", text: "Task \"task-9\" finished with status completed.\nNo blocking issues." }],
        _meta: {
          [RELATED_TASK_META_KEY]: { taskId: "task-9" },
        },
      },
    });

    const listed = await client.experimental.tasks.listTasks();
    expect(listed.tasks).toEqual([
      {
        taskId: "task-9",
        status: "completed",
        ttl: 60_000,
        createdAt: "2026-05-16T00:00:00.000Z",
        lastUpdatedAt: "2026-05-16T00:00:01.000Z",
        statusMessage: "review complete",
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("native MCP tasks map input-required states and cancellation", async () => {
  const task: OrchestrationTaskRecord = {
    taskId: "task-blocked",
    sourceHandle: "backend:main",
    sourceKind: "coordinator",
    coordinatorSession: "backend:main",
    workerSession: "backend:worker",
    workspace: "backend",
    targetAgent: "claude",
    task: "review",
    status: "blocked",
    summary: "Need clarification",
    resultText: "",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:02.000Z",
    lastProgressAt: "2026-05-16T00:00:01.500Z",
    lastProgressSummary: "reading files",
    openQuestion: {
      questionId: "q1",
      question: "Which branch?",
      whatIsNeeded: "Branch name",
      whyBlocked: "Cannot review without it",
      askedAt: "2026-05-16T00:00:01.000Z",
      status: "open",
    },
  };
  let cancelTaskId: string | undefined;
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-blocked", status: "running" }),
      {
        getTask: async ({ taskId }) => taskId === "task-blocked" ? task : null,
        listTasks: async () => [task],
        cancelTask: async ({ taskId }) => {
          cancelTaskId = taskId;
          task.status = "cancelled";
          task.updatedAt = "2026-05-16T00:00:03.000Z";
        },
      },
    ),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const messages: Array<{ type: string; task?: { taskId: string; status: string }; result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown } }> = [];
    const stream = client.experimental.tasks.callToolStream(
      {
        name: "delegate_request",
        arguments: {
          targetAgent: "claude",
          task: "review",
          workingDirectory: "/repo/backend",
        },
      },
      CallToolResultSchema,
      { task: { pollInterval: 10 } },
    );
    for await (const message of stream) {
      messages.push(message);
    }

    expect(messages[0]).toMatchObject({
      type: "taskCreated",
      task: { taskId: "task-blocked", status: "input_required" },
    });
    expect(messages[1]).toMatchObject({
      type: "taskStatus",
      task: { taskId: "task-blocked", status: "input_required" },
    });
    expect(messages[2]).toMatchObject({
      type: "result",
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining("coordinator_answer_question"),
          },
        ],
      },
    });
    expect(messages[2]?.result?.structuredContent).toMatchObject({
      nextAction: {
        kind: "input_required",
        taskId: "task-blocked",
        recommendedTools: ["coordinator_answer_question"],
      },
    });
    expect(messages[2]?.result?._meta).toEqual({
      [RELATED_TASK_META_KEY]: { taskId: "task-blocked" },
    });

    const status = await client.experimental.tasks.getTask("task-blocked");
    expect(status).toMatchObject({
      taskId: "task-blocked",
      status: "input_required",
      statusMessage: "Need clarification\nLatest progress: reading files\nLast progress at: 2026-05-16T00:00:01.500Z",
    });

    const cancelled = await client.experimental.tasks.cancelTask("task-blocked");
    expect(cancelTaskId).toBe("task-blocked");
    expect(cancelled).toMatchObject({
      taskId: "task-blocked",
      status: "cancelled",
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("native MCP tasks list uses cursor pagination", async () => {
  const tasks: OrchestrationTaskRecord[] = Array.from({ length: 101 }, (_, index) => ({
    taskId: `task-${index}`,
    sourceHandle: "backend:main",
    sourceKind: "coordinator",
    coordinatorSession: "backend:main",
    workerSession: `backend:worker-${index}`,
    workspace: "backend",
    targetAgent: "claude",
    task: "review",
    status: "running",
    summary: "",
    resultText: "",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: `2026-05-16T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-0", status: "running" }),
      {
        getTask: async ({ taskId }) => tasks.find((task) => task.taskId === taskId) ?? null,
        listTasks: async () => tasks,
      },
    ),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const first = await client.experimental.tasks.listTasks();
    const second = await client.experimental.tasks.listTasks(first.nextCursor);

    expect(first.tasks).toHaveLength(100);
    expect(first.nextCursor).toBe("100");
    expect(second.tasks).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  } finally {
    await client.close();
    await server.close();
  }
});

test("hides coordinator human-input package tools when resolveIdentity reports an external coordinator", async () => {
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "running" })),
    resolveIdentity: async () => ({
      coordinatorSession: "external_claude-code:backend",
      isExternalCoordinator: true,
    }),
  });
  const client = new Client({ name: "Claude Code", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const list = await client.listTools();
    const names = list.tools.map((tool) => tool.name);
    expect(list.tools).toHaveLength(14);
    expect(names).not.toContain("coordinator_request_human_input");
    expect(names).not.toContain("coordinator_follow_up_human_package");
    expect(names).toContain("coordinator_answer_question");
    expect(names).toContain("coordinator_review_contested_result");
  } finally {
    await client.close();
    await server.close();
  }
});

test("infers MCP identity from client roots before listing tools", async () => {
  const resolved: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "needs_confirmation" })),
    resolveIdentity: async (context) => {
      const roots = await context.listRoots();
      resolved.push({ clientName: context.clientName, roots });
      return {
        coordinatorSession: "external_claude-code:backend",
      };
    },
  });
  const client = new Client(
    { name: "Claude Code", version: "1.0.0" },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: "file:///repo/backend", name: "backend" }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const list = await client.listTools();
    expect(list.tools).toHaveLength(16);
    expect(resolved).toEqual([
      {
        clientName: "Claude Code",
        roots: [{ uri: "file:///repo/backend", name: "backend" }],
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});


test("uses resolveIdentity when both static and lazy MCP identities are configured", async () => {
  const resolved: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "needs_confirmation" })),
    coordinatorSession: "static:session",
    resolveIdentity: async (context) => {
      resolved.push({ clientName: context.clientName });
      return { coordinatorSession: "resolved:session" };
    },
  });
  const client = new Client({ name: "Claude Code", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const list = await client.listTools();
    expect(list.tools).toHaveLength(16);
    expect(resolved).toEqual([{ clientName: "Claude Code" }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("exposes the orchestration lifecycle as server instructions to the client", async () => {
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "running" })),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const instructions = client.getInstructions();
    expect(instructions).toBe(WEACPX_MCP_SERVER_INSTRUCTIONS);
    expect(instructions ?? "").toContain("Typical lifecycle");
    expect(instructions ?? "").toContain("delegate_request");
    expect(instructions ?? "").toContain("task_wait");
    expect(instructions ?? "").toContain("status=attention_required");
    // Each attention_required sub-case must be wired to a different tool so the LLM
    // does not blindly call coordinator_answer_question on a needs_confirmation task.
    expect(instructions ?? "").toContain("needs_confirmation -> task_approve");
    expect(instructions ?? "").toContain("blocked or waiting_for_human -> coordinator_answer_question");
    expect(instructions ?? "").toContain("reviewPending set -> coordinator_review_contested_result");
    // External coordinators (the MCP server's main client population) cannot use
    // coordinator_request_human_input — keep it out of the attention_required guidance.
    expect(instructions ?? "").not.toContain("blocked -> coordinator_answer_question if you can answer");
    // Approval must loop back to task_wait, otherwise the coordinator hangs after approving.
    expect(instructions ?? "").toContain("After task_approve, return to step 2");
    expect(instructions ?? "").toContain("worker_raise_question is worker-side only");
  } finally {
    await client.close();
    await server.close();
  }
});

test("memoizes in-flight lazy MCP identity resolution across concurrent first requests", async () => {
  let resolveCalls = 0;
  let releaseResolve!: () => void;
  const resolveStarted = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(async () => ({ taskId: "task-1", status: "needs_confirmation" })),
    resolveIdentity: async () => {
      resolveCalls += 1;
      await resolveStarted;
      return { coordinatorSession: "external_claude-code:backend" };
    },
  });
  const client = new Client({ name: "Claude Code", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const firstList = client.listTools();
    const secondList = client.listTools();
    await Promise.resolve();
    releaseResolve();

    const [first, second] = await Promise.all([firstList, secondList]);
    expect(first.tools).toHaveLength(16);
    expect(second.tools).toHaveLength(16);
    expect(resolveCalls).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});

test("worker_raise_question uses host-bound sourceHandle and still rejects spoofed public identity fields", async () => {
  const calls: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-9", status: "needs_confirmation" }),
      {
        createGroup: async () => {
          throw new Error("unused");
        },
        getGroup: async () => null,
        listGroups: async () => [],
        cancelGroup: async () => {
          throw new Error("unused");
        },
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("unused");
        },
        rejectTask: async () => {
          throw new Error("unused");
        },
        cancelTask: async () => {
          throw new Error("unused");
        },
        workerRaiseQuestion: async (input) => {
          calls.push(input);
          return { taskId: "task-1", questionId: "question-1", status: "blocked" };
        },
      },
    ),
    coordinatorSession: "backend:main",
    sourceHandle: "backend:worker",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "worker_raise_question",
      arguments: {
        taskId: "task-1",
        question: "Need environment details",
        whyBlocked: "Requirement is ambiguous",
        whatIsNeeded: "Clarify the target environment",
      },
    });

    expect(calls).toEqual([
      {
        sourceHandle: "backend:worker",
        taskId: "task-1",
        question: "Need environment details",
        whyBlocked: "Requirement is ambiguous",
        whatIsNeeded: "Clarify the target environment",
      },
    ]);
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Blocker question submitted for task \"task-1\".\n- questionId: question-1" }],
      structuredContent: { taskId: "task-1", questionId: "question-1", status: "blocked" },
    });

    await expect(
      client.callTool({
        name: "worker_raise_question",
        arguments: {
          sourceHandle: "spoofed",
          coordinatorSession: "spoofed",
          taskId: "task-1",
          question: "Need environment details",
          whyBlocked: "Requirement is ambiguous",
          whatIsNeeded: "Clarify the target environment",
        },
      }),
    ).rejects.toThrow(/sourceHandle|coordinatorSession|unrecognized/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("worker_raise_question fails clearly when the MCP host did not bind a sourceHandle", async () => {
  const calls: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async () => ({ taskId: "task-9", status: "needs_confirmation" }),
      {
        createGroup: async () => {
          throw new Error("unused");
        },
        getGroup: async () => null,
        listGroups: async () => [],
        cancelGroup: async () => {
          throw new Error("unused");
        },
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("unused");
        },
        rejectTask: async () => {
          throw new Error("unused");
        },
        cancelTask: async () => {
          throw new Error("unused");
        },
        workerRaiseQuestion: async (input) => {
          calls.push(input);
          return { taskId: "task-1", questionId: "question-1", status: "blocked" };
        },
      },
    ),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "worker_raise_question",
      arguments: {
        taskId: "task-1",
        question: "Need environment details",
        whyBlocked: "Requirement is ambiguous",
        whatIsNeeded: "Clarify the target environment",
      },
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
  } finally {
    await client.close();
    await server.close();
  }
});

test("delegates through the MCP server and rejects spoofed sourceHandle params", async () => {
  const calls: unknown[] = [];
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async (input) => {
        calls.push(input);
        return { taskId: "task-9", status: "needs_confirmation" };
      },
      {
        createGroup: async () => {
          throw new Error("unused");
        },
        getGroup: async () => null,
        listGroups: async () => [],
        cancelGroup: async () => {
          throw new Error("unused");
        },
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("unused");
        },
        rejectTask: async () => {
          throw new Error("unused");
        },
        cancelTask: async () => {
          throw new Error("unused");
        },
      },
    ),
    coordinatorSession: "backend:main",
    sourceHandle: "backend:main:worker",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "delegate_request",
      arguments: {
        targetAgent: "claude",
        task: "review",
      },
    });

    expect(calls).toEqual([
      {
        coordinatorSession: "backend:main",
        sourceHandle: "backend:main:worker",
        targetAgent: "claude",
        task: "review",
      },
    ]);
    expect(result).toMatchObject({
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

    await expect(
      client.callTool({
        name: "delegate_request",
        arguments: {
          sourceHandle: "spoofed",
          targetAgent: "claude",
          task: "review",
        },
      }),
    ).rejects.toThrow(/sourceHandle|unrecognized/i);
  } finally {
    await client.close();
    await server.close();
  }
});

test("returns tool-level business errors as isError text results", async () => {
  const server = createWeacpxMcpServer({
    transport: createMemoryTransport(
      async () => {
        throw new Error("worker-originated delegation is disabled by orchestration policy");
      },
      {
        createGroup: async () => {
          throw new Error("unused");
        },
        getGroup: async () => null,
        listGroups: async () => [],
        cancelGroup: async () => {
          throw new Error("unused");
        },
        getTask: async () => null,
        listTasks: async () => [],
        approveTask: async () => {
          throw new Error("unused");
        },
        rejectTask: async () => {
          throw new Error("unused");
        },
        cancelTask: async () => {
          throw new Error("unused");
        },
      },
    ),
    coordinatorSession: "backend:main",
  });
  const client = new Client({ name: "weacpx-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "delegate_request",
      arguments: {
        targetAgent: "claude",
        task: "review",
      },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "worker-originated delegation is disabled by orchestration policy",
        },
      ],
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP stdio shutdown hooks react to the first stream/signal event and ignore later events", () => {
  const stdin = new EventEmitter();
  const stdout = new EventEmitter();
  const signals = new EventEmitter();
  let calls = 0;
  const diagnostics: unknown[] = [];
  const cleanup = installMcpStdioShutdownHooks({
    stdin,
    stdout,
    platform: "win32",
    parentPid: 0,
    signalSource: signals as never,
    onDiagnostic: (event, context) => diagnostics.push({ event, context }),
    shutdown: () => { calls += 1; },
  });

  stdin.emit("close");
  // The handler is single-fire: follow-on events on stdout/signals after the
  // first trigger must not produce additional diagnostics or shutdown calls.
  stdout.emit("error", new Error("EPIPE"));
  signals.emit("SIGBREAK");

  expect(calls).toBe(1);
  expect(diagnostics).toEqual([
    { event: "mcp.stdio.shutdown", context: { reason: "stdin.close" } },
  ]);
  cleanup();
  stdin.emit("end");
  signals.emit("SIGINT");
  expect(calls).toBe(1);
});

test("MCP stdio shutdown hooks fire once per install regardless of which event arrives first", () => {
  const cases: Array<{ event: string; reason: string; context?: Record<string, unknown>; emit: (stdin: EventEmitter, stdout: EventEmitter, signals: EventEmitter) => void }> = [
    {
      event: "stdout.error first",
      reason: "stdout.error",
      context: { message: "EPIPE" },
      emit: (_, stdout) => stdout.emit("error", new Error("EPIPE")),
    },
    {
      event: "signal first",
      reason: "signal",
      context: { signal: "SIGBREAK" },
      emit: (_, __, signals) => signals.emit("SIGBREAK"),
    },
  ];
  for (const testCase of cases) {
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    const signals = new EventEmitter();
    let calls = 0;
    const diagnostics: unknown[] = [];
    const cleanup = installMcpStdioShutdownHooks({
      stdin,
      stdout,
      platform: "win32",
      parentPid: 0,
      signalSource: signals as never,
      onDiagnostic: (event, context) => diagnostics.push({ event, context }),
      shutdown: () => { calls += 1; },
    });
    testCase.emit(stdin, stdout, signals);
    expect(calls).toBe(1);
    expect(diagnostics).toEqual([
      { event: "mcp.stdio.shutdown", context: { reason: testCase.reason, ...(testCase.context ?? {}) } },
    ]);
    cleanup();
  }
});

test("MCP stdio shutdown hooks poll parent process liveness", () => {
  const stdin = new EventEmitter();
  const stdout = new EventEmitter();
  const signals = new EventEmitter();
  let intervalCallback: (() => void) | undefined;
  let cleared = false;
  const intervalHandle = { unref() {} } as ReturnType<typeof setInterval>;
  let calls = 0;
  const diagnostics: unknown[] = [];

  const cleanup = installMcpStdioShutdownHooks({
    stdin,
    stdout,
    platform: "win32",
    parentPid: 1234,
    parentCheckIntervalMs: 10,
    signalSource: signals as never,
    isProcessRunning: () => false,
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return intervalHandle;
    },
    clearIntervalFn: (handle) => {
      expect(handle).toBe(intervalHandle);
      cleared = true;
    },
    onDiagnostic: (event, context) => diagnostics.push({ event, context }),
    shutdown: () => { calls += 1; },
  });

  expect(intervalCallback).toBeDefined();
  intervalCallback!();
  expect(calls).toBe(1);
  expect(diagnostics).toEqual([{ event: "mcp.stdio.shutdown", context: { reason: "parent_dead", parentPid: 1234 } }]);
  cleanup();
  expect(cleared).toBe(true);
});
