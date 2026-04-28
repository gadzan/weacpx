import { expect, test } from "bun:test";

import { renderDelegateGroupResult } from "../../../src/orchestration/render-delegate-group-result";

test("renders a bucketed aggregate block with counters, successes, failures, and next_action", () => {
  const text = renderDelegateGroupResult(
    {
      groupId: "group-review",
      coordinatorSession: "backend:main",
      title: "parallel review",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:05:00.000Z",
    },
    [
      {
        taskId: "task-1",
        sourceHandle: "backend:main",
        sourceKind: "coordinator",
        coordinatorSession: "backend:main",
        workerSession: "backend:claude:backend:main",
        workspace: "backend",
        targetAgent: "claude",
        task: "review api",
        status: "completed",
        summary: "done",
        resultText: "ok",
        createdAt: "2026-04-18T10:00:00.000Z",
        updatedAt: "2026-04-18T10:01:00.000Z",
        groupId: "group-review",
      },
      {
        taskId: "task-2",
        sourceHandle: "backend:main",
        sourceKind: "coordinator",
        coordinatorSession: "backend:main",
        workerSession: "backend:codex:backend:main",
        workspace: "backend",
        targetAgent: "codex",
        task: "implement fix",
        status: "failed",
        summary: "boom",
        resultText: "",
        createdAt: "2026-04-18T10:00:00.000Z",
        updatedAt: "2026-04-18T10:02:00.000Z",
        groupId: "group-review",
      },
    ],
  );

  expect(text).toContain("[delegate_group_result]");
  expect(text).toContain("group_id: group-review");
  expect(text).toContain("title: parallel review");
  expect(text).toContain("total: 2");
  expect(text).toContain("completed: 1");
  expect(text).toContain("failed: 1");
  expect(text).toContain("cancelled: 0");
  expect(text).toContain("successes:");
  expect(text).toContain("failures:");
  expect(text).toContain("- [completed] claude / task-1");
  expect(text).toContain("- [failed] codex / task-2");
  expect(text).toContain("boom");
  expect(text).toContain("next_action:");
  expect(text).toContain("[/delegate_group_result]");
});

test("truncates overlong result bodies and points to /task for the full output", () => {
  const long = "x".repeat(800);
  const text = renderDelegateGroupResult(
    {
      groupId: "g1",
      coordinatorSession: "s",
      title: "t",
      createdAt: "a",
      updatedAt: "a",
    },
    [
      {
        taskId: "task-long",
        sourceHandle: "s",
        sourceKind: "coordinator",
        coordinatorSession: "s",
        workerSession: "w",
        workspace: "w",
        targetAgent: "claude",
        task: "t",
        status: "completed",
        summary: "",
        resultText: long,
        createdAt: "a",
        updatedAt: "a",
        groupId: "g1",
      },
    ],
  );

  expect(text).toContain("xxxxxxxxxx");
  expect(text).not.toContain(long);
  expect(text).toContain("/task task-long");
});

test("renders a well-formed block with an honest next_action when the group has no members", () => {
  const text = renderDelegateGroupResult(
    {
      groupId: "g1",
      coordinatorSession: "s",
      title: "empty group",
      createdAt: "a",
      updatedAt: "a",
    },
    [],
  );

  expect(text).toContain("total: 0");
  expect(text).toContain("completed: 0");
  expect(text).toContain("failed: 0");
  expect(text).toContain("cancelled: 0");
  expect(text).toContain("next_action: 本组没有任何成员");
  expect(text).not.toMatch(/\n\n\n/);
  expect(text).not.toContain("successes:");
  expect(text).not.toContain("failures:");
  expect(text).not.toContain("other:");
});

test("buckets cancelled and unfinished members into the other section", () => {
  const text = renderDelegateGroupResult(
    {
      groupId: "g1",
      coordinatorSession: "s",
      title: "t",
      createdAt: "a",
      updatedAt: "a",
    },
    [
      {
        taskId: "c-1",
        sourceHandle: "s",
        sourceKind: "coordinator",
        coordinatorSession: "s",
        workerSession: "w",
        workspace: "w",
        targetAgent: "claude",
        task: "t",
        status: "cancelled",
        summary: "",
        resultText: "",
        createdAt: "a",
        updatedAt: "a",
        groupId: "g1",
      },
      {
        taskId: "r-1",
        sourceHandle: "s",
        sourceKind: "coordinator",
        coordinatorSession: "s",
        workerSession: "w",
        workspace: "w",
        targetAgent: "codex",
        task: "t",
        status: "running",
        summary: "",
        resultText: "",
        createdAt: "a",
        updatedAt: "a",
        groupId: "g1",
      },
    ],
  );

  expect(text).toContain("cancelled: 1");
  expect(text).toContain("other:");
  expect(text).toContain("- [cancelled] claude / c-1");
  expect(text).toContain("- [running] codex / r-1");
  expect(text).not.toContain("successes:");
  expect(text).not.toContain("failures:");
});
