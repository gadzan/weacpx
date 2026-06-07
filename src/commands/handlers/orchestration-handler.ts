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
  renderTaskRejectSuccess,
  renderTaskList,
  renderTaskSummary,
  renderTasksCleanResult,
} from "../../formatting/render-text";
import type { ResolvedSession } from "../../transport/types";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, OrchestrationRouterOps, RouterResponse } from "../router-types";
import { t } from "../../i18n";
import { sameCoordinatorSession, stableCoordinatorSession } from "../../orchestration/coordinator-identity";

export function orchestrationHelp(): HelpTopicMetadata {
  const o = t().orchestration;
  return {
    topic: "orchestration",
    aliases: ["delegate", "dg", "task", "tasks", "group", "groups"],
    summary: o.helpSummary,
    commands: [
      { usage: o.helpCmdDg, description: o.helpCmdDgDesc },
      { usage: o.helpCmdDelegate, description: o.helpCmdDelegateDesc },
      { usage: o.helpCmdDelegateRole, description: o.helpCmdDelegateRoleDesc },
      { usage: o.helpCmdDelegateGroup, description: o.helpCmdDelegateGroupDesc },
      { usage: o.helpCmdGroupNew, description: o.helpCmdGroupNewDesc },
      { usage: o.helpCmdGroupGet, description: o.helpCmdGroupGetDesc },
      { usage: o.helpCmdGroupAdd, description: o.helpCmdGroupAddDesc },
      { usage: o.helpCmdGroupAddRole, description: o.helpCmdGroupAddRoleDesc },
      { usage: o.helpCmdGroupCancel, description: o.helpCmdGroupCancelDesc },
      { usage: o.helpCmdGroups, description: o.helpCmdGroupsDesc },
      { usage: o.helpCmdTasks, description: o.helpCmdTasksDesc },
      { usage: o.helpCmdTasksStatus, description: o.helpCmdTasksStatusDesc },
      { usage: o.helpCmdTasksStuck, description: o.helpCmdTasksStuckDesc },
      { usage: o.helpCmdTasksClean, description: o.helpCmdTasksCleanDesc },
      { usage: o.helpCmdTaskGet, description: o.helpCmdTaskGetDesc },
      { usage: o.helpCmdTaskApprove, description: o.helpCmdTaskApproveDesc },
      { usage: o.helpCmdTaskReject, description: o.helpCmdTaskRejectDesc },
      { usage: o.helpCmdTaskCancel, description: o.helpCmdTaskCancelDesc },
    ],
    examples: [
      o.helpExample1,
      o.helpExample2,
      o.helpExample3,
      o.helpExample4,
      o.helpExample5,
      o.helpExample6,
      o.helpExample7,
      o.helpExample8,
      o.helpExample9,
      o.helpExample10,
    ],
  };
}

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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const result = await orchestration.requestDelegate({
    sourceHandle: session.transportSession,
    sourceKind: "coordinator",
    coordinatorSession,
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.createGroup({
    coordinatorSession,
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const groups = await orchestration.listGroupSummaries({
    coordinatorSession,
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession,
  });
  if (!group) {
    return { text: t().orchestration.groupNotFound };
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession,
  });
  if (!group) {
    return { text: t().orchestration.groupNotFound };
  }

  const cancelled = await orchestration.cancelGroup({
    groupId,
    coordinatorSession,
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const group = await orchestration.getGroupSummary({
    groupId,
    coordinatorSession,
  });
  if (!group) {
    return { text: t().orchestration.groupNotFound };
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const tasks = await orchestration.listTasks({
    coordinatorSession,
    ...(filter ?? {}),
  });
  return { text: renderTaskList(tasks) };
}

export async function handleTaskGet(context: CommandRouterContext, chatKey: string, taskId: string): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || !sameCoordinatorSession(task.coordinatorSession, coordinatorSession)) {
    return { text: t().orchestration.taskNotFound };
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || !sameCoordinatorSession(task.coordinatorSession, coordinatorSession)) {
    return { text: t().orchestration.taskNotFound };
  }
  if (task.status !== "needs_confirmation") {
    return { text: renderTaskConfirmationUnavailable(task) };
  }

  const approved = await orchestration.approveTask({
    taskId,
    coordinatorSession,
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
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || !sameCoordinatorSession(task.coordinatorSession, coordinatorSession)) {
    return { text: t().orchestration.taskNotFound };
  }
  if (task.status !== "needs_confirmation") {
    return { text: renderTaskConfirmationUnavailable(task) };
  }

  const rejected = await orchestration.cancelTask({
    taskId,
    coordinatorSession,
  });

  return { text: renderTaskRejectSuccess(rejected) };
}

export async function handleTaskCancel(
  context: CommandRouterContext,
  chatKey: string,
  taskId: string,
): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const task = await orchestration.getTask(taskId);
  if (!task || !sameCoordinatorSession(task.coordinatorSession, coordinatorSession)) {
    return { text: t().orchestration.taskNotFound };
  }

  const cancelled = await orchestration.requestTaskCancellation({
    taskId,
    coordinatorSession,
  });

  return { text: renderTaskCancelSuccess(cancelled) };
}

export async function handleTasksClean(context: CommandRouterContext, chatKey: string): Promise<RouterResponse> {
  const session = await getCurrentSession(context, chatKey);
  if (!session) {
    return { text: t().orchestration.noCurrentSession };
  }

  const coordinatorSession = stableCoordinatorSession(session.transportSession);

  const orchestration = getOrchestration(context);
  if (!orchestration) {
    return { text: renderOrchestrationUnavailable() };
  }

  const result = await orchestration.cleanTasks(coordinatorSession);
  return { text: renderTasksCleanResult(result.removedTasks, result.removedBindings) };
}

async function getCurrentSession(context: CommandRouterContext, chatKey: string): Promise<ResolvedSession | null> {
  return await context.sessions.getCurrentSession(chatKey);
}

function getOrchestration(context: CommandRouterContext): OrchestrationRouterOps | null {
  return context.orchestration ?? null;
}
