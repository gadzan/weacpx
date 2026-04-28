import { expect, test } from "bun:test";

import {
  createMemoryTransport,
  createOrchestrationTransport,
  type WeacpxMcpTaskIdArgs,
} from "../../../src/mcp/weacpx-mcp-transport";

test("createMemoryTransport delegates and exposes override hooks", async () => {
  const calls: unknown[] = [];
  const transport = createMemoryTransport(
    async (input) => {
      calls.push(input);
      return { taskId: "task-1", status: "needs_confirmation" };
    },
    {
      getTask: async (input) => {
        calls.push(input);
        return null;
      },
      workerRaiseQuestion: async (input) => {
        calls.push(input);
        return { taskId: "task-1", questionId: "question-1", status: "blocked" };
      },
    },
  );

  await expect(
    transport.delegateRequest({
      coordinatorSession: "backend:main",
      targetAgent: "claude",
      task: "review",
      groupId: "group-1",
    }),
  ).resolves.toEqual({ taskId: "task-1", status: "needs_confirmation" });
  await expect(
    transport.getTask({ coordinatorSession: "backend:main", taskId: "task-1" }),
  ).resolves.toBeNull();
  await expect(
    transport.workerRaiseQuestion({
      sourceHandle: "backend:worker",
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    }),
  ).resolves.toEqual({
    taskId: "task-1",
    questionId: "question-1",
    status: "blocked",
  });

  expect(calls).toEqual([
    {
      coordinatorSession: "backend:main",
      targetAgent: "claude",
      task: "review",
      groupId: "group-1",
    },
    { coordinatorSession: "backend:main", taskId: "task-1" },
    {
      sourceHandle: "backend:worker",
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    },
  ]);
});

