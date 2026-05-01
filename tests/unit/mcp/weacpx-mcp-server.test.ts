import { expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createWeacpxMcpServer } from "../../../src/mcp/weacpx-mcp-server";
import { createMemoryTransport } from "../../../src/mcp/weacpx-mcp-transport";

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
      content: [{ type: "text", text: "任务「task-1」已提交 blocker 问题。\n- questionId：question-1" }],
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
      content: [{ type: "text", text: "Delegation task task-9 is needs_confirmation." }],
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
