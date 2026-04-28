import { expect, test } from "bun:test";

import type { OrchestrationTaskRecord } from "../../../src/orchestration/orchestration-types";
import { renderDelegateResultBlocks } from "../../../src/orchestration/render-delegate-result";

function makeTask(overrides: Partial<OrchestrationTaskRecord>): OrchestrationTaskRecord {
  return {
    taskId: "task-1",
    sourceHandle: "wx:user-1",
    sourceKind: "human",
    coordinatorSession: "backend:main",
    workerSession: "backend:codex:worker-1",
    workspace: "backend",
    targetAgent: "codex",
    task: "do the thing",
    status: "completed",
    summary: "",
    resultText: "",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

test("renders completed and failed delegate results as stable prompt blocks", () => {
  const blocks = renderDelegateResultBlocks([
    makeTask({
      taskId: "task-1",
      status: "completed",
      workerSession: "backend:codex:worker-1",
      targetAgent: "codex",
      resultText: "finished successfully",
      summary: "ignored summary",
    }),
    makeTask({
      taskId: "task-2",
      status: "failed",
      workerSession: undefined,
      targetAgent: "claude",
      summary: "parse error",
      resultText: "stderr output",
    }),
  ]);

  expect(blocks).toBe(
    [
      [
        "[delegate_result]",
        "task_id: task-1",
        "worker_session: backend:codex:worker-1",
        "target_agent: codex",
        "status: completed",
        "",
        "result:",
        "finished successfully",
        "[/delegate_result]",
      ].join("\n"),
      [
        "[delegate_result]",
        "task_id: task-2",
        "worker_session: unassigned",
        "target_agent: claude",
        "status: failed",
        "",
        "result:",
        "parse error",
        "[/delegate_result]",
      ].join("\n"),
    ].join("\n\n"),
  );
});
