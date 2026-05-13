import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { WeacpxMcpTransport } from "./weacpx-mcp-transport";
import {
  DEFAULT_TASK_WAIT_POLL_INTERVAL_MS,
  DEFAULT_TASK_WAIT_TIMEOUT_MS,
  MAX_TASK_WAIT_POLL_INTERVAL_MS,
  MAX_TASK_WAIT_TIMEOUT_MS,
} from "../orchestration/task-wait-timeouts";
import { isQuotaDeferredError } from "../weixin/messaging/quota-errors";
import { z } from "zod";

const groupStatusSchema = z.enum(["pending", "running", "terminal"]);
const taskStatusSchema = z.enum([
  "pending",
  "needs_confirmation",
  "running",
  "blocked",
  "waiting_for_human",
  "completed",
  "failed",
  "cancelled",
]);
const sortSchema = z.enum(["updatedAt", "createdAt"]);
const orderSchema = z.enum(["asc", "desc"]);
const contestedDecisionSchema = z.enum(["accept", "discard"]);
const taskQuestionSchema = z
  .object({
    taskId: z.string().min(1),
    questionId: z.string().min(1),
  })
  .strict();

export interface WeacpxMcpToolDefinition<Args> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Args>;
  handler: (args: Args) => Promise<WeacpxMcpToolResult>;
}

export type WeacpxMcpToolResult = CallToolResult;

