import { renderGroupCancelSuccess, renderGroupList, renderGroupSummary, renderTaskApprovalSuccess, renderTaskList, renderTaskRejectionSuccess, renderTaskSummary } from "../formatting/render-text";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { WeacpxMcpTransport } from "./weacpx-mcp-transport";
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
}): WeacpxMcpToolDefinition<unknown>[] {
  const { transport, coordinatorSession, sourceHandle } = input;

  return [
    {
      name: "delegate_request",
      description: "Delegate a subtask to another agent under the current coordinator.",
      inputSchema: z
        .object({
          targetAgent: z.string().min(1),
          task: z.string().min(1),
          role: z.string().min(1).optional(),
          groupId: z.string().min(1).optional(),
        })
        .strict(),
      handler: async (args) =>
        await asToolResult(async () => {
          const input = args as {
            targetAgent: string;
            task: string;
            role?: string;
            groupId?: string;
          };
          const result = await transport.delegateRequest({
            coordinatorSession,
            ...(sourceHandle ? { sourceHandle } : {}),
            ...input,
          });
          return createSuccessResult(`Delegation task ${result.taskId} is ${result.status}.`, result);
        }),
    },
    {
      name: "group_new",
      description: "Create a new task group for the current coordinator.",
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
          return createSuccessResult(`Group ${group.groupId} created (title: ${group.title}).`, group);
        }),
    },
    {
      name: "group_get",
      description: "Fetch a single task group summary for the current coordinator.",
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
      description: "List task groups for the current coordinator.",
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
      description: "Cancel all unfinished tasks in a task group for the current coordinator.",
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
      description: "Fetch a single orchestration task for the current coordinator.",
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
      description: "List orchestration tasks for the current coordinator.",
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
      description: "Approve a pending orchestration task for the current coordinator.",
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
      description: "Reject a pending orchestration task for the current coordinator.",
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
      description: "Request cancellation for an orchestration task under the current coordinator.",
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
          return createSuccessResult(`任务「${task.taskId}」已请求取消。`, task);
        }),
    },
    {
      name: "worker_raise_question",
      description: "Raise a blocker question for the current bound session.",
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
          return createSuccessResult(
            [`任务「${result.taskId}」已提交 blocker 问题。`, `- questionId：${result.questionId}`].join("\n"),
            result,
          );
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
          return createSuccessResult(
            [`已回答任务「${task.taskId}」的 blocker 问题。`, `- 当前状态：${task.status}`].join("\n"),
            task,
          );
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
          const text = result.packageId
            ? [`已创建 human question package「${result.packageId}」。`, `- 已排队任务：${result.queuedTaskIds.length}`].join("\n")
            : [`问题已加入当前 human question queue。`, `- 已排队任务：${result.queuedTaskIds.length}`].join("\n");
          return createSuccessResult(text, result);
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
          return createSuccessResult(
            [`已追加 human package「${result.packageId}」跟进消息。`, `- messageId：${result.messageId}`].join("\n"),
            result,
          );
        }),
    },
    {
      name: "coordinator_review_contested_result",
      description: "Review a contested coordinator result under the current coordinator.",
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
          const actionText = decision === "accept" ? "已接受" : "已丢弃";
          return createSuccessResult(
            [`${actionText}任务「${task.taskId}」的 contested result。`, `- 当前状态：${task.status}`].join("\n"),
            task,
          );
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

function formatToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ENOENT|server closed without a response|socket hang up|connect /i.test(message)) {
    return `无法连接到 orchestration daemon：${message}`;
  }
  return message;
}
