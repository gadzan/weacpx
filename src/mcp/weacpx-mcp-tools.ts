import type { CallToolResult, ToolExecution } from "@modelcontextprotocol/sdk/types.js";
import type { WeacpxMcpTransport } from "./weacpx-mcp-transport";
import {
  DEFAULT_TASK_WATCH_POLL_INTERVAL_MS,
  DEFAULT_TASK_WATCH_TIMEOUT_MS,
  MAX_TASK_WATCH_POLL_INTERVAL_MS,
  MAX_TASK_WATCH_TIMEOUT_MS,
} from "../orchestration/task-watch-timeouts";
import { isQuotaDeferredError } from "../weixin/messaging/quota-errors";
import { z } from "zod";

const groupStatusSchema = z.enum(["pending", "running", "terminal"]);
const taskStatusSchema = z.enum([
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
const taskWatchModeSchema = z.enum(["next_event", "until_attention_or_terminal"]);
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
  execution?: ToolExecution;
  handler: (args: Args) => Promise<WeacpxMcpToolResult>;
}

export type WeacpxMcpToolResult = CallToolResult;

export function buildWeacpxMcpToolRegistry(input: {
  transport: WeacpxMcpTransport;
  coordinatorSession: string;
  sourceHandle?: string;
  // External coordinators (Claude Code / Codex / OpenCode connecting via mcp-stdio)
  // cannot route through human-input packages — orchestration-service throws
  // "human input routing is not configured for external coordinator" for
  // coordinator_request_human_input. We filter that tool out of the registry
  // instead of advertising calls that would always fail.
  isExternalCoordinator?: boolean;
  availableAgents?: string[];
}): WeacpxMcpToolDefinition<unknown>[] {
  const { transport, coordinatorSession, sourceHandle, isExternalCoordinator, availableAgents } = input;

  const tools: WeacpxMcpToolDefinition<unknown>[] = [
    {
      name: "delegate_request",
      description: `Delegate a subtask to another agent under the current coordinator. Pass an absolute workingDirectory for the worker. Supports MCP Tasks when the client requests task execution: the tool can return a native task handle immediately, then clients can use tasks/get, tasks/result, tasks/list, and tasks/cancel. For legacy clients, after this returns status=running, keep the returned taskId and use task_get/task_list for non-blocking progress snapshots, or task_watch to long-poll for the next event or terminal state. If status=needs_confirmation, wait for the user to approve or cancel (task_approve / task_cancel) first.${availableAgents && availableAgents.length > 0 ? ` Available agents: ${availableAgents.join(", ")}.` : ""}`,
      execution: { taskSupport: "optional" },
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
      description: "Create a new task group under the current coordinator. Use to batch multiple delegate_request calls together; pass the resulting groupId on each delegate so they share lifecycle and cancellation.",
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
      description: "Fetch a single task-group summary under the current coordinator. Use to check aggregate progress when waiting on a batch of delegations.",
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
      description: "List task groups under the current coordinator. Use to recover groupIds for an earlier batch.",
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
      description: "Cancel all unfinished tasks in a task group under the current coordinator. Use to abort a batch started via group_new + delegate_request.",
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
      description: "Fetch a single task under the current coordinator, including the worker's final result and any pending question. Use to inspect a task snapshot non-blockingly, read the actual output after completion, or inspect a task that requires attention.",
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
      description: "List tasks under the current coordinator. Use to recover taskIds for in-flight delegations or to survey what is still running / blocked.",
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
      description: "Approve a pending task under the current coordinator. Use when delegate_request returned status=needs_confirmation and the user has authorized it; after approval, use task_get/task_list for snapshots or task_watch to long-poll.",
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
      name: "task_cancel",
      description: "Cancel a task under the current coordinator. Works in any non-terminal state: a running delegation is aborted, and a task still waiting for approval (needs_confirmation) is rejected. The task transitions to a terminal state shortly after.",
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
      name: "task_watch",
      description: `Long-poll a task for the next event, attention-required state, or terminal state. This is the recommended way for legacy clients to watch a delegated task without busy-polling task_get. For MCP-task-capable clients, request task execution for this tool to create a background watcher: the call returns a native task handle immediately, and tasks/result returns when the watch condition is met. The native watcher is single-shot: it runs one watch cycle then terminates, so to keep watching start another task_watch with afterSeq set to the returned nextAfterSeq. Defaults: timeout ${DEFAULT_TASK_WATCH_TIMEOUT_MS} ms, poll interval ${DEFAULT_TASK_WATCH_POLL_INTERVAL_MS} ms. Maximums: timeout ${MAX_TASK_WATCH_TIMEOUT_MS} ms, poll interval ${MAX_TASK_WATCH_POLL_INTERVAL_MS} ms.`,
      execution: { taskSupport: "optional" },
      inputSchema: z
        .object({
          taskId: z.string().min(1),
          afterSeq: z.number().int().min(0).optional(),
          mode: taskWatchModeSchema.optional(),
          includeProgress: z.boolean().optional(),
          timeoutMs: z.number().int().min(0).max(MAX_TASK_WATCH_TIMEOUT_MS).optional(),
          pollIntervalMs: z.number().int().min(1).max(MAX_TASK_WATCH_POLL_INTERVAL_MS).optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const result = await transport.watchTask({
            coordinatorSession,
            ...(args as {
              taskId: string;
              afterSeq?: number;
              mode?: "next_event" | "until_attention_or_terminal";
              includeProgress?: boolean;
              timeoutMs?: number;
              pollIntervalMs?: number;
            }),
          });
          return createSuccessResult(renderTaskWatchResult(result), result);
        }),
    },
    {
      name: "worker_raise_question",
      description: "Raise a blocker question for the current bound worker session. Worker-side only: call this from inside a delegated task when you are blocked and need the coordinator's input. Coordinators waiting on a delegation should not call this; use task_get/task_list for snapshots, or task_watch to long-poll.",
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
      description: "Answer a blocked worker question under the current coordinator. Use when task_get shows a pending question; after answering, use task_get/task_list for snapshots or task_watch to long-poll for the worker to finish.",
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
      description: "Create or queue a human question package for blocked tasks under the current coordinator. Use when answering a worker question requires real human input rather than your own judgement.",
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
      name: "coordinator_review_contested_result",
      description: "Review a contested result under the current coordinator. Use when a worker's result has been challenged and the coordinator must decide accept or discard.",
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

  if (isExternalCoordinator) {
    const externalCoordinatorIncompatibleTools = new Set([
      "coordinator_request_human_input",
    ]);
    return tools.filter((tool) => !externalCoordinatorIncompatibleTools.has(tool.name));
  }
  return tools;
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
      // chatKey is an internal weixin routing identifier and intentionally
      // excluded from the MCP response: external coordinators (Codex, Claude
      // Code, etc.) have no use for it and surfacing it leaks delivery-layer
      // wiring.
      return {
        content: [
          {
            type: "text",
            text:
              "Outbound budget exhausted; the action has been recorded as pending and will retry automatically after the next user inbound resets the quota window. No further action required.",
          },
        ],
        structuredContent: { status: "deferred_quota" },
        isError: false,
      };
    }
    return createErrorResult(formatToolError(error));
  }
}


function renderTaskWatchResult(result: {
  status: "event" | "attention_required" | "terminal" | "timeout" | "not_found";
  task: { taskId: string; status: string } | null;
  events: Array<{ seq: number; type: string; at: string; summary?: string; message?: string; status?: string }>;
  nextAfterSeq: number;
  historyTruncated?: boolean;
}): string {
  if (result.status === "not_found" || !result.task) {
    return "Task not found.";
  }
  const header = [
    `Task ${result.task.taskId} watch ${result.status.replace("_", " ")}; current state is ${result.task.status}.`,
    `- nextAfterSeq: ${result.nextAfterSeq}`,
    result.historyTruncated ? "- historyTruncated: true" : "",
  ].filter((line) => line.length > 0);
  const events = result.events.length > 0
    ? [
        "- Events:",
        ...result.events.map((event) => {
          const detail = event.summary ?? event.message ?? event.status ?? "";
          return `  - #${event.seq} ${event.type} at ${event.at}${detail ? `: ${detail}` : ""}`;
        }),
      ]
    : ["- Events: none"];
  const next = result.status === "terminal"
    ? "Next: call task_get to read the final result."
    : result.status === "attention_required"
      ? "Next: call task_get to inspect openQuestion / reviewPending, then resolve it with the recommended action tool."
      : `Next: call task_watch again with afterSeq=${result.nextAfterSeq} to keep watching, preferably as an MCP task if your client supports background task execution.`;
  return [...header, ...events, next].join("\n");
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
  const next = result.status === "needs_confirmation"
    ? `Next: this delegation requires user approval. Tell the user, then call task_approve or task_cancel based on their response.`
    : `Next: task "${result.taskId}" is running. Return this taskId to the user, call task_get/task_list for non-blocking progress snapshots, or task_watch to long-poll for the next event or terminal state.`;
  return [`Delegation task "${result.taskId}" created.`, `- Status: ${result.status}`, next].join("\n");
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
  lastProgressSummary?: string;
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
  if (task.lastProgressSummary) header.push(`- Latest progress: ${task.lastProgressSummary}`);
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
  return [
    `Task "${task.taskId}" approved.`,
    `- Current status: ${task.status}`,
    `Next: use task_get/task_list for non-blocking progress snapshots, or task_watch to long-poll until the worker finishes; then task_get to read the final result.`,
  ].join("\n");
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

function renderCoordinatorReviewContestedResultSuccess(task: { taskId: string; status: string }, decision: "accept" | "discard"): string {
  const actionText = decision === "accept" ? "Accepted" : "Discarded";
  return [`${actionText} contested result for task "${task.taskId}".`, `- Current status: ${task.status}`].join("\n");
}

function formatToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const isConnectionError =
    code === "ECONNREFUSED"
    || code === "ENOENT"
    || code === "ECONNRESET"
    || code === "EPIPE"
    || /server closed without a response|socket hang up/i.test(message);
  if (isConnectionError) {
    return `Failed to connect to the orchestration daemon: ${message}`;
  }
  return message;
}
