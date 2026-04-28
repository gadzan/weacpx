import type { AppConfig } from "../config/types";
import type {
  OrchestrationGroupRecord,
  OrchestrationGroupSummary,
  OrchestrationTaskRecord,
} from "../orchestration/orchestration-types";

export function renderAgents(config: AppConfig): string {
  const names = Object.keys(config.agents);
  if (names.length === 0) {
    return "还没有注册任何 Agent。";
  }
  return ["已注册的 Agent：", ...names.map((name) => `- ${name}`)].join("\n");
}

export function renderWorkspaces(config: AppConfig): string {
  const names = Object.entries(config.workspaces);
  if (names.length === 0) {
    return "还没有注册任何工作区。";
  }
  return ["已注册的工作区：", ...names.map(([name, workspace]) => `- ${name}: ${workspace.cwd}`)].join("\n");
}

export function renderOrchestrationUnavailable(): string {
  return "当前未启用任务编排服务。";
}

export function renderDelegateSuccess(taskId: string, workerSession: string): string {
  return [`已创建委派任务「${taskId}」`, `worker 会话：${workerSession}`].join("\n");
}

export function renderGroupCreated(group: OrchestrationGroupRecord): string {
  return [`已创建任务组「${group.groupId}」`, `- 标题：${group.title}`].join("\n");
}

export function renderGroupList(groups: OrchestrationGroupSummary[]): string {
  if (groups.length === 0) {
    return "当前协调会话下还没有任务组。";
  }

  return ["当前协调会话的任务组：", ...groups.map((group) => renderGroupListItem(group))].join("\n");
}

export function renderGroupSummary(summary: OrchestrationGroupSummary): string {
  const { group, tasks } = summary;
  const lines = [
    `任务组「${group.groupId}」`,
    `- 标题：${group.title}`,
    `- 协调会话：${group.coordinatorSession}`,
    `- 总任务数：${summary.totalTasks}`,
    `- 待确认：${summary.pendingApprovalTasks}`,
    `- 运行中：${summary.runningTasks}`,
    `- 已完成：${summary.completedTasks}`,
    `- 已失败：${summary.failedTasks}`,
    `- 已取消：${summary.cancelledTasks}`,
    `- 是否终态：${summary.terminal ? "是" : "否"}`,
  ];

  if (group.injectionPending !== undefined) {
    lines.push(`- 注入待处理：${group.injectionPending ? "是" : "否"}`);
  }
  if (group.injectionAppliedAt) {
    lines.push(`- 注入完成时间：${group.injectionAppliedAt}`);
  }
  if (group.lastInjectionError) {
    lines.push(`- 最近注入错误：${group.lastInjectionError}`);
  }

  if (tasks.length > 0) {
    lines.push("- 成员：");
    for (const task of tasks) {
      lines.push(`  - ${task.taskId} [${task.status}] ${task.targetAgent}`);
    }
  }

  return lines.join("\n");
}

export function renderGroupCancelSuccess(input: {
  summary: OrchestrationGroupSummary;
  cancelledTaskIds: string[];
  skippedTaskIds: string[];
}): string {
  return [
    `任务组「${input.summary.group.groupId}」已发起取消`,
    `- 已请求取消：${input.cancelledTaskIds.length}`,
    `- 已跳过终态任务：${input.skippedTaskIds.length}`,
  ].join("\n");
}

export function renderTaskList(tasks: OrchestrationTaskRecord[]): string {
  if (tasks.length === 0) {
    return "当前协调会话下还没有任务。";
  }

  return ["当前协调会话的任务：", ...tasks.map((task) => renderTaskListItem(task))].join("\n");
}

interface TimelineEvent {
  at: string;
  event: string;
  detail?: string;
}