export function buildWeacpxMcpToolRegistry(input: {
  transport: WeacpxMcpTransport;
  coordinatorSession: string;
  sourceHandle?: string;
  availableAgents?: string[];
}): WeacpxMcpToolDefinition<unknown>[] {
  const { transport, coordinatorSession, sourceHandle, availableAgents } = input;

  return [
    {
      name: "delegate_request",
      description: `Delegate a subtask to another agent under the current coordinator. Pass an absolute workingDirectory for the worker.${availableAgents && availableAgents.length > 0 ? ` Available agents: ${availableAgents.join(", ")}.` : ""}`,
      inputSchema: z
        .object({
          targetAgent: z.string().min(1),
          task: z.string().min(1),
          workingDirectory: z.string().min(1).optional(),
          role: z.string().min(1).optional(),
          groupId: z.string().min(1).optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const input = args as {
            targetAgent: string;
            task: string;
            workingDirectory?: string;
            role?: string;
            groupId?: string;
          };
          const result = await transport.delegateRequest({
            coordinatorSession,
            ...(sourceHandle ? { sourceHandle } : {}),
            ...input,
          });
          return createSuccessResult(renderDelegateSuccess(result), result);
        }),
    },
    {
      name: "group_new",
      description: "Create a new task group under the current coordinator.",
      inputSchema: z
        .object({
          title: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const group = await transport.createGroup({
            coordinatorSession,
            title: (args as { title: string }).title,
          });
          return createSuccessResult(renderGroupCreated(group), group);
        }),
    },
    {
      name: "group_get",
      description: "Fetch a single task-group summary under the current coordinator.",
      inputSchema: z
        .object({
          groupId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const summary = await transport.getGroup({
            coordinatorSession,
            groupId: (args as { groupId: string }).groupId,
          });
          return createSuccessResult(summary ? renderGroupSummary(summary) : "Group not found.", { group: summary });
        }),
    },
    {
      name: "group_list",
      description: "List task groups under the current coordinator.",
      inputSchema: z
        .object({
          status: groupStatusSchema.optional(),
          stuck: z.boolean().optional(),
          sort: sortSchema.optional(),
          order: orderSchema.optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const { status, stuck, sort, order } = args as { status?: "pending" | "running" | "terminal"; stuck?: boolean; sort?: "updatedAt" | "createdAt"; order?: "asc" | "desc" };
          const summaries = await transport.listGroups({
            coordinatorSession,
            ...(status !== undefined ? { status } : {}),
            ...(stuck !== undefined ? { stuck } : {}),
            ...(sort !== undefined ? { sort } : {}),
            ...(order !== undefined ? { order } : {}),
          });
          return createSuccessResult(renderGroupList(summaries), { groups: summaries });
        }),
    },
    {
      name: "group_cancel",
      description: "Cancel all unfinished tasks in a task group under the current coordinator.",
      inputSchema: z
        .object({
          groupId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const result = await transport.cancelGroup({
            coordinatorSession,
            groupId: (args as { groupId: string }).groupId,
          });
          return createSuccessResult(renderGroupCancelSuccess(result), result);
        }),
    },
    {
      name: "task_get",
      description: "Fetch a single task under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const task = await transport.getTask({
            coordinatorSession,
            taskId: (args as { taskId: string }).taskId,
          });
          return createSuccessResult(task ? renderTaskSummary(task) : "Task not found.", { task });
        }),
    },
    {
      name: "task_list",
      description: "List tasks under the current coordinator.",
      inputSchema: z
        .object({
          status: taskStatusSchema.optional(),
          stuck: z.boolean().optional(),
          sort: sortSchema.optional(),
          order: orderSchema.optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const { status, stuck, sort, order } = args as {
            status?:
              | "pending"
              | "needs_confirmation"
              | "running"
              | "blocked"
              | "waiting_for_human"
              | "completed"
              | "failed"
              | "cancelled";
            stuck?: boolean;
            sort?: "updatedAt" | "createdAt";
            order?: "asc" | "desc";
          };
          const tasks = await transport.listTasks({
            coordinatorSession,
            ...(status !== undefined ? { status } : {}),
            ...(stuck !== undefined ? { stuck } : {}),
            ...(sort !== undefined ? { sort } : {}),
            ...(order !== undefined ? { order } : {}),
          });
          return createSuccessResult(renderTaskList(tasks), { tasks });
        }),
    },
    {
      name: "task_approve",
      description: "Approve a pending task under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const task = await transport.approveTask({
            coordinatorSession,
            taskId: (args as { taskId: string }).taskId,
          });
          return createSuccessResult(renderTaskApprovalSuccess(task), task);
        }),
    },
    {
      name: "task_reject",
      description: "Reject a pending task under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const task = await transport.rejectTask({
            coordinatorSession,
            taskId: (args as { taskId: string }).taskId,
          });
          return createSuccessResult(renderTaskRejectionSuccess(task), task);
        }),
    },
    {
      name: "task_cancel",
      description: "Request cancellation for a task under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const task = await transport.cancelTask({
            coordinatorSession,
            taskId: (args as { taskId: string }).taskId,
          });
          return createSuccessResult(renderTaskCancelRequest(task), task);
        }),
    },
    {
      name: "task_wait",
      description: `Wait for a task to finish or require attention. Defaults: timeout ${DEFAULT_TASK_WAIT_TIMEOUT_MS} ms, poll interval ${DEFAULT_TASK_WAIT_POLL_INTERVAL_MS} ms. Maximums: timeout ${MAX_TASK_WAIT_TIMEOUT_MS} ms, poll interval ${MAX_TASK_WAIT_POLL_INTERVAL_MS} ms.`,
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          timeoutMs: z.number().int().min(0).max(MAX_TASK_WAIT_TIMEOUT_MS).optional(),
          pollIntervalMs: z.number().int().min(1).max(MAX_TASK_WAIT_POLL_INTERVAL_MS).optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const result = await transport.waitTask({
            coordinatorSession,
            ...(args as { taskId: string; timeoutMs?: number; pollIntervalMs?: number }),
          });
          return createSuccessResult(renderTaskWaitResult(result), result);
        }),
    },
    {
      name: "worker_raise_question",
      description: "Raise a blocker question for the current bound worker session.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          question: z.string().min(1),
          whyBlocked: z.string().min(1),
          whatIsNeeded: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          if (!sourceHandle || sourceHandle.trim().length === 0) {
            throw new Error(
              "worker_raise_question requires a bound sourceHandle; start mcp-stdio with --source-handle or WEACPX_SOURCE_HANDLE",
            );
          }
          const result = await transport.workerRaiseQuestion({
            sourceHandle,
            ...(args as {
              taskId: string;
              question: string;
              whyBlocked: string;
              whatIsNeeded: string;
            }),
          });
          return createSuccessResult(renderWorkerRaiseQuestionSuccess(result), result);
        }),
    },
    {
      name: "coordinator_answer_question",
      description: "Answer a blocked worker question under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          questionId: z.string().min(1),
          answer: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const task = await transport.coordinatorAnswerQuestion({
            coordinatorSession,
            ...(args as { taskId: string; questionId: string; answer: string }),
          });
          return createSuccessResult(renderCoordinatorAnswerQuestionSuccess(task), task);
        }),
    },
    {
      name: "coordinator_request_human_input",
      description: "Create or queue a human question package for blocked tasks under the current coordinator.",
      inputSchema: z
        .object({
          taskQuestions: z.array(taskQuestionSchema).min(1),
          promptText: z.string().min(1),
          expectedActivePackageId: z.string().min(1).optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const result = await transport.coordinatorRequestHumanInput({
            coordinatorSession,
            ...(args as {
              taskQuestions: Array<{ taskId: string; questionId: string }>;
              promptText: string;
              expectedActivePackageId?: string;
            }),
          });
          return createSuccessResult(renderCoordinatorRequestHumanInputSuccess(result), result);
        }),
    },
    {
      name: "coordinator_follow_up_human_package",
      description: "Append a follow-up message to the active human question package under the current coordinator.",
      inputSchema: z
        .object({
          packageId: z.string().min(1),
          priorMessageId: z.string().min(1),
          taskQuestions: z.array(taskQuestionSchema).min(1),
          promptText: z.string().min(1),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const result = await transport.coordinatorFollowUpHumanPackage({
            coordinatorSession,
            ...(args as {
              packageId: string;
              priorMessageId: string;
              taskQuestions: Array<{ taskId: string; questionId: string }>;
              promptText: string;
            }),
          });
          return createSuccessResult(renderCoordinatorFollowUpHumanPackageSuccess(result), result);
        }),
    },
    {
      name: "coordinator_review_contested_result",
      description: "Review a contested result under the current coordinator.",
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          reviewId: z.string().min(1),
          decision: contestedDecisionSchema,
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const { decision, ...rest } = args as {
            taskId: string;
            reviewId: string;
            decision: "accept" | "discard";
          };
          const task = await transport.coordinatorReviewContestedResult({
            coordinatorSession,
            decision,
            ...rest,
          });
          return createSuccessResult(renderCoordinatorReviewContestedResultSuccess(task, decision), task);
        }),
    },
  ];
}