test("createOrchestrationTransport maps coordinator-scoped MCP calls onto the RPC client", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const taskRecord = {
    taskId: "task-1",
    sourceHandle: "backend:main",
    sourceKind: "coordinator" as const,
    coordinatorSession: "backend:main",
    workspace: "backend",
    targetAgent: "claude",
    task: "review",
    status: "running" as const,
    summary: "",
    resultText: "",
    createdAt: "a",
    updatedAt: "a",
  };
  const fakeClient = {
    delegateRequest: async (input: unknown) => {
      calls.push({ method: "delegateRequest", input });
      return { taskId: "task-1", status: "needs_confirmation" as const };
    },
    createGroup: async (input: unknown) => {
      calls.push({ method: "createGroup", input });
      return {
        groupId: "g-1",
        coordinatorSession: "backend:main",
        title: "parallel review",
        createdAt: "a",
        updatedAt: "a",
      };
    },
    getGroup: async (input: unknown) => {
      calls.push({ method: "getGroup", input });
      return null;
    },
    listGroups: async (input: unknown) => {
      calls.push({ method: "listGroups", input });
      return [];
    },
    cancelGroup: async (input: unknown) => {
      calls.push({ method: "cancelGroup", input });
      return {
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
      };
    },
    getTaskForCoordinator: async (input: unknown) => {
      calls.push({ method: "getTaskForCoordinator", input });
      return taskRecord;
    },
    listTasks: async (input: unknown) => {
      calls.push({ method: "listTasks", input });
      return [taskRecord];
    },
    approveTask: async (input: unknown) => {
      calls.push({ method: "approveTask", input });
      return taskRecord;
    },
    rejectTask: async (input: unknown) => {
      calls.push({ method: "rejectTask", input });
      return { ...taskRecord, status: "cancelled" as const, summary: "rejected" };
    },
    cancelTaskForCoordinator: async (input: unknown) => {
      calls.push({ method: "cancelTaskForCoordinator", input });
      return { ...taskRecord, status: "cancelled" as const };
    },
    workerRaiseQuestion: async (input: unknown) => {
      calls.push({ method: "workerRaiseQuestion", input });
      return { taskId: "task-1", questionId: "question-1", status: "blocked" as const };
    },
    coordinatorAnswerQuestion: async (input: unknown) => {
      calls.push({ method: "coordinatorAnswerQuestion", input });
      return { ...taskRecord, status: "running" as const };
    },
    coordinatorRequestHumanInput: async (input: unknown) => {
      calls.push({ method: "coordinatorRequestHumanInput", input });
      return { packageId: "package-1", queuedTaskIds: ["task-2"] };
    },
    coordinatorFollowUpHumanPackage: async (input: unknown) => {
      calls.push({ method: "coordinatorFollowUpHumanPackage", input });
      return { packageId: "package-1", messageId: "message-2" };
    },
    coordinatorReviewContestedResult: async (input: unknown) => {
      calls.push({ method: "coordinatorReviewContestedResult", input });
      return { ...taskRecord, status: "blocked" as const };
    },
  };

  const transport = createOrchestrationTransport(
    { kind: "unix", path: "/tmp/test.sock" },
    { client: fakeClient },
  );
  const taskArgs: WeacpxMcpTaskIdArgs = { coordinatorSession: "backend:main", taskId: "task-1" };

  await transport.delegateRequest({
    coordinatorSession: "backend:main",
    sourceHandle: "backend:main:worker",
    targetAgent: "claude",
    task: "review",
    role: "reviewer",
  });
  await transport.listGroups({
    coordinatorSession: "backend:main",
    status: "running",
    stuck: true,
    sort: "createdAt",
    order: "asc",
  });
  await transport.getTask(taskArgs);
  await transport.listTasks({
    coordinatorSession: "backend:main",
    status: "running",
    stuck: true,
    sort: "createdAt",
    order: "asc",
  });
  await transport.approveTask(taskArgs);
  await transport.rejectTask(taskArgs);
  await transport.cancelTask(taskArgs);
  await transport.workerRaiseQuestion({
    sourceHandle: "backend:worker",
    taskId: "task-1",
    question: "Need environment details",
    whyBlocked: "Requirement is ambiguous",
    whatIsNeeded: "Clarify the target environment",
  });
  await transport.coordinatorAnswerQuestion({
    coordinatorSession: "backend:main",
    taskId: "task-1",
    questionId: "question-1",
    answer: "Use the staging environment.",
  });
  await transport.coordinatorRequestHumanInput({
    coordinatorSession: "backend:main",
    taskQuestions: [{ taskId: "task-1", questionId: "question-1" }],
    promptText: "Please confirm the target environment.",
    expectedActivePackageId: "package-0",
  });
  await transport.coordinatorFollowUpHumanPackage({
    coordinatorSession: "backend:main",
    packageId: "package-1",
    priorMessageId: "message-1",
    taskQuestions: [{ taskId: "task-1", questionId: "question-1" }],
    promptText: "We still need the deployment window.",
  });
  await transport.coordinatorReviewContestedResult({
    coordinatorSession: "backend:main",
    taskId: "task-1",
    reviewId: "review-1",
    decision: "discard",
  });

  expect(calls).toEqual([
    {
      method: "delegateRequest",
      input: {
        sourceHandle: "backend:main:worker",
        targetAgent: "claude",
        task: "review",
        role: "reviewer",
      },
    },
    {
      method: "listGroups",
      input: {
        coordinatorSession: "backend:main",
        status: "running",
        stuck: true,
        sort: "createdAt",
        order: "asc",
      },
    },
    { method: "getTaskForCoordinator", input: taskArgs },
    {
      method: "listTasks",
      input: {
        coordinatorSession: "backend:main",
        status: "running",
        stuck: true,
        sort: "createdAt",
        order: "asc",
      },
    },
    { method: "approveTask", input: taskArgs },
    { method: "rejectTask", input: taskArgs },
    { method: "cancelTaskForCoordinator", input: taskArgs },
    {
      method: "workerRaiseQuestion",
      input: {
        taskId: "task-1",
        sourceHandle: "backend:worker",
        question: "Need environment details",
        whyBlocked: "Requirement is ambiguous",
        whatIsNeeded: "Clarify the target environment",
      },
    },
    {
      method: "coordinatorAnswerQuestion",
      input: {
        coordinatorSession: "backend:main",
        taskId: "task-1",
        questionId: "question-1",
        answer: "Use the staging environment.",
      },
    },
    {
      method: "coordinatorRequestHumanInput",
      input: {
        coordinatorSession: "backend:main",
        taskQuestions: [{ taskId: "task-1", questionId: "question-1" }],
        promptText: "Please confirm the target environment.",
        expectedActivePackageId: "package-0",
      },
    },
    {
      method: "coordinatorFollowUpHumanPackage",
      input: {
        coordinatorSession: "backend:main",
        packageId: "package-1",
        priorMessageId: "message-1",
        taskQuestions: [{ taskId: "task-1", questionId: "question-1" }],
        promptText: "We still need the deployment window.",
      },
    },
    {
      method: "coordinatorReviewContestedResult",
      input: {
        coordinatorSession: "backend:main",
        taskId: "task-1",
        reviewId: "review-1",
        decision: "discard",
      },
    },
  ]);
});

test("createOrchestrationTransport workerRaiseQuestion fails clearly when no injected sourceHandle is provided", async () => {
  const calls: unknown[] = [];
  const fakeClient = {
    delegateRequest: async () => ({ taskId: "task-1", status: "needs_confirmation" as const }),
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
    getTaskForCoordinator: async () => null,
    listTasks: async () => [],
    approveTask: async () => {
      throw new Error("unused");
    },
    rejectTask: async () => {
      throw new Error("unused");
    },
    cancelTaskForCoordinator: async () => {
      throw new Error("unused");
    },
    workerRaiseQuestion: async (input: unknown) => {
      calls.push(input);
      return { taskId: "task-1", questionId: "question-1", status: "blocked" as const };
    },
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
  };

  const transport = createOrchestrationTransport(
    { kind: "unix", path: "/tmp/test.sock" },
    { client: fakeClient },
  );

  await expect(
    transport.workerRaiseQuestion({
      taskId: "task-1",
      question: "Need environment details",
      whyBlocked: "Requirement is ambiguous",
      whatIsNeeded: "Clarify the target environment",
    }),
  ).rejects.toThrow(/sourceHandle/i);
  expect(calls).toEqual([]);
});
