import type { GroupListFilter, TaskListFilter } from "../parse-command";
import {
  renderDelegateSuccess,
  renderGroupCancelSuccess,
  renderGroupCreated,
  renderGroupList,
  renderGroupSummary,
  renderTaskConfirmationUnavailable,
  renderOrchestrationUnavailable,
  renderTaskApprovalSuccess,
  renderTaskCancelSuccess,
  renderTaskList,
  renderTaskRejectionSuccess,
  renderTaskSummary,
  renderTasksCleanResult,
} from "../../formatting/render-text";
import type { ResolvedSession } from "../../transport/types";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, OrchestrationRouterOps, RouterResponse } from "../router-types";

const NO_CURRENT_SESSION_TEXT = "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。";
const TASK_NOT_FOUND_TEXT = "没有找到对应任务。";
const GROUP_NOT_FOUND_TEXT = "没有找到对应任务组。";

export const orchestrationHelp: HelpTopicMetadata = {
  topic: "orchestration",
  aliases: ["delegate", "dg", "task", "tasks", "group", "groups"],
  summary: "委派子任务、组织任务组、查看任务状态，并处理待确认的编排请求。",
  commands: [
    { usage: "/dg <agent> <task>", description: "把当前主线中的子任务快速委派给目标 agent" },
    { usage: "/delegate <agent> <task>", description: "把当前主线中的子任务委派给目标 agent" },
    { usage: "/delegate <agent> --role <role> <task>", description: "按指定角色模板委派子任务" },
    { usage: "/delegate <agent> --group <groupId> <task>", description: "把委派任务附加到指定任务组" },
    { usage: "/group new <title>", description: "在当前主线下创建一个任务组" },
    { usage: "/group <id>", description: "查看单个任务组详情" },
    { usage: "/group add <groupId> <agent> <task>", description: "把子任务加入已有任务组（等价于 /delegate --group）" },
    { usage: "/group add <groupId> <agent> --role <role> <task>", description: "按角色模板把子任务加入已有任务组" },
    { usage: "/group cancel <groupId>", description: "取消指定任务组下所有未结束任务" },
    { usage: "/groups", description: "查看当前主线下的任务组列表" },
    { usage: "/tasks", description: "查看当前主线下的任务列表" },
    { usage: "/tasks --status <state>", description: "按状态过滤任务（running/completed/failed/cancelled/needs_confirmation）" },
    { usage: "/tasks --stuck", description: "只看心跳超时的 running 任务" },
    { usage: "/tasks clean", description: "清理当前主线下的已结束任务和无效绑定" },
    { usage: "/task <id>", description: "查看单个任务详情" },
    { usage: "/task approve <id>", description: "批准一个 needs_confirmation 任务并开始派发" },
    { usage: "/task reject <id>", description: "拒绝一个 needs_confirmation 任务" },
    { usage: "/task cancel <id>", description: "取消当前主线下的任务" },
  ],
  examples: [
    "/dg claude 审查当前方案的 3 个最高风险点",
    "/dg claude --group review-batch 审查接口设计",
    "/dg codex --role planner 把这个需求拆成最小实现步骤",
    "/group new parallel review",
    "/group add review-batch claude --role reviewer 审查接口设计",
    "/groups",
    "/group cancel review-batch",
    "/tasks",
    "/tasks clean",
    "/task approve task_123",
  ],
};

export async function handleDelegateRequest(
  context: CommandRouterContext,
  chatKey: string,
  targetAgent: string,
  task: string,
  role?: string,
  groupId?: string,
  replyContextToken?: string,
  accountId?: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const result = await orchestration.requestDelegate({
    sourceHandle: session.transportSession,
    sourceKind: "coordinator",
    coordinatorSession: session.transportSession,
    workspace: session.workspace,
    targetAgent,
    task,
    ...(role ? { role } : {}),
    ...(groupId ? { groupId } : {}),
    chatKey,
    ...(replyContextToken ? { replyContextToken } : {}),
    ...(accountId ? { accountId } : {}),
  });

  return { text: renderDelegateSuccess(result.taskId, result.workerSession) };
}

export async function handleGroupCreate(
  context: CommandRouterContext,
  chatKey: string,
  title: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.createGroup({
    coordinatorSession: session.transportSession,
    title,
  });
  return { text: renderGroupCreated(group) };
}

