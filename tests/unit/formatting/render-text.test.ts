import { expect, test } from "bun:test";

import type { AppConfig } from "../../../src/config/types";
import type { OrchestrationTaskRecord } from "../../../src/orchestration/orchestration-types";
import { renderAgents, renderTaskHeartbeat, renderTaskProgress, renderTaskSummary, renderTasksCleanResult, renderWorkspaces } from "../../../src/formatting/render-text";

function createConfig(): AppConfig {
  return {
    transport: {
      type: "acpx-cli",
      command: "acpx",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
    logging: {
      level: "info",
      maxSizeBytes: 2 * 1024 * 1024,
      maxFiles: 5,
      retentionDays: 7,
    },
    wechat: {
      replyMode: "stream",
    },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
    },
    orchestration: {
      maxPendingAgentRequestsPerCoordinator: 3,
      allowWorkerChainedRequests: false,
      allowedAgentRequestTargets: [],
      allowedAgentRequestRoles: [],
    },
  };
}

test("renders agents in Chinese", () => {
  expect(renderAgents(createConfig())).toBe(["已注册的 Agent：", "- codex"].join("\n"));
});

test("renders workspaces in Chinese", () => {
  expect(renderWorkspaces(createConfig())).toBe(["已注册的工作区：", "- backend: /tmp/backend"].join("\n"));
});

test("renders cancellation and reliability metadata as timeline events", () => {
  const text = renderTaskSummary({
    taskId: "task-1",
    sourceHandle: "backend:main",
    sourceKind: "coordinator",
    coordinatorSession: "backend:main",
    workerSession: "backend:claude:backend:main",
    workspace: "backend",
    targetAgent: "claude",
    task: "review",
    status: "running",
    summary: "",
    resultText: "",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:05:00.000Z",
    cancelRequestedAt: "2026-04-13T10:01:00.000Z",
    cancelCompletedAt: "2026-04-13T10:02:00.000Z",
    lastCancelError: "cancel failed once",
    noticePending: true,
    noticeSentAt: "2026-04-13T10:03:00.000Z",
    lastNoticeError: "notice failed once",
    injectionPending: true,
    injectionAppliedAt: "2026-04-13T10:04:00.000Z",
    lastInjectionError: "prompt failed once",
  });

  expect(text).toContain("时间线：");
  expect(text).toContain("cancel_requested");
  expect(text).toContain("cancel_completed");
  expect(text).toContain("cancel_failed");
  expect(text).toContain("cancel failed once");
  expect(text).toContain("notice_sent");
  expect(text).toContain("notice_failed");
  expect(text).toContain("notice failed once");
  expect(text).toContain("injection_applied");
  expect(text).toContain("injection_failed");
  expect(text).toContain("prompt failed once");
});

test("renderTaskSummary outputs a chronological timeline of lifecycle events", () => {
  const task: OrchestrationTaskRecord = {
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
    updatedAt: "2026-04-18T10:10:00.000Z",
    lastProgressAt: "2026-04-18T10:05:00.000Z",
    noticePending: false,
    noticeSentAt: "2026-04-18T10:10:00.000Z",
    injectionPending: false,
    injectionAppliedAt: "2026-04-18T10:11:00.000Z",
  };

  const rendered = renderTaskSummary(task);

  expect(rendered).toContain("时间线：");
  const timelineIndex = rendered.indexOf("时间线：");
  const timeline = rendered.slice(timelineIndex);
  expect(timeline.indexOf("10:00:00")).toBeLessThan(timeline.indexOf("10:05:00"));
  expect(timeline.indexOf("10:05:00")).toBeLessThan(timeline.indexOf("10:10:00"));
  expect(timeline.indexOf("10:10:00")).toBeLessThan(timeline.indexOf("10:11:00"));
  expect(rendered).toContain("created");
  expect(rendered).toContain("last_progress");
  expect(rendered).toContain("notice_sent");
  expect(rendered).toContain("injection_applied");
});

test("renderTaskSummary includes error events inline", () => {
  const task: OrchestrationTaskRecord = {
    taskId: "task-err",
    sourceHandle: "backend:main",
    sourceKind: "coordinator",
    coordinatorSession: "backend:main",
    workerSession: "backend:claude:backend:main",
    workspace: "backend",
    targetAgent: "claude",
    task: "failing work",
    status: "completed",
    summary: "",
    resultText: "ok",
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:10:00.000Z",
    noticePending: true,
    lastNoticeError: "send failed",
    injectionPending: true,
    lastInjectionError: "prompt failed",
  };

  const rendered = renderTaskSummary(task);
  expect(rendered).toContain("notice_failed");
  expect(rendered).toContain("send failed");
  expect(rendered).toContain("injection_failed");
  expect(rendered).toContain("prompt failed");
});

test("renders tasks clean result with counts", () => {
  expect(renderTasksCleanResult(3, 1)).toBe("已清理 3 个已结束的任务。\n已释放 1 个无效的 worker 绑定。");
  expect(renderTasksCleanResult(2, 0)).toBe("已清理 2 个已结束的任务。");
  expect(renderTasksCleanResult(0, 0)).toBe("当前协调会话下没有可清理的任务。");
});

test("renders task progress message", () => {
  const task = { taskId: "task-1", targetAgent: "claude" } as OrchestrationTaskRecord;
  expect(renderTaskProgress(task, "正在分析类型定义")).toBe(
    "⏳ 任务「task-1」（claude）：正在分析类型定义",
  );
});

test("renders task heartbeat message", () => {
  const task = { taskId: "task-1" } as OrchestrationTaskRecord;
  expect(renderTaskHeartbeat(task, 300)).toBe(
    "⏳ 任务「task-1」已运行 5 分钟，等待中...",
  );
});