export function renderTaskSummary(task: OrchestrationTaskRecord): string {
  const header = [
    `任务「${task.taskId}」`,
    `- 状态：${task.status}`,
    `- 协调会话：${task.coordinatorSession}`,
    `- worker 会话：${task.workerSession ?? "未分配"}`,
    `- 目标 Agent：${task.targetAgent}`,
  ];
  if (task.role) header.push(`- 角色：${task.role}`);
  if (task.groupId) header.push(`- 任务组：${task.groupId}`);
  if (task.status === "needs_confirmation") {
    header.push(`- 来源：${task.sourceKind} / ${task.sourceHandle}${task.role ? ` / ${task.role}` : ""}`);
  }
  header.push(`- 任务：${task.task}`);
  if (task.summary.trim().length > 0) header.push(`- 摘要：${task.summary}`);
  if (task.resultText.trim().length > 0) header.push(`- 结果：${task.resultText}`);

  const events: TimelineEvent[] = [];
  events.push({ at: task.createdAt, event: "created" });
  if (task.workerSession && task.status !== "needs_confirmation") {
    events.push({ at: task.createdAt, event: "dispatched", detail: task.workerSession });
  }
  if (task.lastProgressAt) events.push({ at: task.lastProgressAt, event: "last_progress" });
  if (task.cancelRequestedAt) events.push({ at: task.cancelRequestedAt, event: "cancel_requested" });
  if (task.cancelCompletedAt) events.push({ at: task.cancelCompletedAt, event: "cancel_completed" });
  if (task.lastCancelError) events.push({ at: task.updatedAt, event: "cancel_failed", detail: task.lastCancelError });
  if (task.status === "completed") events.push({ at: task.updatedAt, event: "completed" });
  if (task.status === "failed") events.push({ at: task.updatedAt, event: "failed" });
  if (task.noticeSentAt) events.push({ at: task.noticeSentAt, event: "notice_sent", detail: task.deliveryAccountId });
  if (task.lastNoticeError) events.push({ at: task.updatedAt, event: "notice_failed", detail: task.lastNoticeError });
  if (task.injectionAppliedAt) events.push({ at: task.injectionAppliedAt, event: "injection_applied" });
  if (task.lastInjectionError) events.push({ at: task.updatedAt, event: "injection_failed", detail: task.lastInjectionError });

  events.sort((a, b) => a.at.localeCompare(b.at));

  const timeline = events.length > 0
    ? ["- 时间线：", ...events.map((e) => `  - [${e.at}] ${e.event}${e.detail ? `: ${e.detail}` : ""}`)]
    : [];

  return [...header, ...timeline].join("\n");
}

export function renderTaskCancelSuccess(task: OrchestrationTaskRecord): string {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return [`任务「${task.taskId}」已结束。`, `- 当前状态：${task.status}`].join("\n");
  }
  if (task.cancelRequestedAt) {
    return [`已请求取消任务「${task.taskId}」。`, `- 当前状态：${task.status}`].join("\n");
  }
  return [`任务「${task.taskId}」已取消。`, `- 当前状态：${task.status}`].join("\n");
}

export function renderTaskApprovalSuccess(task: OrchestrationTaskRecord): string {
  return [`已批准任务「${task.taskId}」。`, `- 当前状态：${task.status}`].join("\n");
}

export function renderTaskRejectionSuccess(task: OrchestrationTaskRecord): string {
  return [`已拒绝任务「${task.taskId}」。`, `- 当前状态：${task.status}`].join("\n");
}

export function renderTaskConfirmationUnavailable(task: OrchestrationTaskRecord): string {
  return [`任务「${task.taskId}」当前不是待确认状态。`, `- 当前状态：${task.status}`].join("\n");
}

export function renderTasksCleanResult(removedTasks: number, removedBindings: number): string {
  if (removedTasks === 0 && removedBindings === 0) {
    return "当前协调会话下没有可清理的任务。";
  }

  const lines: string[] = [];
  if (removedTasks > 0) {
    lines.push(`已清理 ${removedTasks} 个已结束的任务。`);
  }
  if (removedBindings > 0) {
    lines.push(`已释放 ${removedBindings} 个无效的 worker 绑定。`);
  }
  return lines.join("\n");
}

function renderTaskListItem(task: OrchestrationTaskRecord): string {
  const role = task.role ? ` / ${task.role}` : "";
  const group = task.groupId ? `；组：${task.groupId}` : "";
  const summary = task.summary.trim().length > 0 ? `：${task.summary}` : "";
  const source = task.status === "needs_confirmation" ? `；来源：${task.sourceKind} / ${task.sourceHandle}${task.role ? ` / ${task.role}` : ""}` : "";
  const reliability = [
    task.noticePending ? "通知待重试" : "",
    task.injectionPending ? "注入待重试" : "",
    task.cancelRequestedAt && !task.cancelCompletedAt && task.status === "running" ? "取消中" : "",
  ]
    .filter(Boolean)
    .map((item) => `；${item}`)
    .join("");
  return `- ${task.taskId} [${task.status}] ${task.targetAgent}${role} -> ${task.workerSession ?? "未分配"}${group}${source}${summary}${reliability}`;
}

function renderGroupListItem(group: OrchestrationGroupSummary): string {
  const reliability = [
    group.group.injectionPending ? "注入待重试" : "",
  ]
    .filter(Boolean)
    .map((item) => `；${item}`)
    .join("");
  return [
    `- ${group.group.groupId}`,
    group.group.title,
    `总计 ${group.totalTasks}`,
    `待确认 ${group.pendingApprovalTasks}`,
    `运行中 ${group.runningTasks}`,
    `完成 ${group.completedTasks}`,
    `失败 ${group.failedTasks}`,
    `取消 ${group.cancelledTasks}${reliability}`,
  ].join(" | ");
}

export function renderTaskProgress(task: OrchestrationTaskRecord, summary: string): string {
  return `⏳ 任务「${task.taskId}」（${task.targetAgent}）：${summary}`;
}

export function renderTaskHeartbeat(task: OrchestrationTaskRecord, elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  return `⏳ 任务「${task.taskId}」已运行 ${minutes} 分钟，等待中...`;
}