async function asToolResult(
  action: () => Promise<WeacpxMcpToolResult>,
): Promise<WeacpxMcpToolResult> {
  try {
    return await action();
  } catch (error) {
    // Quota deferral is NOT a tool failure: the outbound budget is exhausted
    // and the action has already been recorded as pending; it will replay on
    // the next inbound that resets the quota window. Returning isError:true
    // would tempt the coordinator LLM to retry or abort, breaking the
    // active-package invariant. Surface a soft success with a structured
    // status so callers (and prompt templates) can branch on it explicitly.
    if (isQuotaDeferredError(error)) {
      return {
        content: [
          {
            type: "text",
            text:
              "Outbound budget exhausted; the action has been recorded as pending and will retry automatically after the next user inbound resets the quota window. No further action required.",
          },
        ],
        structuredContent: { status: "deferred_quota", chatKey: error.chatKey },
        isError: false,
      };
    }
    return createErrorResult(formatToolError(error));
  }
}


function renderTaskWaitResult(result: {
  status: "terminal" | "attention_required" | "timeout" | "not_found";
  task: { taskId: string; status: string } | null;
}): string {
  if (result.status === "not_found") {
    return "Task not found.";
  }
  if (!result.task) {
    return `Task wait ${result.status.replace("_", " ")}; current state is unavailable.`;
  }
  if (result.status === "timeout") {
    return `Task ${result.task.taskId} wait timed out; current state is ${result.task.status}.`;
  }
  if (result.status === "attention_required") {
    return `Task ${result.task.taskId} requires attention; current state is ${result.task.status}.`;
  }
  return `Task ${result.task.taskId} reached terminal state ${result.task.status}.`;
}

function createSuccessResult(
  text: string,
  structuredContent?: object,
): WeacpxMcpToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}),
  };
}

function createErrorResult(message: string): WeacpxMcpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function renderDelegateSuccess(result: { taskId: string; status: string }): string {
  return [`Delegation task "${result.taskId}" created.`, `- Status: ${result.status}`].join("\n");
}

function renderGroupCreated(group: { groupId: string; title: string }): string {
  return [`Task group "${group.groupId}" created.`, `- Title: ${group.title}`].join("\n");
}

function renderGroupSummary(summary: {
  group: { groupId: string; title: string; coordinatorSession: string; injectionPending?: boolean; injectionAppliedAt?: string; lastInjectionError?: string };
  totalTasks: number;
  pendingApprovalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  terminal: boolean;
  tasks: Array<{ taskId: string; status: string; targetAgent: string }>;
}): string {
  const { group, tasks } = summary;
  const lines = [
    `Task group "${group.groupId}"`,
    `- Title: ${group.title}`,
    `- Coordinator session: ${group.coordinatorSession}`,
    `- Total tasks: ${summary.totalTasks}`,
    `- Pending approval: ${summary.pendingApprovalTasks}`,
    `- Running: ${summary.runningTasks}`,
    `- Completed: ${summary.completedTasks}`,
    `- Failed: ${summary.failedTasks}`,
    `- Cancelled: ${summary.cancelledTasks}`,
    `- Terminal: ${summary.terminal ? "yes" : "no"}`,
  ];
  if (group.injectionPending !== undefined) {
    lines.push(`- Injection pending: ${group.injectionPending ? "yes" : "no"}`);
  }
  if (group.injectionAppliedAt) {
    lines.push(`- Injection completed at: ${group.injectionAppliedAt}`);
  }
  if (group.lastInjectionError) {
    lines.push(`- Last injection error: ${group.lastInjectionError}`);
  }
  if (tasks.length > 0) {
    lines.push("- Members:");
    for (const task of tasks) {
      lines.push(`  - ${task.taskId} [${task.status}] ${task.targetAgent}`);
    }
  }
  return lines.join("\n");
}