export async function handleGroupList(
  context: CommandRouterContext,
  chatKey: string,
  filter?: GroupListFilter,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const groups = await orchestration.listGroupSummaries({
    coordinatorSession: session.transportSession,
    ...(filter ?? {}),
  });
  return { text: renderGroupList(groups) };
}

export async function handleGroupGet(
  context: CommandRouterContext,
  chatKey: string,
  groupId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession: session.transportSession,
  });
  if (!group) {
    return { text: GROUP_NOT_FOUND_TEXT };
  }
  return { text: renderGroupSummary(group) };
}

export async function handleGroupCancel(
  context: CommandRouterContext,
  chatKey: string,
  groupId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession: session.transportSession,
  });
  if (!group) {
    return { text: GROUP_NOT_FOUND_TEXT };
  }

  const cancelled = await orchestration.cancelGroup({
    groupId,
    coordinatorSession: session.transportSession,
  });
  return { text: renderGroupCancelSuccess(cancelled) };
}

export async function handleGroupDelegate(
  context: CommandRouterContext,
  chatKey: string,
  groupId: string,
  targetAgent: string,
  task: string,
  role?: string,
  replyContextToken?: string,
  accountId?: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession: session.transportSession,
  });
  if (!group) {
    return { text: GROUP_NOT_FOUND_TEXT };
  }

  return await handleDelegateRequest(
    context,
    chatKey,
    targetAgent,
    task,
    role,
    groupId,
    replyContextToken,
    accountId,
  );
}

export async function handleTaskList(
  context: CommandRouterContext,
  chatKey: string,
  filter?: TaskListFilter,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const tasks = await orchestration.listTasks({
    coordinatorSession: session.transportSession,
    ...(filter ?? {}),
  });
  return { text: renderTaskList(tasks) };
}

export async function handleTaskGet(context: CommandRouterContext, chatKey: string, taskId: string): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || task.coordinatorSession !== session.transportSession) {
    return { text: TASK_NOT_FOUND_TEXT };
  }

  return { text: renderTaskSummary(task) };
}

export async function handleTaskApprove(
  context: CommandRouterContext,
  chatKey: string,
  taskId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || task.coordinatorSession !== session.transportSession) {
    return { text: TASK_NOT_FOUND_TEXT };
  }
  if (task.status !== "needs_confirmation") {
    return { text: renderTaskConfirmationUnavailable(task) };
  }

  const approved = await orchestration.approveTask({
    taskId,
    coordinatorSession: session.transportSession,
  });

  return { text: renderTaskApprovalSuccess(approved) };
}

export async function handleTaskReject(
  context: CommandRouterContext,
  chatKey: string,
  taskId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || task.coordinatorSession !== session.transportSession) {
    return { text: TASK_NOT_FOUND_TEXT };
  }
  if (task.status !== "needs_confirmation") {
    return { text: renderTaskConfirmationUnavailable(task) };
  }

  const rejected = await orchestration.rejectTask({
    taskId,
    coordinatorSession: session.transportSession,
  });

  return { text: renderTaskRejectionSuccess(rejected) };
}

export async function handleTaskCancel(
  context: CommandRouterContext,
  chatKey: string,
  taskId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || task.coordinatorSession !== session.transportSession) {
    return { text: TASK_NOT_FOUND_TEXT };
  }

  const cancelled = await orchestration.requestTaskCancellation({
    taskId,
    coordinatorSession: session.transportSession,
  });

  return { text: renderTaskCancelSuccess(cancelled) };
}

export async function handleTasksClean(context: CommandRouterContext, chatKey: string): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: NO_CURRENT_SESSION_TEXT };
  }

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const result = await orchestration.cleanTasks(session.transportSession);
  return { text: renderTasksCleanResult(result.removedTasks, result.removedBindings) };
}

async function getCurrentSession(context: CommandRouterContext, chatKey: string): Promise<ResolvedSession | null> {
  return await context.sessions.getCurrentSession(chatKey);
}

function getOrchestration(context: CommandRouterContext): OrchestrationRouterOps | null {
  return context.orchestration ?? null;
}