function renderGroupList(groups: Array<{
  group: { groupId: string; title: string; injectionPending?: boolean };
  totalTasks: number;
  pendingApprovalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
}>): string {
  if (groups.length === 0) {
    return "There are no task groups under the current coordinator.";
  }
  return ["Task groups for the current coordinator:", ...groups.map((group) => renderGroupListItem(group))].join("\n");
}

function renderGroupListItem(group: {
  group: { groupId: string; title: string; injectionPending?: boolean };
  totalTasks: number;
  pendingApprovalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
}): string {
  const reliability = group.group.injectionPending ? " | injection pending" : "";
  return [
    `- ${group.group.groupId}`,
    group.group.title,
    `total ${group.totalTasks}`,
    `pending ${group.pendingApprovalTasks}`,
    `running ${group.runningTasks}`,
    `completed ${group.completedTasks}`,
    `failed ${group.failedTasks}`,
    `cancelled ${group.cancelledTasks}${reliability}`,
  ].join(" | ");
}

function renderGroupCancelSuccess(input: {
  summary: { group: { groupId: string } };
  cancelledTaskIds: string[];
  skippedTaskIds: string[];
}): string {
  return [
    `Task group "${input.summary.group.groupId}" cancellation requested.`,
    `- Cancel requested: ${input.cancelledTaskIds.length}`,
    `- Skipped terminal tasks: ${input.skippedTaskIds.length}`,
  ].join("\n");
}

function renderTaskList(tasks: Array<{ taskId: string; status: string; targetAgent: string; workerSession?: string; role?: string; groupId?: string; summary: string; noticePending?: boolean; injectionPending?: boolean; cancelRequestedAt?: string | undefined; cancelCompletedAt?: string | undefined }>): string {
  if (tasks.length === 0) {
    return "There are no tasks under the current coordinator.";
  }
  return ["Tasks for the current coordinator:", ...tasks.map((task) => renderTaskListItem(task))].join("\n");
}

function renderTaskListItem(task: {
  taskId: string;
  status: string;
  targetAgent: string;
  workerSession?: string;
  role?: string;
  groupId?: string;
  summary: string;
  noticePending?: boolean;
  injectionPending?: boolean;
  cancelRequestedAt?: string | undefined;
  cancelCompletedAt?: string | undefined;
}): string {
  const role = task.role ? ` / ${task.role}` : "";
  const group = task.groupId ? `; group: ${task.groupId}` : "";
  const summary = task.summary.trim().length > 0 ? `: ${task.summary}` : "";
  const source = task.status === "needs_confirmation" ? `; source: ${task.targetAgent}${task.role ? ` / ${task.role}` : ""}` : "";
  const reliability = [
    task.noticePending ? "notice pending retry" : "",
    task.injectionPending ? "injection pending retry" : "",
    task.cancelRequestedAt && !task.cancelCompletedAt && task.status === "running" ? "cancelling" : "",
  ]
    .filter(Boolean)
    .map((item) => `; ${item}`)
    .join("");
  return `- ${task.taskId} [${task.status}] ${task.targetAgent}${role} -> ${task.workerSession ?? "unassigned"}${group}${source}${summary}${reliability}`;
}

function renderTaskSummary(task: {
  taskId: string;
  status: string;
  coordinatorSession: string;
  workerSession?: string;
  targetAgent: string;
  role?: string;
  groupId?: string;
  sourceKind: string;
  sourceHandle: string;
  task: string;
  summary: string;
  resultText: string;
  createdAt: string;
  updatedAt: string;
  lastProgressAt?: string;
  cancelRequestedAt?: string;
  cancelCompletedAt?: string;
  lastCancelError?: string;
  noticeSentAt?: string;
  deliveryAccountId?: string;
  lastNoticeError?: string;
  injectionAppliedAt?: string;
  lastInjectionError?: string;
  noticePending?: boolean;
  injectionPending?: boolean;
}): string {
  const header = [
    `Task "${task.taskId}"`,
    `- Status: ${task.status}`,
    `- Coordinator session: ${task.coordinatorSession}`,
    `- Worker session: ${task.workerSession ?? "unassigned"}`,
    `- Target agent: ${task.targetAgent}`,
  ];
  if (task.role) header.push(`- Role: ${task.role}`);
  if (task.groupId) header.push(`- Group: ${task.groupId}`);
  if (task.status === "needs_confirmation") {
    header.push(`- Source: ${task.sourceKind} / ${task.sourceHandle}${task.role ? ` / ${task.role}` : ""}`);
  }
  header.push(`- Task: ${task.task}`);
  if (task.summary.trim().length > 0) header.push(`- Summary: ${task.summary}`);
  if (task.resultText.trim().length > 0) header.push(`- Result: ${task.resultText}`);
  const events: Array<{ at: string; event: string; detail?: string }> = [];
  events.push({ at: task.createdAt, event: "created" });
  if (task.workerSession && task.status !== "needs_confirmation") {
    events.push({ at: task.createdAt, event: "dispatched", detail: task.workerSession });
  }
  if (task.lastProgressAt) events.push({ at: task.lastProgressAt, event: "last progress" });
  if (task.cancelRequestedAt) events.push({ at: task.cancelRequestedAt, event: "cancel requested" });
  if (task.cancelCompletedAt) events.push({ at: task.cancelCompletedAt, event: "cancel completed" });
  if (task.lastCancelError) events.push({ at: task.updatedAt, event: "cancel failed", detail: task.lastCancelError });
  if (task.status === "completed") events.push({ at: task.updatedAt, event: "completed" });
  if (task.status === "failed") events.push({ at: task.updatedAt, event: "failed" });
  if (task.noticeSentAt) events.push({ at: task.noticeSentAt, event: "notice sent", detail: task.deliveryAccountId });
  if (task.lastNoticeError) events.push({ at: task.updatedAt, event: "notice failed", detail: task.lastNoticeError });
  if (task.injectionAppliedAt) events.push({ at: task.injectionAppliedAt, event: "injection applied" });
  if (task.lastInjectionError) events.push({ at: task.updatedAt, event: "injection failed", detail: task.lastInjectionError });
  events.sort((a, b) => a.at.localeCompare(b.at));
  const timeline = events.length > 0
    ? ["- Timeline:", ...events.map((e) => `  - [${e.at}] ${e.event}${e.detail ? `: ${e.detail}` : ""}`)]
    : [];
  return [...header, ...timeline].join("\n");
}

function renderTaskCancelRequest(task: { taskId: string; status: string }): string {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return [`Task "${task.taskId}" has already finished.`, `- Current status: ${task.status}`].join("\n");
  }
  return [`Cancellation requested for task "${task.taskId}".`, `- Current status: ${task.status}`].join("\n");
}

function renderTaskApprovalSuccess(task: { taskId: string; status: string }): string {
  return [`Task "${task.taskId}" approved.`, `- Current status: ${task.status}`].join("\n");
}

function renderTaskRejectionSuccess(task: { taskId: string; status: string }): string {
  return [`Task "${task.taskId}" rejected.`, `- Current status: ${task.status}`].join("\n");
}

function renderWorkerRaiseQuestionSuccess(task: { taskId: string; questionId: string }): string {
  return [`Blocker question submitted for task "${task.taskId}".`, `- questionId: ${task.questionId}`].join("\n");
}

function renderCoordinatorAnswerQuestionSuccess(task: { taskId: string; status: string }): string {
  return [`Answered the blocker question for task "${task.taskId}".`, `- Current status: ${task.status}`].join("\n");
}

function renderCoordinatorRequestHumanInputSuccess(result: { packageId?: string; queuedTaskIds: string[] }): string {
  return result.packageId
    ? [`Created human question package "${result.packageId}".`, `- Queued tasks: ${result.queuedTaskIds.length}`].join("\n")
    : [`Queued the question in the current human question queue.`, `- Queued tasks: ${result.queuedTaskIds.length}`].join("\n");
}

function renderCoordinatorFollowUpHumanPackageSuccess(result: { packageId: string; messageId: string }): string {
  return [`Appended follow-up to human package "${result.packageId}".`, `- messageId: ${result.messageId}`].join("\n");
}

function renderCoordinatorReviewContestedResultSuccess(task: { taskId: string; status: string }, decision: "accept" | "discard"): string {
  const actionText = decision === "accept" ? "Accepted" : "Discarded";
  return [`${actionText} contested result for task "${task.taskId}".`, `- Current status: ${task.status}`].join("\n");
}

function formatToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOENT|server closed without a response|socket hang up|connect /i.test(message)) {
    return `Failed to connect to the orchestration daemon: ${message}`;
  }
  return message;
}
