import type { AppConfig } from "../config/types";
import type { AppLogger } from "../logging/app-logger";
import type { AppState } from "../state/types";
import type {
  OrchestrationCoordinatorQuestionStateRecord,
  OrchestrationCoordinatorRouteContextRecord,
  OrchestrationGroupRecord,
  OrchestrationGroupSummary,
  OrchestrationHumanQuestionPackageMessageRecord,
  OrchestrationHumanQuestionPackageRecord,
  OrchestrationOpenQuestionRecord,
  OrchestrationSourceKind,
  OrchestrationTaskRecord,
  OrchestrationTaskStatus,
} from "./orchestration-types";
import { AsyncMutex } from "./async-mutex";
import { stripProgressLines } from "./progress-line-parser";
import { isQuotaDeferredError } from "../weixin/messaging/quota-errors";

export interface RequestDelegateInput {
  sourceHandle: string;
  sourceKind: OrchestrationSourceKind;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  task: string;
  role?: string;
  groupId?: string;
  chatKey?: string;
  replyContextToken?: string;
  accountId?: string;
}

export interface RequestDelegateRpcInput {
  sourceHandle: string;
  targetAgent: string;
  task: string;
  role?: string;
  groupId?: string;
}

export interface RequestDelegateResult {
  taskId: string;
  status: OrchestrationTaskStatus;
  workerSession: string;
}

export interface RequestDelegateRpcResult {
  taskId: string;
  status: Extract<OrchestrationTaskStatus, "needs_confirmation" | "running">;
  workerSession?: string;
}

export interface RecordWorkerReplyInput {
  taskId: string;
  sourceHandle: string;
  status?: Extract<OrchestrationTaskStatus, "completed" | "failed" | "cancelled">;
  summary?: string;
  resultText?: string;
}

export interface RecordTaskNoticeDeliveryInput {
  taskId: string;
  deliveryAccountId: string;
}

export interface MarkTaskErrorInput {
  taskId: string;
  errorMessage: string;
}

export interface CancelTaskInput {
  taskId: string;
  sourceHandle?: string;
  coordinatorSession?: string;
}

export interface CancelWorkerTaskRequest {
  taskId: string;
  workerSession: string;
  workspace: string;
  targetAgent: string;
}

export interface ResumeWorkerTaskRequest {
  taskId: string;
  workerSession: string;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  answer: string;
}

export interface WakeCoordinatorRequest {
  coordinatorSession: string;
}

export interface DeliverCoordinatorMessageRequest {
  coordinatorSession: string;
  chatKey: string;
  accountId?: string;
  replyContextToken?: string;
  text: string;
}

type FrozenCoordinatorDeliveryRoute = Pick<
  DeliverCoordinatorMessageRequest,
  "chatKey" | "accountId" | "replyContextToken"
>;

export interface ConfirmTaskInput {
  taskId: string;
  coordinatorSession: string;
}

export interface WorkerRaiseQuestionInput {
  taskId: string;
  sourceHandle: string;
  question: string;
  whyBlocked: string;
  whatIsNeeded: string;
}

export interface CoordinatorTaskQuestionRef {
  taskId: string;
  questionId: string;
}

export interface CoordinatorRequestHumanInputResult {
  packageId?: string;
  queuedTaskIds: string[];
}

export interface CoordinatorFollowUpHumanPackageResult {
  packageId: string;
  messageId: string;
}

export interface RetryHumanQuestionPackageDeliveryResult {
  packageId: string;
  messageId: string;
}

export interface ClaimedActiveHumanReply {
  coordinatorSession: string;
  packageId: string;
  messageId: string;
  chatKey: string;
  promptText: string;
  taskQuestions: CoordinatorTaskQuestionRef[];
  queuedCount: number;
}

export interface ActiveHumanQuestionPackage {
  packageId: string;
  promptText: string;
  awaitingReplyMessageId?: string;
  deliveredChatKey?: string;
  deliveryAccountId?: string;
  routeReplyContextToken?: string;
  deliveredAt?: string;
  openTaskIds: string[];
  messageTaskQuestions?: Array<{
    taskId: string;
    questionId: string;
  }>;
  openTaskQuestions?: Array<{
    taskId: string;
    questionId: string;
    question: string;
    whyBlocked: string;
    whatIsNeeded: string;
  }>;
  queuedCount: number;
}

export interface OrchestrationServiceDeps {
  now: () => Date;
  createId: () => string;
  loadState: () => Promise<AppState>;
  saveState: (state: AppState) => Promise<void>;
  config: AppConfig;
  ensureWorkerSession: (request: EnsureWorkerSessionRequest) => Promise<string>;
  dispatchWorkerTask: (request: DispatchWorkerTaskRequest) => Promise<void>;
  cancelWorkerTask?: (request: CancelWorkerTaskRequest) => Promise<void>;
  resumeWorkerTask?: (request: ResumeWorkerTaskRequest) => Promise<void>;
  wakeCoordinatorSession?: (request: WakeCoordinatorRequest) => Promise<void>;
  deliverCoordinatorMessage?: (
    request: DeliverCoordinatorMessageRequest,
  ) => Promise<FrozenCoordinatorDeliveryRoute | void>;
  interruptWorkerTask?: (request: CancelWorkerTaskRequest) => Promise<void>;
  findReusableWorkerSession?: (
    request: ReusableWorkerLookupRequest,
  ) => Promise<string | null | undefined> | string | null | undefined;
  logger?: AppLogger;
}

export interface EnsureWorkerSessionRequest {
  workerSession: string;
  sourceHandle: string;
  sourceKind: OrchestrationSourceKind;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  role?: string;
}

export interface ReusableWorkerLookupRequest {
  sourceHandle: string;
  sourceKind: OrchestrationSourceKind;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  role?: string;
}

export interface DispatchWorkerTaskRequest {
  taskId: string;
  workerSession: string;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  role?: string;
  task: string;
}

export interface CancelGroupResult {
  summary: OrchestrationGroupSummary;
  cancelledTaskIds: string[];
  skippedTaskIds: string[];
}

export interface CleanTasksResult {
  removedTasks: number;
  removedBindings: number;
}

export interface OrchestrationTaskFilter {
  sourceHandle?: string;
  coordinatorSession?: string;
  workspace?: string;
  targetAgent?: string;
  role?: string;
  status?: OrchestrationTaskStatus;
  stuck?: boolean;
  sort?: "updatedAt" | "createdAt";
  order?: "asc" | "desc";
}

export interface OrchestrationGroupListFilter {
  coordinatorSession: string;
  status?: "pending" | "running" | "terminal";
  stuck?: boolean;
  sort?: "updatedAt" | "createdAt";
  order?: "asc" | "desc";
}

export class OrchestrationService {
  private readonly stateMutex = new AsyncMutex();

  constructor(private readonly deps: OrchestrationServiceDeps) {}

  private async mutate<T>(critical: () => Promise<T>): Promise<T> {
    return await this.stateMutex.run(critical);
  }

  async createGroup(input: {
    coordinatorSession: string;
    title: string;
  }): Promise<OrchestrationGroupRecord> {
    if (input.coordinatorSession.trim().length === 0) {
      throw new Error("coordinatorSession must be a non-empty string");
    }
    if (input.title.trim().length === 0) {
      throw new Error("title must be a non-empty string");
    }

    const group = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const now = this.deps.now().toISOString();
      const groupId = this.deps.createId();
      const nextGroup: OrchestrationGroupRecord = {
        groupId,
        coordinatorSession: input.coordinatorSession,
        title: input.title.trim(),
        createdAt: now,
        updatedAt: now,
      };

      const groups = this.ensureGroups(state);
      groups[groupId] = nextGroup;
      await this.deps.saveState(state);

      return { ...nextGroup };
    });

    this.logEvent("orchestration.group.created", "group created", this.groupContext(group));

    return group;
  }

  async getGroup(groupId: string): Promise<OrchestrationGroupRecord | null> {
    const state = await this.deps.loadState();
    const group = this.ensureGroups(state)[groupId];
    return group ? { ...group } : null;
  }

  async listGroups(coordinatorSession?: string): Promise<OrchestrationGroupRecord[]> {
    const state = await this.deps.loadState();
    return Object.values(this.ensureGroups(state))
      .filter((group) => coordinatorSession === undefined || group.coordinatorSession === coordinatorSession)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((group) => ({ ...group }));
  }

  async getGroupSummary(input: {
    groupId: string;
    coordinatorSession: string;
  }): Promise<OrchestrationGroupSummary | null> {
    const state = await this.deps.loadState();
    const group = this.ensureGroups(state)[input.groupId];
    if (!group || group.coordinatorSession !== input.coordinatorSession) {
      return null;
    }

    return this.buildGroupSummary(
      group,
      Object.values(state.orchestration.tasks).filter((task) => task.groupId === input.groupId),
    );
  }

  async listGroupSummaries(input: OrchestrationGroupListFilter): Promise<OrchestrationGroupSummary[]> {
    const state = await this.deps.loadState();
    const tasks = Object.values(state.orchestration.tasks);
    const threshold = this.deps.config.orchestration.progressHeartbeatSeconds;
    const now = this.deps.now().getTime();
    const sortField = input.sort ?? "updatedAt";
    const order = input.order ?? "desc";

    return Object.values(this.ensureGroups(state))
      .filter((group) => group.coordinatorSession === input.coordinatorSession)
      .map((group) => ({
        group,
        summary: this.buildGroupSummary(group, tasks.filter((task) => task.groupId === group.groupId)),
      }))
      .filter(({ summary }) => {
        if (input.status === undefined) return true;
        if (input.status === "pending") return summary.pendingApprovalTasks > 0;
        if (input.status === "running") return summary.runningTasks > 0;
        return summary.terminal === true;
      })
      .filter(({ group }) => {
        if (input.stuck !== true) return true;
        if (group.injectionPending !== true) return false;
        const elapsed = (now - new Date(group.updatedAt).getTime()) / 1000;
        return elapsed >= threshold;
      })
      .sort((left, right) => {
        const leftValue = sortField === "createdAt" ? left.group.createdAt : left.group.updatedAt;
        const rightValue = sortField === "createdAt" ? right.group.createdAt : right.group.updatedAt;
        const compare = leftValue.localeCompare(rightValue);
        return order === "asc" ? compare : -compare;
      })
      .map(({ summary }) => summary);
  }

  async cancelGroup(input: {
    groupId: string;
    coordinatorSession: string;
  }): Promise<CancelGroupResult> {
    const summary = await this.getGroupSummary(input);
    if (!summary) {
      throw new Error(`group "${input.groupId}" does not exist`);
    }

    const cancelledTaskIds: string[] = [];
    const skippedTaskIds: string[] = [];

    for (const task of summary.tasks) {
      if (this.isTerminalStatus(task.status)) {
        skippedTaskIds.push(task.taskId);
        continue;
      }

      await this.requestTaskCancellation({
        taskId: task.taskId,
        coordinatorSession: input.coordinatorSession,
      });
      cancelledTaskIds.push(task.taskId);
    }

    const refreshed = await this.getGroupSummary(input);
    if (!refreshed) {
      throw new Error(`group "${input.groupId}" does not exist`);
    }

    this.logEvent("orchestration.group.cancelled", "group cancelled", {
      ...this.groupContext(refreshed.group),
      cancelled_count: cancelledTaskIds.length,
      skipped_count: skippedTaskIds.length,
    });

    return {
      summary: refreshed,
      cancelledTaskIds,
      skippedTaskIds,
    };
  }

  async requestDelegate(input: RequestDelegateInput): Promise<RequestDelegateResult>;
  async requestDelegate(input: RequestDelegateRpcInput): Promise<RequestDelegateRpcResult>;
  async requestDelegate(
    input: RequestDelegateInput | RequestDelegateRpcInput,
  ): Promise<RequestDelegateResult | RequestDelegateRpcResult> {
    if (isRequestDelegateInput(input)) {
      return await this.requestDelegateForHuman(input);
    }

    return await this.requestDelegateFromRpc(input);
  }

  private async requestDelegateForHuman(input: RequestDelegateInput): Promise<RequestDelegateResult> {
    this.validateRequest(input);

    const role = this.normalizeRole(input.role);
    const normalizedGroupId = this.normalizeGroupId(input.groupId);
    const taskId = this.deps.createId();
    const workerSession = await this.resolveWorkerSession(input);
    const ensuredWorkerSession = await this.deps.ensureWorkerSession({
      workerSession,
      sourceHandle: input.sourceHandle,
      sourceKind: input.sourceKind,
      coordinatorSession: input.coordinatorSession,
      workspace: input.workspace,
      targetAgent: input.targetAgent,
      role,
    });
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const now = this.deps.now().toISOString();
      if (normalizedGroupId) {
        this.assertGroupOwnership(this.ensureGroups(state)[normalizedGroupId], normalizedGroupId, input.coordinatorSession);
      }
      const task: OrchestrationTaskRecord = {
        taskId,
        sourceHandle: input.sourceHandle,
        sourceKind: input.sourceKind,
        coordinatorSession: input.coordinatorSession,
        workerSession: ensuredWorkerSession,
        workspace: input.workspace,
        targetAgent: input.targetAgent,
        ...(role ? { role } : {}),
        ...(normalizedGroupId ? { groupId: normalizedGroupId } : {}),
        task: input.task,
        status: "running",
        summary: "",
        resultText: "",
        createdAt: now,
        updatedAt: now,
        ...(input.chatKey ? { chatKey: input.chatKey } : {}),
        ...(input.replyContextToken ? { replyContextToken: input.replyContextToken } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {}),
      };

      state.orchestration.tasks[taskId] = task;
      if (normalizedGroupId) {
        const group = this.ensureGroups(state)[normalizedGroupId]!;
        group.updatedAt = now;
        group.coordinatorInjectedAt = undefined;
        group.injectionPending = undefined;
        group.injectionAppliedAt = undefined;
        group.lastInjectionError = undefined;
      }
      const previousBinding = state.orchestration.workerBindings[ensuredWorkerSession];
      state.orchestration.workerBindings[ensuredWorkerSession] = {
        sourceHandle: ensuredWorkerSession,
        coordinatorSession: input.coordinatorSession,
        workspace: input.workspace,
        targetAgent: input.targetAgent,
        role,
      };

      await this.deps.saveState(state);

      return {
        task: { ...task },
        previousBinding,
      };
    });

    try {
      await this.deps.dispatchWorkerTask({
        taskId,
        workerSession: ensuredWorkerSession,
        coordinatorSession: input.coordinatorSession,
        workspace: input.workspace,
        targetAgent: input.targetAgent,
        ...(role ? { role } : {}),
        task: input.task,
      });
    } catch (error) {
      await this.mutate(async () => {
        const state = await this.deps.loadState();
        delete state.orchestration.tasks[taskId];
        if (prepared.previousBinding) {
          state.orchestration.workerBindings[ensuredWorkerSession] = prepared.previousBinding;
        } else {
          delete state.orchestration.workerBindings[ensuredWorkerSession];
        }
        await this.deps.saveState(state);
      });
      throw error;
    }

    this.logEvent("orchestration.task.created", "delegated task created", this.taskContext(prepared.task));

    return {
      taskId,
      status: prepared.task.status,
      workerSession: ensuredWorkerSession,
    };
  }

  async requestDelegateFromRpc(input: RequestDelegateRpcInput): Promise<RequestDelegateRpcResult> {
    this.validateRpcRequest(input);

    const preflight = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const sourceContext = this.resolveRpcSourceContext(state, input.sourceHandle);
      const role = this.normalizeRole(input.role);
      this.assertRpcRequestAllowed(
        state,
        sourceContext.sourceKind,
        sourceContext.coordinatorSession,
        input.targetAgent,
        role,
      );
      const normalizedGroupId = this.normalizeGroupId(input.groupId);
      if (normalizedGroupId) {
        this.assertGroupOwnership(
          this.ensureGroups(state)[normalizedGroupId],
          normalizedGroupId,
          sourceContext.coordinatorSession,
        );
      }
      return { sourceContext, role, normalizedGroupId };
    });

    // Coordinator-originated RPC delegation is treated as authorized: the human
    // already approved the coordinator turn, so chained requests from that
    // turn dispatch immediately. Worker-originated chains still require
    // explicit approval.
    const autoRun = preflight.sourceContext.sourceKind === "coordinator";

    const workerSessionName = await this.resolveWorkerSession({
      sourceHandle: input.sourceHandle,
      sourceKind: preflight.sourceContext.sourceKind,
      coordinatorSession: preflight.sourceContext.coordinatorSession,
      workspace: preflight.sourceContext.workspace,
      targetAgent: input.targetAgent,
      task: input.task,
      ...(preflight.role ? { role: preflight.role } : {}),
    });

    const ensuredWorkerSession = autoRun
      ? await this.deps.ensureWorkerSession({
          workerSession: workerSessionName,
          sourceHandle: input.sourceHandle,
          sourceKind: preflight.sourceContext.sourceKind,
          coordinatorSession: preflight.sourceContext.coordinatorSession,
          workspace: preflight.sourceContext.workspace,
          targetAgent: input.targetAgent,
          role: preflight.role,
        })
      : workerSessionName;

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const now = this.deps.now().toISOString();
      const taskId = this.deps.createId();
      const status: OrchestrationTaskStatus = autoRun ? "running" : "needs_confirmation";
      const task: OrchestrationTaskRecord = {
        taskId,
        sourceHandle: input.sourceHandle,
        sourceKind: preflight.sourceContext.sourceKind,
        coordinatorSession: preflight.sourceContext.coordinatorSession,
        workerSession: ensuredWorkerSession,
        workspace: preflight.sourceContext.workspace,
        targetAgent: input.targetAgent,
        ...(preflight.role ? { role: preflight.role } : {}),
        ...(preflight.normalizedGroupId ? { groupId: preflight.normalizedGroupId } : {}),
        task: input.task,
        status,
        summary: "",
        resultText: "",
        createdAt: now,
        updatedAt: now,
      };

      state.orchestration.tasks[taskId] = task;
      let previousGroup: OrchestrationGroupRecord | undefined;
      if (preflight.normalizedGroupId) {
        const group = this.ensureGroups(state)[preflight.normalizedGroupId]!;
        previousGroup = { ...group };
        group.updatedAt = now;
        group.coordinatorInjectedAt = undefined;
        group.injectionPending = undefined;
        group.injectionAppliedAt = undefined;
        group.lastInjectionError = undefined;
      }
      let previousBinding: AppState["orchestration"]["workerBindings"][string] | undefined;
      if (autoRun) {
        previousBinding = state.orchestration.workerBindings[ensuredWorkerSession];
        state.orchestration.workerBindings[ensuredWorkerSession] = {
          sourceHandle: ensuredWorkerSession,
          coordinatorSession: preflight.sourceContext.coordinatorSession,
          workspace: preflight.sourceContext.workspace,
          targetAgent: input.targetAgent,
          role: preflight.role,
        };
      }
      await this.deps.saveState(state);

      return { task: { ...task }, status, previousBinding, previousGroup, normalizedGroupId: preflight.normalizedGroupId };
    });

    if (autoRun) {
      try {
        await this.deps.dispatchWorkerTask({
          taskId: prepared.task.taskId,
          workerSession: ensuredWorkerSession,
          coordinatorSession: prepared.task.coordinatorSession,
          workspace: prepared.task.workspace,
          targetAgent: prepared.task.targetAgent,
          ...(prepared.task.role ? { role: prepared.task.role } : {}),
          task: prepared.task.task,
        });
      } catch (error) {
        await this.mutate(async () => {
          const state = await this.deps.loadState();
          delete state.orchestration.tasks[prepared.task.taskId];
          if (prepared.previousBinding) {
            state.orchestration.workerBindings[ensuredWorkerSession] = prepared.previousBinding;
          } else {
            delete state.orchestration.workerBindings[ensuredWorkerSession];
          }
          if (prepared.normalizedGroupId && prepared.previousGroup) {
            const groups = state.orchestration.groups ?? {};
            groups[prepared.normalizedGroupId] = prepared.previousGroup;
          }
          await this.deps.saveState(state);
        });
        throw error;
      }
    }

    this.logEvent(
      "orchestration.task.created",
      "delegated task created",
      this.taskContext(prepared.task),
    );

    return {
      taskId: prepared.task.taskId,
      status: prepared.status as RequestDelegateRpcResult["status"],
      ...(autoRun ? { workerSession: ensuredWorkerSession } : {}),
    };
  }

  async recordWorkerReply(input: RecordWorkerReplyInput): Promise<OrchestrationTaskRecord> {
    const task = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      const expectedSourceHandle = task.workerSession;
      if (!expectedSourceHandle) {
        throw new Error(`task "${input.taskId}" does not have an assigned worker session`);
      }

      if (expectedSourceHandle !== input.sourceHandle) {
        throw new Error(
          `task "${input.taskId}" belongs to worker "${expectedSourceHandle}", not "${input.sourceHandle}"`,
        );
      }

      if (this.isTerminalStatus(task.status)) {
        throw new Error(`task "${input.taskId}" is already ${task.status}`);
      }

      if (task.status !== "running") {
        throw new Error(`task "${input.taskId}" is ${task.status}, not running`);
      }

      const updatedAt = this.deps.now().toISOString();
      const isContestedResult = task.correctionPending?.reason === "misrouted_answer";
      task.status = input.status ?? "completed";
      task.summary = input.summary ?? "";
      task.resultText = stripProgressLines(input.resultText ?? "");
      if (task.status === "completed" || task.status === "failed") {
        task.injectionPending = true;
        task.injectionAppliedAt = undefined;
        task.lastInjectionError = undefined;
        if (!isContestedResult && task.chatKey && task.replyContextToken) {
          task.noticePending = true;
          task.noticeSentAt = undefined;
          task.lastNoticeError = undefined;
        } else if (isContestedResult) {
          task.noticePending = false;
          task.noticeSentAt = undefined;
          task.lastNoticeError = undefined;
        }
      }
      if (isContestedResult) {
        task.reviewPending = {
          reviewId: this.deps.createId(),
          reason: "misrouted_answer",
          createdAt: updatedAt,
          resultId: this.deps.createId(),
          resultText: task.resultText,
        };
        task.correctionPending = undefined;
        task.cancelRequestedAt = undefined;
        task.cancelCompletedAt = undefined;
        task.lastCancelError = undefined;
      }
      task.updatedAt = updatedAt;
      this.bumpGroupUpdated(state, task.groupId, updatedAt);

      await this.deps.saveState(state);

      return { ...task };
    });

    if (task.status === "completed") {
      this.logEvent("orchestration.task.completed", "task completed", this.taskContext(task));
    } else if (task.status === "failed") {
      this.logEvent("orchestration.task.failed", "task failed", this.taskContext(task));
    }

    return task;
  }

  async markTaskNoticePending(taskId: string): Promise<OrchestrationTaskRecord> {
    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task) {
        throw new Error(`task "${taskId}" does not exist`);
      }

      task.noticePending = true;
      task.noticeSentAt = undefined;
      task.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
      return { ...task };
    });
  }

  async markTaskNoticeDelivered(taskId: string, deliveryAccountId: string): Promise<OrchestrationTaskRecord> {
    const task = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task) {
        throw new Error(`task "${taskId}" does not exist`);
      }

      const now = this.deps.now().toISOString();
      task.noticePending = false;
      task.noticeSentAt = now;
      task.deliveryAccountId = deliveryAccountId;
      task.lastNoticeError = undefined;
      task.updatedAt = now;
      await this.deps.saveState(state);
      return { ...task };
    });

    this.logEvent("orchestration.notice.sent", "task notice delivered", {
      ...this.taskContext(task),
      delivery_account_id: deliveryAccountId,
    });

    return task;
  }

  async markTaskNoticeFailed(input: MarkTaskErrorInput): Promise<OrchestrationTaskRecord> {
    const task = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      task.noticePending = true;
      task.lastNoticeError = input.errorMessage;
      task.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
      return { ...task };
    });

    this.logEvent("orchestration.notice.failed", "task notice delivery failed", {
      ...this.taskContext(task),
      error: input.errorMessage,
    });

    return task;
  }

  async listPendingTaskNotices(): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    return Object.values(state.orchestration.tasks)
      .filter((task) => task.noticePending === true)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((task) => ({ ...task }));
  }

  async recordTaskNoticeDelivery(input: RecordTaskNoticeDeliveryInput): Promise<OrchestrationTaskRecord> {
    return await this.markTaskNoticeDelivered(input.taskId, input.deliveryAccountId);
  }

  async getTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    const state = await this.deps.loadState();
    const task = state.orchestration.tasks[taskId];
    return task ? { ...task } : null;
  }

  async recordCoordinatorRouteContext(input: {
    coordinatorSession: string;
    chatKey: string;
    accountId?: string;
    replyContextToken?: string;
  }): Promise<OrchestrationCoordinatorRouteContextRecord> {
    if (input.coordinatorSession.trim().length === 0) {
      throw new Error("coordinatorSession must be a non-empty string");
    }
    if (input.chatKey.trim().length === 0) {
      throw new Error("chatKey must be a non-empty string");
    }

    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const now = this.deps.now().toISOString();
      const existing = this.ensureCoordinatorRoutes(state)[input.coordinatorSession];
      const hasAccountId = input.accountId !== undefined;
      const hasReplyContextToken = input.replyContextToken !== undefined;
      const hasCompleteReplyRoute = hasAccountId && hasReplyContextToken;
      const shouldPreserveExistingReplyRoute =
        !hasAccountId &&
        !hasReplyContextToken &&
        existing?.chatKey === input.chatKey;
      const replyRoute =
        hasCompleteReplyRoute
          ? {
              accountId: input.accountId,
              replyContextToken: input.replyContextToken,
            }
          : shouldPreserveExistingReplyRoute && existing?.accountId && existing?.replyContextToken
            ? {
                accountId: existing.accountId,
                replyContextToken: existing.replyContextToken,
              }
            : undefined;
      const route: OrchestrationCoordinatorRouteContextRecord = {
        coordinatorSession: input.coordinatorSession,
        chatKey: input.chatKey,
        ...(replyRoute ? replyRoute : {}),
        updatedAt: now,
      };
      this.ensureCoordinatorRoutes(state)[input.coordinatorSession] = route;
      await this.deps.saveState(state);
      return { ...route };
    });
  }

  async workerRaiseQuestion(
    input: WorkerRaiseQuestionInput,
  ): Promise<{ taskId: string; questionId: string; status: "blocked" }> {
    if (input.taskId.trim().length === 0) {
      throw new Error("taskId must be a non-empty string");
    }
    if (input.sourceHandle.trim().length === 0) {
      throw new Error("sourceHandle must be a non-empty string");
    }
    if (input.question.trim().length === 0) {
      throw new Error("question must be a non-empty string");
    }
    if (input.whyBlocked.trim().length === 0) {
      throw new Error("whyBlocked must be a non-empty string");
    }
    if (input.whatIsNeeded.trim().length === 0) {
      throw new Error("whatIsNeeded must be a non-empty string");
    }

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }
      if (!task.workerSession) {
        throw new Error(`task "${input.taskId}" does not have an assigned worker session`);
      }
      if (task.workerSession !== input.sourceHandle) {
        throw new Error(`task "${input.taskId}" belongs to worker "${task.workerSession}", not "${input.sourceHandle}"`);
      }
      if (task.status !== "running") {
        throw new Error(`task "${input.taskId}" is ${task.status}, not running`);
      }
      if (task.openQuestion?.status === "open") {
        throw new Error(`task "${input.taskId}" already has an open question`);
      }

      const now = this.deps.now().toISOString();
      const questionId = this.deps.createId();
      task.status = "blocked";
      task.openQuestion = {
        questionId,
        question: input.question.trim(),
        whyBlocked: input.whyBlocked.trim(),
        whatIsNeeded: input.whatIsNeeded.trim(),
        askedAt: now,
        status: "open",
      };
      task.updatedAt = now;
      this.bumpGroupUpdated(state, task.groupId, now);
      await this.deps.saveState(state);

      return {
        taskId: task.taskId,
        questionId,
        coordinatorSession: task.coordinatorSession,
      };
    });

    try {
      await this.deps.wakeCoordinatorSession?.({
        coordinatorSession: prepared.coordinatorSession,
      });
    } catch (error) {
      await this.recordOpenQuestionWakeError(
        prepared.taskId,
        prepared.questionId,
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      taskId: prepared.taskId,
      questionId: prepared.questionId,
      status: "blocked",
    };
  }

  async coordinatorAnswerQuestion(input: {
    coordinatorSession: string;
    taskId: string;
    questionId: string;
    answer: string;
  }): Promise<OrchestrationTaskRecord> {
    const answer = input.answer.trim();
    if (answer.length === 0) {
      throw new Error("answer must be a non-empty string");
    }

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      this.assertCoordinatorOwnership(task, input.coordinatorSession);
      if (task.status !== "blocked" && task.status !== "waiting_for_human") {
        throw new Error(`task "${input.taskId}" is ${task.status}, not blocked or waiting_for_human`);
      }
      this.assertCoordinatorQuestionMatch(task, input.questionId);
      this.assertTaskAnswerIsWithinAwaitedHumanSnapshot(state, task, input.questionId);
      if (!task.workerSession) {
        throw new Error(`task "${input.taskId}" does not have an assigned worker session`);
      }

      const now = this.deps.now().toISOString();
      const packageRestore = this.captureTaskHumanPackageContext(state, task);
      this.resolveTaskFromHumanPackage(state, task, now);
      task.status = "running";
      task.openQuestion = {
        ...task.openQuestion!,
        status: "answered",
        answeredAt: now,
        answerSource: "coordinator",
        answerText: answer,
        lastResumeError: undefined,
      };
      task.updatedAt = now;
      this.bumpGroupUpdated(state, task.groupId, now);
      await this.deps.saveState(state);

      return {
        task: { ...task },
        packageRestore,
        closedPackageId:
          packageRestore && packageRestore.packageRecord.openTaskIds.includes(task.taskId)
            && packageRestore.packageRecord.openTaskIds.length === 1
            ? packageRestore.packageId
            : undefined,
      };
    });

    try {
      await this.deps.resumeWorkerTask?.({
        taskId: prepared.task.taskId,
        workerSession: prepared.task.workerSession!,
        coordinatorSession: prepared.task.coordinatorSession,
        workspace: prepared.task.workspace,
        targetAgent: prepared.task.targetAgent,
        answer,
      });
    } catch (error) {
      await this.restoreBlockedQuestionAfterResumeFailure(
        prepared.task.taskId,
        input.questionId,
        error instanceof Error ? error.message : String(error),
        prepared.packageRestore,
      );
      throw error;
    }

    if (prepared.closedPackageId) {
      await this.handoffQueuedQuestions(prepared.task.coordinatorSession, prepared.closedPackageId);
    }

    return prepared.task;
  }

  async coordinatorRetractAnswer(input: {
    coordinatorSession: string;
    taskId: string;
    questionId: string;
  }): Promise<OrchestrationTaskRecord> {
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      this.assertCoordinatorOwnership(task, input.coordinatorSession);
      const openQuestion = task.openQuestion;
      if (!openQuestion) {
        throw new Error(`task "${input.taskId}" does not have an open question`);
      }
      if (openQuestion.questionId !== input.questionId) {
        throw new Error(`task "${task.taskId}" open question is "${openQuestion.questionId}", not "${input.questionId}"`);
      }
      if (openQuestion.status !== "answered") {
        throw new Error(`task "${input.taskId}" question "${input.questionId}" is not answered`);
      }

      const now = this.deps.now().toISOString();
      if (task.status === "running") {
        const shouldPropagate = task.correctionPending === undefined;
        task.correctionPending = task.correctionPending ?? {
          requestedAt: now,
          reason: "misrouted_answer",
        };
        task.cancelRequestedAt = task.cancelRequestedAt ?? now;
        task.updatedAt = now;
        this.bumpGroupUpdated(state, task.groupId, now);
        await this.deps.saveState(state);

        return {
          task: { ...task },
          shouldPropagate,
        };
      }

      if (
        (task.status === "completed" || task.status === "failed") &&
        task.reviewPending === undefined &&
        task.coordinatorInjectedAt === undefined
      ) {
        task.reviewPending = {
          reviewId: this.deps.createId(),
          reason: "misrouted_answer",
          createdAt: now,
          resultId: this.deps.createId(),
          resultText: task.resultText,
        };
        task.noticePending = false;
        task.lastNoticeError = undefined;
        task.updatedAt = now;
        this.bumpGroupUpdated(state, task.groupId, now);
        await this.deps.saveState(state);

        return {
          task: { ...task },
          shouldPropagate: false,
        };
      }

      throw new Error(`task "${input.taskId}" is ${task.status}, not running or contestable`);
    });

    this.logEvent("orchestration.task.correction_requested", "task answer marked for correction", {
      ...this.taskContext(prepared.task),
      question_id: input.questionId,
    });

    if (prepared.shouldPropagate) {
      this.startWorkerCancellation(prepared.task);
    }

    return prepared.task;
  }

  async coordinatorRequestHumanInput(input: {
    coordinatorSession: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
    expectedActivePackageId?: string;
  }): Promise<CoordinatorRequestHumanInputResult> {
    const promptText = input.promptText.trim();
    if (promptText.length === 0) {
      throw new Error("promptText must be a non-empty string");
    }
    if (input.taskQuestions.length === 0) {
      throw new Error("taskQuestions must contain at least one question");
    }

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, input.coordinatorSession);
      if (input.expectedActivePackageId !== undefined && coordinatorState.activePackageId !== input.expectedActivePackageId) {
        throw new Error(
          `coordinator "${input.coordinatorSession}" active package is "${coordinatorState.activePackageId ?? ""}", not "${input.expectedActivePackageId}"`,
        );
      }

      const tasks = input.taskQuestions.map(({ taskId, questionId }) => {
        const task = state.orchestration.tasks[taskId];
        if (!task) {
          throw new Error(`task "${taskId}" does not exist`);
        }
        this.assertCoordinatorOwnership(task, input.coordinatorSession);
        if (task.status !== "blocked") {
          throw new Error(`task "${taskId}" is ${task.status}, not blocked`);
        }
        this.assertCoordinatorQuestionMatch(task, questionId);
        return task;
      });

      const now = this.deps.now().toISOString();
      const route = this.snapshotCoordinatorDeliveryRoute(this.ensureCoordinatorRoutes(state)[input.coordinatorSession]);
      if (coordinatorState.activePackageId) {
        const activePackage = this.ensureHumanQuestionPackages(state)[coordinatorState.activePackageId];
        if (!activePackage) {
          throw new Error(`active package "${coordinatorState.activePackageId}" does not exist`);
        }

        for (const task of tasks) {
          if (activePackage.openTaskIds.includes(task.taskId)) {
            throw new Error(`task "${task.taskId}" already belongs to active package "${activePackage.packageId}"`);
          }
          if (!coordinatorState.queuedQuestions.some((entry) => entry.taskId === task.taskId && entry.questionId === task.openQuestion!.questionId)) {
            coordinatorState.queuedQuestions.push({
              taskId: task.taskId,
              questionId: task.openQuestion!.questionId,
              enqueuedAt: now,
            });
          }
          task.updatedAt = now;
          this.bumpGroupUpdated(state, task.groupId, now);
        }

        await this.deps.saveState(state);
        return {
          kind: "queued" as const,
          queuedTaskIds: tasks.map((task) => task.taskId),
        };
      }

      const packageId = this.deps.createId();
      const messageId = this.deps.createId();
      const packageRecord: OrchestrationHumanQuestionPackageRecord = {
        packageId,
        coordinatorSession: input.coordinatorSession,
        status: "active",
        createdAt: now,
        updatedAt: now,
        initialTaskIds: tasks.map((task) => task.taskId),
        openTaskIds: tasks.map((task) => task.taskId),
        resolvedTaskIds: [],
        messages: [
          {
            messageId,
            kind: "initial",
            promptText,
            createdAt: now,
            taskQuestions: tasks.map((task) => ({
              taskId: task.taskId,
              questionId: task.openQuestion!.questionId,
            })),
            ...(route ? this.serializeFrozenDeliveryRoute(route) : {}),
          },
        ],
      };

      for (const task of tasks) {
        task.status = "waiting_for_human";
        task.openQuestion = {
          ...task.openQuestion!,
          packageId,
        };
        task.updatedAt = now;
        this.bumpGroupUpdated(state, task.groupId, now);
      }

      this.ensureHumanQuestionPackages(state)[packageId] = packageRecord;
      coordinatorState.activePackageId = packageId;
      await this.deps.saveState(state);

      return {
        kind: "deliver" as const,
        coordinatorSession: input.coordinatorSession,
        packageId,
        messageId,
        promptText,
        queuedTaskIds: [],
        route: route ?? null,
      };
    });

    if (prepared.kind === "queued") {
      return {
        queuedTaskIds: prepared.queuedTaskIds,
      };
    }

    await this.deliverHumanQuestionPackageMessage(prepared);
    return {
      packageId: prepared.packageId,
      queuedTaskIds: prepared.queuedTaskIds,
    };
  }

  async coordinatorFollowUpHumanPackage(input: {
    coordinatorSession: string;
    packageId: string;
    priorMessageId: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
  }): Promise<CoordinatorFollowUpHumanPackageResult> {
    const promptText = input.promptText.trim();
    if (promptText.length === 0) {
      throw new Error("promptText must be a non-empty string");
    }
    if (input.taskQuestions.length === 0) {
      throw new Error("taskQuestions must contain at least one question");
    }

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, input.coordinatorSession);
      if (coordinatorState.activePackageId !== input.packageId) {
        throw new Error(
          `package "${input.packageId}" is not the active package for coordinator "${input.coordinatorSession}"`,
        );
      }

      const packageRecord = this.ensureHumanQuestionPackages(state)[input.packageId];
      if (!packageRecord || packageRecord.status !== "active") {
        throw new Error(`package "${input.packageId}" is not active`);
      }

      const latestMessage = packageRecord.messages.at(-1);
      if (!latestMessage || latestMessage.messageId !== input.priorMessageId) {
        throw new Error(
          `package "${input.packageId}" latest message is "${latestMessage?.messageId ?? ""}", not "${input.priorMessageId}"`,
        );
      }
      if (!latestMessage.deliveredAt) {
        throw new Error(`package "${input.packageId}" latest message "${latestMessage.messageId}" is not delivered yet`);
      }

      const tasks = input.taskQuestions.map(({ taskId, questionId }) => {
        const task = state.orchestration.tasks[taskId];
        if (!task) {
          throw new Error(`task "${taskId}" does not exist`);
        }
        this.assertCoordinatorOwnership(task, input.coordinatorSession);
        if (!packageRecord.openTaskIds.includes(taskId)) {
          throw new Error(`task "${taskId}" does not belong to active package "${input.packageId}"`);
        }
        this.assertCoordinatorQuestionMatch(task, questionId);
        return task;
      });

      const now = this.deps.now().toISOString();
      const route = this.resolveFrozenPackageMessageRoute(latestMessage);
      const messageId = this.deps.createId();
      const message: OrchestrationHumanQuestionPackageMessageRecord = {
        messageId,
        kind: "follow_up",
        promptText,
        createdAt: now,
        taskQuestions: input.taskQuestions.map((entry) => ({ ...entry })),
        ...(route ? this.serializeFrozenDeliveryRoute(route) : {}),
      };
      packageRecord.messages.push(message);
      packageRecord.awaitingReplyMessageId = undefined;
      packageRecord.updatedAt = now;

      for (const task of tasks) {
        task.status = "waiting_for_human";
        task.openQuestion = {
          ...task.openQuestion!,
          packageId: input.packageId,
        };
        task.updatedAt = now;
        this.bumpGroupUpdated(state, task.groupId, now);
      }

      await this.deps.saveState(state);

      return {
        coordinatorSession: input.coordinatorSession,
        packageId: input.packageId,
        messageId,
        promptText,
        route,
      };
    });

    await this.deliverHumanQuestionPackageMessage(prepared);
    return {
      packageId: prepared.packageId,
      messageId: prepared.messageId,
    };
  }

  async retryHumanQuestionPackageDelivery(input: {
    coordinatorSession: string;
    packageId: string;
    messageId: string;
  }): Promise<RetryHumanQuestionPackageDeliveryResult> {
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, input.coordinatorSession);
      if (coordinatorState.activePackageId !== input.packageId) {
        throw new Error(
          `package "${input.packageId}" is not the active package for coordinator "${input.coordinatorSession}"`,
        );
      }

      const packageRecord = this.ensureHumanQuestionPackages(state)[input.packageId];
      if (!packageRecord) {
        throw new Error(`package "${input.packageId}" does not exist`);
      }
      if (packageRecord.coordinatorSession !== input.coordinatorSession) {
        throw new Error(
          `package "${input.packageId}" belongs to coordinator "${packageRecord.coordinatorSession}", not "${input.coordinatorSession}"`,
        );
      }
      if (packageRecord.status !== "active") {
        throw new Error(`package "${input.packageId}" is not active`);
      }

      const message = packageRecord.messages.find((entry) => entry.messageId === input.messageId);
      if (!message) {
        throw new Error(`message "${input.messageId}" does not exist in package "${input.packageId}"`);
      }
      if (message.deliveredAt !== undefined) {
        throw new Error(`message "${input.messageId}" in package "${input.packageId}" is already delivered`);
      }

      let route: FrozenCoordinatorDeliveryRoute | null = this.resolveFrozenPackageMessageRoute(message);
      if (!route) {
        route = this.snapshotCoordinatorDeliveryRoute(
          this.ensureCoordinatorRoutes(state)[input.coordinatorSession],
        ) ?? null;
        if (route) {
          Object.assign(message, this.serializeFrozenDeliveryRoute(route));
        }
      }

      packageRecord.awaitingReplyMessageId = undefined;
      packageRecord.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
      return {
        coordinatorSession: input.coordinatorSession,
        packageId: input.packageId,
        messageId: input.messageId,
        promptText: message.promptText,
        route: route ?? null,
      };
    });

    await this.deliverHumanQuestionPackageMessage(prepared);
    return {
      packageId: prepared.packageId,
      messageId: prepared.messageId,
    };
  }

  async claimActiveHumanReply(input: {
    coordinatorSession: string;
    chatKey: string;
    packageId: string;
    messageId: string;
    accountId?: string;
    replyContextToken?: string;
  }): Promise<ClaimedActiveHumanReply | null> {
    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, input.coordinatorSession);
      if (!coordinatorState.activePackageId || coordinatorState.activePackageId !== input.packageId) {
        return null;
      }

      const packageRecord = this.ensureHumanQuestionPackages(state)[coordinatorState.activePackageId];
      if (!packageRecord?.awaitingReplyMessageId || packageRecord.awaitingReplyMessageId !== input.messageId) {
        return null;
      }

      const message = packageRecord.messages.find((entry) => entry.messageId === input.messageId);
      if (!message || message.deliveredChatKey !== input.chatKey) {
        return null;
      }
      if (message.deliveryAccountId !== undefined && message.deliveryAccountId !== input.accountId) {
        return null;
      }
      if (
        message.routeReplyContextToken !== undefined &&
        message.routeReplyContextToken !== input.replyContextToken
      ) {
        return null;
      }
      const messageTaskQuestions = this.resolveLiveMessageTaskQuestions(state, packageRecord, message);
      if (messageTaskQuestions.length === 0) {
        return null;
      }

      packageRecord.awaitingReplyMessageId = undefined;
      packageRecord.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
      return {
        coordinatorSession: input.coordinatorSession,
        packageId: packageRecord.packageId,
        messageId: message.messageId,
        chatKey: input.chatKey,
        promptText: message.promptText,
        queuedCount: coordinatorState.queuedQuestions.length,
        taskQuestions: messageTaskQuestions,
      };
    });
  }

  async getActiveHumanQuestionPackage(
    coordinatorSession: string,
  ): Promise<ActiveHumanQuestionPackage | null> {
    const state = await this.deps.loadState();
    const coordinatorState = state.orchestration.coordinatorQuestionState[coordinatorSession];
    const activePackageId = coordinatorState?.activePackageId;
    if (!activePackageId) {
      return null;
    }

    const packageRecord = state.orchestration.humanQuestionPackages[activePackageId];
    if (!packageRecord) {
      return null;
    }

    const activeMessage =
      (packageRecord.awaitingReplyMessageId
        ? packageRecord.messages.find((message) => message.messageId === packageRecord.awaitingReplyMessageId)
        : undefined) ?? packageRecord.messages.at(-1);
    if (!activeMessage) {
      return null;
    }
    const messageTaskQuestions = this.resolveLiveMessageTaskQuestions(state, packageRecord, activeMessage);

    const openTaskQuestions = packageRecord.openTaskIds
      .map((taskId) => {
        const task = state.orchestration.tasks[taskId];
        if (!task?.openQuestion || task.openQuestion.status !== "open") {
          return null;
        }
        return {
          taskId,
          questionId: task.openQuestion.questionId,
          question: task.openQuestion.question,
          whyBlocked: task.openQuestion.whyBlocked,
          whatIsNeeded: task.openQuestion.whatIsNeeded,
        };
      })
      .filter(
        (
          entry,
        ): entry is NonNullable<ActiveHumanQuestionPackage["openTaskQuestions"]>[number] => entry !== null,
      );

    return {
      packageId: packageRecord.packageId,
      promptText: activeMessage.promptText,
      ...(packageRecord.awaitingReplyMessageId
        ? { awaitingReplyMessageId: packageRecord.awaitingReplyMessageId }
        : {}),
      ...(activeMessage.deliveredChatKey ? { deliveredChatKey: activeMessage.deliveredChatKey } : {}),
      ...(activeMessage.deliveryAccountId ? { deliveryAccountId: activeMessage.deliveryAccountId } : {}),
      ...(activeMessage.routeReplyContextToken
        ? { routeReplyContextToken: activeMessage.routeReplyContextToken }
        : {}),
      ...(activeMessage.deliveredAt ? { deliveredAt: activeMessage.deliveredAt } : {}),
      openTaskIds: [...packageRecord.openTaskIds],
      ...(messageTaskQuestions.length > 0 ? { messageTaskQuestions } : {}),
      ...(openTaskQuestions.length > 0 ? { openTaskQuestions } : {}),
      queuedCount: coordinatorState?.queuedQuestions.length ?? 0,
    };
  }

  async coordinatorReviewContestedResult(input: {
    coordinatorSession: string;
    taskId: string;
    reviewId: string;
    decision: "accept" | "discard";
  }): Promise<OrchestrationTaskRecord> {
    if (input.decision !== "accept" && input.decision !== "discard") {
      throw new Error(`unsupported contested-result decision "${input.decision}"`);
    }

    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }
      this.assertCoordinatorOwnership(task, input.coordinatorSession);
      if (!task.reviewPending) {
        throw new Error(`task "${input.taskId}" does not have a contested result`);
      }
      if (task.reviewPending.reviewId !== input.reviewId) {
        throw new Error(
          `task "${input.taskId}" review is "${task.reviewPending.reviewId}", not "${input.reviewId}"`,
        );
      }

      const now = this.deps.now().toISOString();
      let replacementQuestionId: string | undefined;
      task.reviewPending = undefined;

      if (input.decision === "discard") {
        replacementQuestionId = this.deps.createId();
        const packageId = this.reopenActiveHumanPackageForTask(state, task, now);
        task.status = packageId ? "waiting_for_human" : "blocked";
        task.summary = "";
        task.resultText = "";
        task.openQuestion = this.buildReplacementOpenQuestion(task, replacementQuestionId, now, packageId);
      } else if (
        (task.status === "completed" || task.status === "failed") &&
        task.chatKey &&
        task.replyContextToken &&
        task.noticeSentAt === undefined
      ) {
        task.noticePending = true;
        task.lastNoticeError = undefined;
      }

      task.updatedAt = now;
      this.bumpGroupUpdated(state, task.groupId, now);
      await this.deps.saveState(state);

      return {
        task: { ...task },
        replacementQuestionId,
      };
    });

    if (prepared.replacementQuestionId) {
      try {
        await this.deps.wakeCoordinatorSession?.({
          coordinatorSession: prepared.task.coordinatorSession,
        });
      } catch (error) {
        await this.recordOpenQuestionWakeError(
          prepared.task.taskId,
          prepared.replacementQuestionId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return prepared.task;
  }

  async listTasks(filter?: OrchestrationTaskFilter): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    const threshold = this.deps.config.orchestration.progressHeartbeatSeconds;
    const now = this.deps.now().getTime();
    const sortField = filter?.sort ?? "updatedAt";
    const order = filter?.order ?? "desc";

    return Object.values(state.orchestration.tasks)
      .filter((task) => this.matchesFilter(task, filter))
      .filter((task) => {
        if (filter?.stuck !== true) return true;
        if (task.status !== "running") return false;
        const reference = task.lastProgressAt ?? task.createdAt;
        const elapsed = (now - new Date(reference).getTime()) / 1000;
        return elapsed >= threshold;
      })
      .sort((left, right) => {
        const leftValue = sortField === "createdAt" ? left.createdAt : left.updatedAt;
        const rightValue = sortField === "createdAt" ? right.createdAt : right.updatedAt;
        const compare = leftValue.localeCompare(rightValue);
        return order === "asc" ? compare : -compare;
      })
      .map((task) => ({ ...task }));
  }

  async cleanTasks(coordinatorSession: string): Promise<CleanTasksResult> {
    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const tasks = state.orchestration.tasks;
      const bindings = state.orchestration.workerBindings;

      const terminalTaskIds: string[] = [];
      for (const [taskId, task] of Object.entries(tasks)) {
        if (
          task.coordinatorSession === coordinatorSession &&
          this.isTerminalStatus(task.status) &&
          task.reviewPending === undefined
        ) {
          terminalTaskIds.push(taskId);
        }
      }

      for (const taskId of terminalTaskIds) {
        delete tasks[taskId];
      }

      const remainingWorkerSessions = new Set(
        Object.values(tasks).map((task) => task.workerSession).filter(Boolean) as string[],
      );

      let removedBindings = 0;
      for (const [workerSession, binding] of Object.entries(bindings)) {
        if (binding.coordinatorSession !== coordinatorSession) {
          continue;
        }
        if (!remainingWorkerSessions.has(workerSession)) {
          delete bindings[workerSession];
          removedBindings += 1;
        }
      }

      const removedEmptyGroups = this.removeEmptyGroupsForCoordinator(state, coordinatorSession);

      if (terminalTaskIds.length > 0 || removedBindings > 0 || removedEmptyGroups) {
        await this.deps.saveState(state);
      }

      return {
        removedTasks: terminalTaskIds.length,
        removedBindings,
      };
    });
  }

  async listSessionBlockingTasks(transportSession: string): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    return Object.values(state.orchestration.tasks)
      .filter(
        (task) =>
          (!this.isTerminalStatus(task.status) || task.reviewPending !== undefined) &&
          (task.coordinatorSession === transportSession || task.workerSession === transportSession),
      )
      .map((task) => ({ ...task }));
  }

  async purgeSessionReferences(transportSession: string): Promise<CleanTasksResult> {
    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const tasks = state.orchestration.tasks;
      const bindings = state.orchestration.workerBindings;

      const removedTaskIds: string[] = [];
      for (const [taskId, task] of Object.entries(tasks)) {
        if (
          this.isTerminalStatus(task.status) &&
          task.reviewPending === undefined &&
          (task.coordinatorSession === transportSession || task.workerSession === transportSession)
        ) {
          removedTaskIds.push(taskId);
        }
      }
      for (const taskId of removedTaskIds) {
        delete tasks[taskId];
      }

      const remainingWorkerSessions = new Set(
        Object.values(tasks).map((task) => task.workerSession).filter(Boolean) as string[],
      );

      let removedBindings = 0;
      for (const [workerSession, binding] of Object.entries(bindings)) {
        const shouldPurgeBinding = workerSession === transportSession || binding.coordinatorSession === transportSession;
        if (shouldPurgeBinding && !remainingWorkerSessions.has(workerSession)) {
          delete bindings[workerSession];
          removedBindings += 1;
        }
      }

      const removedEmptyGroups = this.removeEmptyGroupsForCoordinator(state, transportSession);
      const removedCoordinatorMetadata = this.removeCoordinatorMetadataIfUnused(state, transportSession);

      if (removedTaskIds.length > 0 || removedBindings > 0 || removedEmptyGroups || removedCoordinatorMetadata) {
        await this.deps.saveState(state);
      }

      return {
        removedTasks: removedTaskIds.length,
        removedBindings,
      };
    });
  }

  async listPendingCoordinatorResults(coordinatorSession: string): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    return Object.values(state.orchestration.tasks)
      .filter(
        (task) =>
          task.coordinatorSession === coordinatorSession &&
          this.canInjectTaskIntoCoordinator(state, task) &&
          (task.injectionPending === true || task.coordinatorInjectedAt === undefined),
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((task) => ({ ...task }));
  }

  async listPendingCoordinatorBlockers(coordinatorSession: string): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    const coordinatorState = state.orchestration.coordinatorQuestionState[coordinatorSession];
    const hiddenQueuedQuestionKeys = coordinatorState?.activePackageId
      ? new Set((coordinatorState.queuedQuestions ?? []).map((entry) => `${entry.taskId}:${entry.questionId}`))
      : null;
    return Object.values(state.orchestration.tasks)
      .filter(
        (task) =>
          task.coordinatorSession === coordinatorSession &&
          task.status === "blocked" &&
          task.openQuestion?.status === "open" &&
          !hiddenQueuedQuestionKeys?.has(`${task.taskId}:${task.openQuestion.questionId}`),
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((task) => ({ ...task }));
  }

  async listContestedCoordinatorResults(coordinatorSession: string): Promise<OrchestrationTaskRecord[]> {
    const state = await this.deps.loadState();
    return Object.values(state.orchestration.tasks)
      .filter((task) => task.coordinatorSession === coordinatorSession && task.reviewPending !== undefined)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((task) => ({ ...task }));
  }

  async listPendingCoordinatorGroups(coordinatorSession: string): Promise<OrchestrationGroupRecord[]> {
    const state = await this.deps.loadState();
    const groups = this.ensureGroups(state);
    const tasks = Object.values(state.orchestration.tasks);

    return Object.values(groups)
      .filter((group) => group.coordinatorSession === coordinatorSession)
      .filter((group) => {
        const groupTasks = tasks.filter((task) => task.groupId === group.groupId);
        return this.canInjectGroupIntoCoordinator(state, group.groupId, groupTasks);
      })
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((group) => ({ ...group }));
  }

  async markCoordinatorResultsInjected(taskIds: string[]): Promise<void> {
    await this.markTaskInjectionApplied(taskIds);
  }

  async markCoordinatorGroupsInjected(groupIds: string[]): Promise<void> {
    if (groupIds.length === 0) {
      return;
    }

    const appliedTasks = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const groups = this.ensureGroups(state);
      const injectedAt = this.deps.now().toISOString();
      let changed = false;
      const appliedTasks: OrchestrationTaskRecord[] = [];

      for (const groupId of groupIds) {
        const group = groups[groupId];
        if (!group) {
          continue;
        }
        if (group.coordinatorInjectedAt !== undefined) {
          continue;
        }
        if (!this.canInjectGroupIntoCoordinator(state, groupId)) {
          continue;
        }

        const groupTasks = Object.values(state.orchestration.tasks).filter((task) => task.groupId === groupId);
        group.coordinatorInjectedAt = injectedAt;
        group.injectionPending = false;
        group.injectionAppliedAt = injectedAt;
        group.lastInjectionError = undefined;
        group.updatedAt = injectedAt;
        for (const task of groupTasks) {
          if (task.coordinatorInjectedAt !== undefined) {
            continue;
          }
          task.coordinatorInjectedAt = injectedAt;
          task.injectionPending = false;
          task.injectionAppliedAt = injectedAt;
          task.lastInjectionError = undefined;
          task.updatedAt = injectedAt;
          appliedTasks.push({ ...task });
        }
        changed = true;
      }

      if (changed) {
        await this.deps.saveState(state);
      }

      return appliedTasks;
    });

    for (const task of appliedTasks) {
      this.logEvent(
        "orchestration.injection.applied",
        "coordinator injection applied",
        this.taskContext(task),
      );
    }
  }

  async markCoordinatorGroupsInjectionFailed(groupIds: string[], errorMessage: string): Promise<void> {
    if (groupIds.length === 0) {
      return;
    }

    await this.mutate(async () => {
      const state = await this.deps.loadState();
      const groups = this.ensureGroups(state);
      const failedAt = this.deps.now().toISOString();
      let changed = false;

      for (const groupId of groupIds) {
        const group = groups[groupId];
        if (!group) {
          continue;
        }
        if (!this.canInjectGroupIntoCoordinator(state, groupId)) {
          continue;
        }

        group.injectionPending = true;
        group.lastInjectionError = errorMessage;
        group.updatedAt = failedAt;
        changed = true;
      }

      if (changed) {
        await this.deps.saveState(state);
      }
    });
  }

  async markTaskInjectionApplied(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    const applied = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const injectedAt = this.deps.now().toISOString();
      let changed = false;
      const applied: OrchestrationTaskRecord[] = [];

      for (const taskId of taskIds) {
        const task = state.orchestration.tasks[taskId];
        if (!task) {
          continue;
        }

        if (task.coordinatorInjectedAt !== undefined) {
          continue;
        }

        if (!this.canInjectTaskIntoCoordinator(state, task)) {
          continue;
        }

        task.coordinatorInjectedAt = injectedAt;
        task.injectionPending = false;
        task.injectionAppliedAt = injectedAt;
        task.lastInjectionError = undefined;
        task.updatedAt = injectedAt;
        changed = true;
        applied.push({ ...task });
      }

      if (changed) {
        await this.deps.saveState(state);
      }

      return applied;
    });

    for (const task of applied) {
      this.logEvent(
        "orchestration.injection.applied",
        "coordinator injection applied",
        this.taskContext(task),
      );
    }
  }

  async markTaskInjectionFailed(taskIds: string[], errorMessage: string): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    const failed = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const failedAt = this.deps.now().toISOString();
      let changed = false;
      const failed: OrchestrationTaskRecord[] = [];

      for (const taskId of taskIds) {
        const task = state.orchestration.tasks[taskId];
        if (!task) {
          continue;
        }

        if (!this.canInjectTaskIntoCoordinator(state, task)) {
          continue;
        }

        task.injectionPending = true;
        task.lastInjectionError = errorMessage;
        task.updatedAt = failedAt;
        changed = true;
        failed.push({ ...task });
      }

      if (changed) {
        await this.deps.saveState(state);
      }

      return failed;
    });

    for (const task of failed) {
      this.logEvent("orchestration.injection.failed", "coordinator injection failed", {
        ...this.taskContext(task),
        error: errorMessage,
      });
    }
  }

  async recordTaskProgress(taskId: string): Promise<OrchestrationTaskRecord> {
    return await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task) {
        throw new Error(`task "${taskId}" does not exist`);
      }

      task.lastProgressAt = this.deps.now().toISOString();
      task.updatedAt = task.lastProgressAt;
      await this.deps.saveState(state);
      return { ...task };
    });
  }

  async listHeartbeatTasks(thresholdSeconds: number): Promise<OrchestrationTaskRecord[]> {
    if (thresholdSeconds <= 0) {
      return [];
    }

    const state = await this.deps.loadState();
    const now = this.deps.now().getTime();
    return Object.values(state.orchestration.tasks)
      .filter((task) => {
        if (task.status !== "running") {
          return false;
        }

        const reference = task.lastProgressAt ?? task.createdAt;
        const elapsed = (now - new Date(reference).getTime()) / 1000;
        return elapsed >= thresholdSeconds;
      })
      .map((task) => ({ ...task }));
  }

  async cancelTask(input: CancelTaskInput): Promise<OrchestrationTaskRecord> {
    return await this.requestTaskCancellation(input);
  }

  async requestTaskCancellation(input: CancelTaskInput): Promise<OrchestrationTaskRecord> {
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      if (input.sourceHandle === undefined && input.coordinatorSession === undefined) {
        throw new Error(`task "${input.taskId}" cancel request must include sourceHandle or coordinatorSession`);
      }

      if (input.sourceHandle !== undefined && task.sourceHandle !== input.sourceHandle) {
        throw new Error(
          `task "${input.taskId}" belongs to source "${task.sourceHandle}", not "${input.sourceHandle}"`,
        );
      }

      if (input.coordinatorSession !== undefined && task.coordinatorSession !== input.coordinatorSession) {
        throw new Error(
          `task "${input.taskId}" belongs to coordinator "${task.coordinatorSession}", not "${input.coordinatorSession}"`,
        );
      }

      if (this.isTerminalStatus(task.status)) {
        return { task: { ...task }, shouldPropagate: false, closedPackageId: undefined as string | undefined };
      }

      const now = this.deps.now().toISOString();

      if (task.status === "running") {
        const shouldPropagate = task.cancelRequestedAt === undefined;
        task.cancelRequestedAt = task.cancelRequestedAt ?? now;
        task.updatedAt = now;
        this.bumpGroupUpdated(state, task.groupId, now);
        await this.deps.saveState(state);
        return { task: { ...task }, shouldPropagate, closedPackageId: undefined as string | undefined };
      }

      const closedPackageId = this.detachTaskFromQuestionFlows(state, task, now);
      task.status = "cancelled";
      task.openQuestion = undefined;
      task.cancelRequestedAt = task.cancelRequestedAt ?? now;
      task.cancelCompletedAt = now;
      task.lastCancelError = undefined;
      task.updatedAt = now;
      this.bumpGroupUpdated(state, task.groupId, now);
      await this.deps.saveState(state);
      return { task: { ...task }, shouldPropagate: false, closedPackageId };
    });

    this.logEvent(
      "orchestration.task.cancel_requested",
      "task cancellation requested",
      this.taskContext(prepared.task),
    );

    if (prepared.shouldPropagate) {
      this.startWorkerCancellation(prepared.task);
    }
    if (prepared.closedPackageId) {
      await this.handoffQueuedQuestions(prepared.task.coordinatorSession, prepared.closedPackageId);
    }

    return prepared.task;
  }

  async completeTaskCancellation(taskId: string): Promise<OrchestrationTaskRecord> {
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task) {
        throw new Error(`task "${taskId}" does not exist`);
      }

      if (this.isTerminalStatus(task.status)) {
        return { task: { ...task } };
      }

      const now = this.deps.now().toISOString();
      let replacementQuestionId: string | undefined;
      if (task.correctionPending?.reason === "misrouted_answer") {
        replacementQuestionId = this.deps.createId();
        const packageId = this.reopenActiveHumanPackageForTask(state, task, now);
        task.status = packageId ? "waiting_for_human" : "blocked";
        task.openQuestion = this.buildReplacementOpenQuestion(task, replacementQuestionId, now, packageId);
        task.correctionPending = undefined;
        task.cancelRequestedAt = undefined;
        task.cancelCompletedAt = undefined;
        task.lastCancelError = undefined;
      } else {
        task.status = "cancelled";
        task.cancelCompletedAt = now;
        task.lastCancelError = undefined;
      }
      task.updatedAt = now;
      this.bumpGroupUpdated(state, task.groupId, now);
      await this.deps.saveState(state);
      return { task: { ...task }, replacementQuestionId };
    });

    if (prepared.replacementQuestionId) {
      this.logEvent("orchestration.task.correction_reopened", "task correction reopened blocker", {
        ...this.taskContext(prepared.task),
        replacement_question_id: prepared.replacementQuestionId,
      });
      try {
        await this.deps.wakeCoordinatorSession?.({
          coordinatorSession: prepared.task.coordinatorSession,
        });
      } catch (error) {
        await this.recordOpenQuestionWakeError(
          prepared.task.taskId,
          prepared.replacementQuestionId,
          error instanceof Error ? error.message : String(error),
        );
      }
      return prepared.task;
    }

    this.logEvent(
      "orchestration.task.cancel_completed",
      "task cancellation completed",
      this.taskContext(prepared.task),
    );

    return prepared.task;
  }

  async failTaskCancellation(taskId: string, errorMessage: string): Promise<OrchestrationTaskRecord> {
    const task = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task) {
        throw new Error(`task "${taskId}" does not exist`);
      }

      if (this.isTerminalStatus(task.status)) {
        return { ...task };
      }

      task.lastCancelError = errorMessage;
      task.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
      return { ...task };
    });

    this.logEvent("orchestration.task.cancel_failed", "task cancellation failed", {
      ...this.taskContext(task),
      error: errorMessage,
    });

    return task;
  }

  async approveTask(input: ConfirmTaskInput): Promise<OrchestrationTaskRecord> {
    // Pre-check outside the mutex as a fail-fast gate.  The snapshot may be stale
    // by the time we acquire the lock (e.g. a concurrent cancellation), but this
    // avoids entering the mutex — and the expensive ensureWorkerSession I/O — for
    // obviously invalid requests.  Ownership and status are re-validated inside
    // the mutex below.
    const currentTask = await this.getTask(input.taskId);
    if (!currentTask) {
      throw new Error(`task "${input.taskId}" does not exist`);
    }
    this.assertCoordinatorOwnership(currentTask, input.coordinatorSession);
    this.assertNeedsConfirmation(currentTask);

    const workerSession =
      currentTask.workerSession ??
      (await this.resolveWorkerSession({
        sourceHandle: currentTask.sourceHandle,
        sourceKind: currentTask.sourceKind,
        coordinatorSession: currentTask.coordinatorSession,
        workspace: currentTask.workspace,
        targetAgent: currentTask.targetAgent,
        task: currentTask.task,
        ...(currentTask.role ? { role: currentTask.role } : {}),
      }));
    const ensuredWorkerSession = await this.deps.ensureWorkerSession({
      workerSession,
      sourceHandle: currentTask.sourceHandle,
      sourceKind: currentTask.sourceKind,
      coordinatorSession: currentTask.coordinatorSession,
      workspace: currentTask.workspace,
      targetAgent: currentTask.targetAgent,
      role: currentTask.role,
    });
    const prepared = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }
      this.assertCoordinatorOwnership(task, input.coordinatorSession);
      this.assertNeedsConfirmation(task);
      const previousStatus = task.status;
      const previousUpdatedAt = task.updatedAt;
      const previousBinding = state.orchestration.workerBindings[ensuredWorkerSession];
      task.workerSession = ensuredWorkerSession;
      task.status = "running";
      task.updatedAt = this.deps.now().toISOString();
      state.orchestration.workerBindings[ensuredWorkerSession] = {
        sourceHandle: ensuredWorkerSession,
        coordinatorSession: task.coordinatorSession,
        workspace: task.workspace,
        targetAgent: task.targetAgent,
        role: task.role,
      };

      await this.deps.saveState(state);

      return {
        task: { ...task },
        previousStatus,
        previousUpdatedAt,
        previousBinding,
      };
    });

    try {
      await this.deps.dispatchWorkerTask({
        taskId: prepared.task.taskId,
        workerSession: ensuredWorkerSession,
        coordinatorSession: prepared.task.coordinatorSession,
        workspace: prepared.task.workspace,
        targetAgent: prepared.task.targetAgent,
        ...(prepared.task.role ? { role: prepared.task.role } : {}),
        task: prepared.task.task,
      });
    } catch (error) {
      await this.mutate(async () => {
        const state = await this.deps.loadState();
        const task = state.orchestration.tasks[input.taskId];
        if (task) {
          task.status = prepared.previousStatus;
          task.updatedAt = prepared.previousUpdatedAt;
        }
        if (prepared.previousBinding) {
          state.orchestration.workerBindings[ensuredWorkerSession] = prepared.previousBinding;
        } else {
          delete state.orchestration.workerBindings[ensuredWorkerSession];
        }
        await this.deps.saveState(state);
      });
      throw error;
    }

    this.logEvent("orchestration.task.approved", "task approved", this.taskContext(prepared.task));

    return prepared.task;
  }

  async rejectTask(input: ConfirmTaskInput): Promise<OrchestrationTaskRecord> {
    const task = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[input.taskId];
      if (!task) {
        throw new Error(`task "${input.taskId}" does not exist`);
      }

      this.assertCoordinatorOwnership(task, input.coordinatorSession);
      this.assertNeedsConfirmation(task);

      task.status = "cancelled";
      task.summary = "rejected";
      task.updatedAt = this.deps.now().toISOString();

      await this.deps.saveState(state);

      return { ...task };
    });

    this.logEvent("orchestration.task.rejected", "task rejected", this.taskContext(task));

    return task;
  }

  private async resolveWorkerSession(input: RequestDelegateInput): Promise<string> {
    const role = this.normalizeRole(input.role);
    const reusable = await this.deps.findReusableWorkerSession?.({
      sourceHandle: input.sourceHandle,
      sourceKind: input.sourceKind,
      coordinatorSession: input.coordinatorSession,
      workspace: input.workspace,
      targetAgent: input.targetAgent,
      role,
    });

    if (reusable && reusable.trim().length > 0) {
      return reusable.trim();
    }

    return [input.workspace, input.targetAgent, role, input.coordinatorSession]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join(":");
  }

  private buildGroupSummary(
    group: OrchestrationGroupRecord,
    tasks: OrchestrationTaskRecord[],
  ): OrchestrationGroupSummary {
    const sortedTasks = tasks
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((task) => ({ ...task }));

    const pendingApprovalTasks = sortedTasks.filter(
      (task) => task.status === "pending" || task.status === "needs_confirmation",
    ).length;
    const runningTasks = sortedTasks.filter((task) => task.status === "running").length;
    const completedTasks = sortedTasks.filter((task) => task.status === "completed").length;
    const failedTasks = sortedTasks.filter((task) => task.status === "failed").length;
    const cancelledTasks = sortedTasks.filter((task) => task.status === "cancelled").length;

    return {
      group: { ...group },
      tasks: sortedTasks,
      totalTasks: sortedTasks.length,
      pendingApprovalTasks,
      runningTasks,
      completedTasks,
      failedTasks,
      cancelledTasks,
      terminal:
        sortedTasks.length > 0 &&
        sortedTasks.every((task) => task.reviewPending === undefined) &&
        sortedTasks.every((task) => this.isTerminalStatus(task.status)),
    };
  }

  private canInjectGroupIntoCoordinator(
    state: AppState,
    groupId: string,
    groupTasks = Object.values(state.orchestration.tasks).filter((task) => task.groupId === groupId),
  ): boolean {
    const group = this.ensureGroups(state)[groupId];
    if (!group) {
      return false;
    }
    if (groupTasks.length === 0) {
      return false;
    }
    if (group.coordinatorInjectedAt !== undefined && group.injectionPending !== true) {
      return false;
    }
    if (groupTasks.some((task) => task.reviewPending !== undefined)) {
      return false;
    }
    return groupTasks.every((task) => task.status === "completed" || task.status === "failed");
  }

  private canInjectTaskIntoCoordinator(state: AppState, task: OrchestrationTaskRecord): boolean {
    if ((task.status !== "completed" && task.status !== "failed") || task.reviewPending !== undefined) {
      return false;
    }
    if (task.groupId) {
      return this.canInjectGroupIntoCoordinator(state, task.groupId);
    }
    return true;
  }

  private resolveRpcSourceContext(
    state: AppState,
    sourceHandle: string,
  ): { sourceKind: OrchestrationSourceKind; coordinatorSession: string; workspace: string } {
    const binding = state.orchestration.workerBindings[sourceHandle];
    if (binding) {
      return {
        sourceKind: "worker",
        coordinatorSession: binding.coordinatorSession,
        workspace: binding.workspace,
      };
    }

    const coordinatorSession = Object.values(state.sessions).find(
      (session) => session.transport_session === sourceHandle,
    );
    if (coordinatorSession) {
      return {
        sourceKind: "coordinator",
        coordinatorSession: sourceHandle,
        workspace: coordinatorSession.workspace,
      };
    }

    throw new Error(`sourceHandle "${sourceHandle}" is not a registered coordinator or worker session`);
  }

  private assertRpcRequestAllowed(
    state: AppState,
    sourceKind: OrchestrationSourceKind,
    coordinatorSession: string,
    targetAgent: string,
    role: string | undefined,
  ): void {
    const policy = this.deps.config.orchestration;

    if (sourceKind === "worker" && !policy.allowWorkerChainedRequests) {
      throw new Error("worker-originated delegation is disabled by orchestration policy");
    }

    if (policy.allowedAgentRequestTargets.length > 0 && !policy.allowedAgentRequestTargets.includes(targetAgent)) {
      throw new Error(`target agent "${targetAgent}" is not allowed for agent-requested delegation`);
    }

    if (role && policy.allowedAgentRequestRoles.length > 0 && !policy.allowedAgentRequestRoles.includes(role)) {
      throw new Error(`role "${role}" is not allowed for agent-requested delegation`);
    }

    const outstandingRequests = Object.values(state.orchestration.tasks).filter(
      (task) =>
        task.coordinatorSession === coordinatorSession &&
        task.sourceKind !== "human" &&
        (task.status === "needs_confirmation" || task.status === "running"),
    );

    if (outstandingRequests.length >= policy.maxPendingAgentRequestsPerCoordinator) {
      throw new Error("agent-requested delegation quota exceeded for this coordinator");
    }
  }

  private validateRequest(input: RequestDelegateInput): void {
    if (input.sourceHandle.trim().length === 0) {
      throw new Error("sourceHandle must be a non-empty string");
    }

    if (input.coordinatorSession.trim().length === 0) {
      throw new Error("coordinatorSession must be a non-empty string");
    }

    if (input.workspace.trim().length === 0) {
      throw new Error("workspace must be a non-empty string");
    }

    if (input.targetAgent.trim().length === 0) {
      throw new Error("targetAgent must be a non-empty string");
    }

    if (input.task.trim().length === 0) {
      throw new Error("task must be a non-empty string");
    }
  }

  private validateRpcRequest(input: RequestDelegateRpcInput): void {
    if (input.sourceHandle.trim().length === 0) {
      throw new Error("sourceHandle must be a non-empty string");
    }

    if (input.targetAgent.trim().length === 0) {
      throw new Error("targetAgent must be a non-empty string");
    }

    if (input.task.trim().length === 0) {
      throw new Error("task must be a non-empty string");
    }
  }

  private normalizeRole(role: string | undefined): string | undefined {
    const normalized = role?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private normalizeGroupId(groupId: string | undefined): string | undefined {
    const normalized = groupId?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private assertCoordinatorQuestionMatch(task: OrchestrationTaskRecord, questionId: string): OrchestrationOpenQuestionRecord {
    const openQuestion = task.openQuestion;
    if (!openQuestion) {
      throw new Error(`task "${task.taskId}" does not have an open question`);
    }
    if (openQuestion.questionId !== questionId) {
      throw new Error(`task "${task.taskId}" open question is "${openQuestion.questionId}", not "${questionId}"`);
    }
    if (openQuestion.status !== "open") {
      throw new Error(`task "${task.taskId}" question "${questionId}" is ${openQuestion.status}, not open`);
    }
    return openQuestion;
  }

  private assertTaskAnswerIsWithinAwaitedHumanSnapshot(
    state: AppState,
    task: OrchestrationTaskRecord,
    questionId: string,
  ): void {
    if (task.status !== "waiting_for_human") {
      return;
    }

    const packageId = task.openQuestion?.packageId;
    if (!packageId) {
      return;
    }

    const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
    if (coordinatorState.activePackageId !== packageId) {
      return;
    }

    const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
    const awaitingMessageId = packageRecord?.awaitingReplyMessageId;
    if (!packageRecord || !awaitingMessageId) {
      return;
    }

    const awaitingMessage = packageRecord.messages.find((message) => message.messageId === awaitingMessageId);
    const inSnapshot = awaitingMessage?.taskQuestions?.some(
      (entry) => entry.taskId === task.taskId && entry.questionId === questionId,
    );
    if (!inSnapshot) {
      throw new Error(
        `task "${task.taskId}" question "${questionId}" is outside awaited message "${awaitingMessageId}" for package "${packageId}"`,
      );
    }
  }

  private matchesFilter(task: OrchestrationTaskRecord, filter?: OrchestrationTaskFilter): boolean {
    if (!filter) {
      return true;
    }

    return (
      (filter.sourceHandle === undefined || task.sourceHandle === filter.sourceHandle) &&
      (filter.coordinatorSession === undefined || task.coordinatorSession === filter.coordinatorSession) &&
      (filter.workspace === undefined || task.workspace === filter.workspace) &&
      (filter.targetAgent === undefined || task.targetAgent === filter.targetAgent) &&
      (filter.role === undefined || task.role === filter.role) &&
      (filter.status === undefined || task.status === filter.status)
    );
  }

  private isTerminalStatus(status: OrchestrationTaskStatus): boolean {
    return status === "completed" || status === "failed" || status === "cancelled";
  }

  private assertCoordinatorOwnership(task: OrchestrationTaskRecord, coordinatorSession: string): void {
    if (task.coordinatorSession !== coordinatorSession) {
      throw new Error(
        `task "${task.taskId}" belongs to coordinator "${task.coordinatorSession}", not "${coordinatorSession}"`,
      );
    }
  }

  private assertNeedsConfirmation(task: OrchestrationTaskRecord): void {
    if (task.status !== "needs_confirmation") {
      throw new Error(`task "${task.taskId}" is ${task.status}, not needs_confirmation`);
    }
  }

  private assertGroupOwnership(
    group: OrchestrationGroupRecord | undefined,
    groupId: string,
    coordinatorSession: string,
  ): void {
    if (!group) {
      throw new Error(`group "${groupId}" does not exist`);
    }
    if (group.coordinatorSession !== coordinatorSession) {
      throw new Error(
        `group "${groupId}" belongs to coordinator "${group.coordinatorSession}", not "${coordinatorSession}"`,
      );
    }
  }

  private ensureHumanQuestionPackages(state: AppState): Record<string, OrchestrationHumanQuestionPackageRecord> {
    if (!("humanQuestionPackages" in state.orchestration) || !state.orchestration.humanQuestionPackages) {
      (
        state.orchestration as AppState["orchestration"] & {
          humanQuestionPackages: Record<string, OrchestrationHumanQuestionPackageRecord>;
        }
      ).humanQuestionPackages = {};
    }
    return state.orchestration.humanQuestionPackages;
  }

  private ensureCoordinatorQuestionState(
    state: AppState,
    coordinatorSession: string,
  ): OrchestrationCoordinatorQuestionStateRecord {
    if (!("coordinatorQuestionState" in state.orchestration) || !state.orchestration.coordinatorQuestionState) {
      (
        state.orchestration as AppState["orchestration"] & {
          coordinatorQuestionState: Record<string, OrchestrationCoordinatorQuestionStateRecord>;
        }
      ).coordinatorQuestionState = {};
    }

    state.orchestration.coordinatorQuestionState[coordinatorSession] ??= {
      queuedQuestions: [],
    };

    return state.orchestration.coordinatorQuestionState[coordinatorSession]!;
  }

  private ensureCoordinatorRoutes(state: AppState): Record<string, OrchestrationCoordinatorRouteContextRecord> {
    if (!("coordinatorRoutes" in state.orchestration) || !state.orchestration.coordinatorRoutes) {
      (
        state.orchestration as AppState["orchestration"] & {
          coordinatorRoutes: Record<string, OrchestrationCoordinatorRouteContextRecord>;
        }
      ).coordinatorRoutes = {};
    }
    return state.orchestration.coordinatorRoutes;
  }

  private ensureGroups(state: AppState): Record<string, OrchestrationGroupRecord> {
    if (!("groups" in state.orchestration) || !state.orchestration.groups) {
      (state.orchestration as AppState["orchestration"] & { groups: Record<string, OrchestrationGroupRecord> }).groups =
        {};
    }
    return state.orchestration.groups;
  }

  private removeEmptyGroupsForCoordinator(state: AppState, coordinatorSession: string): boolean {
    const groups = this.ensureGroups(state);
    const referencedGroupIds = new Set(
      Object.values(state.orchestration.tasks)
        .map((task) => task.groupId)
        .filter((groupId): groupId is string => typeof groupId === "string"),
    );
    let removedAny = false;
    for (const [groupId, group] of Object.entries(groups)) {
      if (group.coordinatorSession !== coordinatorSession) {
        continue;
      }
      if (!referencedGroupIds.has(groupId)) {
        delete groups[groupId];
        removedAny = true;
      }
    }
    return removedAny;
  }

  private removeCoordinatorMetadataIfUnused(state: AppState, coordinatorSession: string): boolean {
    const hasCoordinatorTasks = Object.values(state.orchestration.tasks).some(
      (task) => task.coordinatorSession === coordinatorSession,
    );
    const hasCoordinatorBindings = Object.values(state.orchestration.workerBindings).some(
      (binding) => binding.coordinatorSession === coordinatorSession,
    );
    if (hasCoordinatorTasks || hasCoordinatorBindings) {
      return false;
    }

    let removedAny = false;

    const packages = this.ensureHumanQuestionPackages(state);
    for (const [packageId, packageRecord] of Object.entries(packages)) {
      if (packageRecord.coordinatorSession === coordinatorSession) {
        delete packages[packageId];
        removedAny = true;
      }
    }

    if (state.orchestration.coordinatorQuestionState?.[coordinatorSession] !== undefined) {
      delete state.orchestration.coordinatorQuestionState[coordinatorSession];
      removedAny = true;
    }

    if (state.orchestration.coordinatorRoutes?.[coordinatorSession] !== undefined) {
      delete state.orchestration.coordinatorRoutes[coordinatorSession];
      removedAny = true;
    }

    return removedAny;
  }

  private bumpGroupUpdated(state: AppState, groupId: string | undefined, now: string): void {
    if (!groupId) {
      return;
    }
    const group = this.ensureGroups(state)[groupId];
    if (group) {
      group.updatedAt = now;
    }
  }

  private getLatestDeliveredPackageMessage(
    packageRecord: OrchestrationHumanQuestionPackageRecord,
  ): OrchestrationHumanQuestionPackageMessageRecord | null {
    for (let index = packageRecord.messages.length - 1; index >= 0; index -= 1) {
      const message = packageRecord.messages[index];
      if (message?.deliveredAt) {
        return message;
      }
    }
    return null;
  }

  private snapshotCoordinatorDeliveryRoute(
    route: OrchestrationCoordinatorRouteContextRecord | undefined,
  ): FrozenCoordinatorDeliveryRoute | undefined {
    if (!route) {
      return undefined;
    }

    return {
      chatKey: route.chatKey,
      ...(route.accountId ? { accountId: route.accountId } : {}),
      ...(route.replyContextToken ? { replyContextToken: route.replyContextToken } : {}),
    };
  }

  private normalizeFrozenDeliveryRoute(route: FrozenCoordinatorDeliveryRoute): FrozenCoordinatorDeliveryRoute {
    return {
      chatKey: route.chatKey,
      ...(route.accountId && route.replyContextToken
        ? {
            accountId: route.accountId,
            replyContextToken: route.replyContextToken,
          }
        : {}),
    };
  }

  private serializeFrozenDeliveryRoute(
    route: FrozenCoordinatorDeliveryRoute,
  ): Pick<
    OrchestrationHumanQuestionPackageMessageRecord,
    "routeChatKey" | "routeAccountId" | "routeReplyContextToken"
  > {
    const normalized = this.normalizeFrozenDeliveryRoute(route);
    return {
      routeChatKey: normalized.chatKey,
      ...(normalized.accountId && normalized.replyContextToken
        ? {
            routeAccountId: normalized.accountId,
            routeReplyContextToken: normalized.replyContextToken,
          }
        : {}),
    };
  }

  private resolveFrozenPackageMessageRoute(
    message: OrchestrationHumanQuestionPackageMessageRecord,
  ): FrozenCoordinatorDeliveryRoute | null {
    if (message.routeChatKey) {
      return this.normalizeFrozenDeliveryRoute({
        chatKey: message.routeChatKey,
        ...(message.routeAccountId ? { accountId: message.routeAccountId } : {}),
        ...(message.routeReplyContextToken ? { replyContextToken: message.routeReplyContextToken } : {}),
      });
    }

    if (message.deliveredChatKey) {
      return {
        chatKey: message.deliveredChatKey,
        ...(message.deliveryAccountId ? { accountId: message.deliveryAccountId } : {}),
      };
    }

    return null;
  }

  private async deliverHumanQuestionPackageMessage(input: {
    coordinatorSession: string;
    packageId: string;
    messageId: string;
    promptText: string;
    route: FrozenCoordinatorDeliveryRoute | null;
  }): Promise<void> {
    if (!input.route) {
      const errorMessage = `coordinator "${input.coordinatorSession}" does not have a delivery route for human question packages`;
      await this.recordPackageMessageDeliveryError(
        input.coordinatorSession,
        input.packageId,
        input.messageId,
        errorMessage,
      );
      throw new Error(errorMessage);
    }
    if (!this.deps.deliverCoordinatorMessage) {
      const errorMessage = "deliverCoordinatorMessage dependency is required for human question package delivery";
      await this.recordPackageMessageDeliveryError(
        input.coordinatorSession,
        input.packageId,
        input.messageId,
        errorMessage,
      );
      throw new Error(errorMessage);
    }

    try {
      const deliveredRoute =
        (await this.deps.deliverCoordinatorMessage({
          coordinatorSession: input.coordinatorSession,
          chatKey: input.route.chatKey,
          accountId: input.route.accountId,
          replyContextToken: input.route.replyContextToken,
          text: input.promptText,
        })) ?? input.route;
      await this.recordPackageMessageDeliverySuccess({
        coordinatorSession: input.coordinatorSession,
        packageId: input.packageId,
        messageId: input.messageId,
        route: this.normalizeFrozenDeliveryRoute(deliveredRoute),
        deliveryAccountId: deliveredRoute.accountId,
      });
    } catch (error) {
      if (isQuotaDeferredError(error)) {
        // Quota deferred is not a delivery failure: leave the package's
        // delivery state pending so the next wake retries cleanly after the
        // user's next inbound resets the quota window. Upstream callers
        // (coordinatorRequestHumanInput, coordinatorFollowUpHumanPackage,
        // retryHumanQuestionPackageDelivery) will receive the deferred error
        // and may need their own propagation handling — see follow-up TODO.
        throw error;
      }
      await this.recordPackageMessageDeliveryError(
        input.coordinatorSession,
        input.packageId,
        input.messageId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async recordPackageMessageDeliverySuccess(input: {
    coordinatorSession: string;
    packageId: string;
    messageId: string;
    route: FrozenCoordinatorDeliveryRoute;
    deliveryAccountId?: string;
  }): Promise<void> {
    await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, input.coordinatorSession);
      if (coordinatorState.activePackageId !== input.packageId) {
        return;
      }

      const packageRecord = this.ensureHumanQuestionPackages(state)[input.packageId];
      if (!packageRecord || packageRecord.status !== "active") {
        return;
      }

      const message = packageRecord.messages.find((entry) => entry.messageId === input.messageId);
      if (!message) {
        return;
      }

      const now = this.deps.now().toISOString();
      message.deliveredAt = now;
      message.deliveredChatKey = input.route.chatKey;
      message.deliveryAccountId = input.deliveryAccountId;
      message.routeChatKey = input.route.chatKey;
      message.routeAccountId = input.route.accountId && input.route.replyContextToken ? input.route.accountId : undefined;
      message.routeReplyContextToken = input.route.replyContextToken;
      message.lastDeliveryError = undefined;
      packageRecord.awaitingReplyMessageId = input.messageId;
      packageRecord.updatedAt = now;
      await this.deps.saveState(state);
    });
  }

  private async recordPackageMessageDeliveryError(
    coordinatorSession: string,
    packageId: string,
    messageId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, coordinatorSession);
      if (coordinatorState.activePackageId !== packageId) {
        return;
      }

      const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
      if (!packageRecord || packageRecord.status !== "active") {
        return;
      }

      const message = packageRecord.messages.find((entry) => entry.messageId === messageId);
      if (!message) {
        return;
      }

      const now = this.deps.now().toISOString();
      message.lastDeliveryError = errorMessage;
      if (packageRecord.messages.at(-1)?.messageId === messageId) {
        packageRecord.awaitingReplyMessageId = undefined;
      }
      packageRecord.updatedAt = now;
      await this.deps.saveState(state);
    });
  }

  private async recordOpenQuestionWakeError(taskId: string, questionId: string, errorMessage: string): Promise<void> {
    await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task || task.openQuestion?.questionId !== questionId || task.openQuestion.status !== "open") {
        return;
      }

      task.openQuestion = {
        ...task.openQuestion,
        lastWakeError: errorMessage,
      };
      task.updatedAt = this.deps.now().toISOString();
      await this.deps.saveState(state);
    });
  }

  private async handoffQueuedQuestions(coordinatorSession: string, closedPackageId: string): Promise<void> {
    const queuedQuestions = await this.mutate(async () => {
      const state = await this.deps.loadState();
      const coordinatorState = this.ensureCoordinatorQuestionState(state, coordinatorSession);
      if (coordinatorState.activePackageId === closedPackageId) {
        return [];
      }

      const validQueuedQuestions = coordinatorState.queuedQuestions.filter((entry) => {
        const task = state.orchestration.tasks[entry.taskId];
        return (
          task?.coordinatorSession === coordinatorSession &&
          task.status === "blocked" &&
          task.openQuestion?.status === "open" &&
          task.openQuestion.questionId === entry.questionId
        );
      });
      if (validQueuedQuestions.length !== coordinatorState.queuedQuestions.length) {
        coordinatorState.queuedQuestions = validQueuedQuestions;
        await this.deps.saveState(state);
      }
      return validQueuedQuestions;
    });

    if (queuedQuestions.length === 0) {
      return;
    }

    try {
      await this.deps.wakeCoordinatorSession?.({
        coordinatorSession,
      });
      await this.mutate(async () => {
        const state = await this.deps.loadState();
        const coordinatorState = this.ensureCoordinatorQuestionState(state, coordinatorSession);
        coordinatorState.queuedQuestions = coordinatorState.queuedQuestions.filter(
          (entry) =>
            !queuedQuestions.some(
              (queued) => queued.taskId === entry.taskId && queued.questionId === entry.questionId,
            ),
        );
        await this.deps.saveState(state);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await Promise.all(
        queuedQuestions.map(async ({ taskId, questionId }) => {
          const state = await this.deps.loadState();
          const task = state.orchestration.tasks[taskId];
          if (!task?.openQuestion || task.openQuestion.status !== "open" || task.openQuestion.questionId !== questionId) {
            return;
          }
          await this.recordOpenQuestionWakeError(taskId, questionId, errorMessage);
        }),
      );
    }
  }

  private async restoreBlockedQuestionAfterResumeFailure(
    taskId: string,
    questionId: string,
    errorMessage: string,
    packageRestore?: {
      packageId: string;
      packageRecord: OrchestrationHumanQuestionPackageRecord;
      activePackageId?: string;
    },
  ): Promise<void> {
    await this.mutate(async () => {
      const state = await this.deps.loadState();
      const task = state.orchestration.tasks[taskId];
      if (!task || task.openQuestion?.questionId !== questionId || task.openQuestion.status !== "answered") {
        return;
      }

      task.status = packageRestore ? "waiting_for_human" : "blocked";
      task.openQuestion = {
        ...task.openQuestion,
        status: "open",
        answeredAt: undefined,
        answerSource: undefined,
        answerText: undefined,
        lastResumeError: errorMessage,
      };
      const now = this.deps.now().toISOString();
      task.updatedAt = now;
      if (packageRestore) {
        const packageRecord = {
          ...packageRestore.packageRecord,
          initialTaskIds: [...packageRestore.packageRecord.initialTaskIds],
          openTaskIds: [...packageRestore.packageRecord.openTaskIds],
          resolvedTaskIds: [...packageRestore.packageRecord.resolvedTaskIds],
          messages: packageRestore.packageRecord.messages.map((message) => ({ ...message })),
          updatedAt: now,
        };
        this.ensureHumanQuestionPackages(state)[packageRestore.packageId] = packageRecord;
        const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
        coordinatorState.activePackageId = packageRestore.activePackageId;
      }
      await this.deps.saveState(state);
    });
  }

  private captureTaskHumanPackageContext(
    state: AppState,
    task: OrchestrationTaskRecord,
  ):
    | {
        packageId: string;
        packageRecord: OrchestrationHumanQuestionPackageRecord;
        activePackageId?: string;
      }
    | undefined {
    const packageId = task.openQuestion?.packageId;
    if (!packageId) {
      return undefined;
    }

    const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
    if (!packageRecord) {
      return undefined;
    }

    const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
    return {
      packageId,
      packageRecord: {
        ...packageRecord,
        initialTaskIds: [...packageRecord.initialTaskIds],
        openTaskIds: [...packageRecord.openTaskIds],
        resolvedTaskIds: [...packageRecord.resolvedTaskIds],
        messages: packageRecord.messages.map((message) => ({ ...message })),
      },
      activePackageId: coordinatorState.activePackageId,
    };
  }

  private resolveTaskFromHumanPackage(state: AppState, task: OrchestrationTaskRecord, now: string): void {
    const packageId = task.openQuestion?.packageId;
    if (!packageId) {
      return;
    }

    const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
    if (!packageRecord) {
      return;
    }

    packageRecord.openTaskIds = packageRecord.openTaskIds.filter((taskId) => taskId !== task.taskId);
    if (!packageRecord.resolvedTaskIds.includes(task.taskId)) {
      packageRecord.resolvedTaskIds.push(task.taskId);
    }
    packageRecord.updatedAt = now;

    const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
    if (packageRecord.openTaskIds.length === 0) {
      packageRecord.status = "closed";
      packageRecord.closedAt = now;
      packageRecord.awaitingReplyMessageId = undefined;
      if (coordinatorState.activePackageId === packageId) {
        coordinatorState.activePackageId = undefined;
      }
    }
  }

  private detachTaskFromQuestionFlows(state: AppState, task: OrchestrationTaskRecord, now: string): string | undefined {
    const questionId = task.openQuestion?.questionId;
    const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
    if (questionId) {
      coordinatorState.queuedQuestions = coordinatorState.queuedQuestions.filter(
        (entry) => !(entry.taskId === task.taskId && entry.questionId === questionId),
      );
    }

    const packageId = task.openQuestion?.packageId;
    if (!packageId) {
      return undefined;
    }

    const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
    if (!packageRecord) {
      return undefined;
    }

    packageRecord.openTaskIds = packageRecord.openTaskIds.filter((taskId) => taskId !== task.taskId);
    packageRecord.resolvedTaskIds = packageRecord.resolvedTaskIds.filter((taskId) => taskId !== task.taskId);
    packageRecord.updatedAt = now;

    if (packageRecord.openTaskIds.length === 0) {
      packageRecord.status = "closed";
      packageRecord.closedAt = now;
      packageRecord.awaitingReplyMessageId = undefined;
      if (coordinatorState.activePackageId === packageId) {
        coordinatorState.activePackageId = undefined;
      }
      return packageId;
    }

    return undefined;
  }

  private reopenActiveHumanPackageForTask(
    state: AppState,
    task: OrchestrationTaskRecord,
    now: string,
  ): string | undefined {
    const packageId = task.openQuestion?.packageId;
    if (!packageId) {
      return undefined;
    }

    const coordinatorState = this.ensureCoordinatorQuestionState(state, task.coordinatorSession);
    if (coordinatorState.activePackageId !== packageId) {
      return undefined;
    }

    const packageRecord = this.ensureHumanQuestionPackages(state)[packageId];
    if (!packageRecord || packageRecord.status !== "active") {
      return undefined;
    }

    if (!packageRecord.openTaskIds.includes(task.taskId)) {
      packageRecord.openTaskIds.push(task.taskId);
    }
    packageRecord.resolvedTaskIds = packageRecord.resolvedTaskIds.filter((taskId) => taskId !== task.taskId);
    packageRecord.updatedAt = now;
    return packageId;
  }

  private buildReplacementOpenQuestion(
    task: OrchestrationTaskRecord,
    questionId: string,
    askedAt: string,
    packageId?: string,
  ): OrchestrationOpenQuestionRecord {
    const current = task.openQuestion;
    return {
      questionId,
      question: current?.question ?? task.task,
      whyBlocked: current?.whyBlocked ?? "Coordinator discarded the contested result",
      whatIsNeeded: current?.whatIsNeeded ?? "A corrected answer from the worker",
      askedAt,
      status: "open",
      ...(packageId ? { packageId } : {}),
    };
  }

  private resolveLiveMessageTaskQuestions(
    state: AppState,
    packageRecord: OrchestrationHumanQuestionPackageRecord,
    message: OrchestrationHumanQuestionPackageMessageRecord,
  ): Array<{ taskId: string; questionId: string }> {
    return (message.taskQuestions ?? [])
      .filter((entry) => packageRecord.openTaskIds.includes(entry.taskId))
      .filter((entry) => {
        const task = state.orchestration.tasks[entry.taskId];
        return (
          task?.openQuestion !== undefined &&
          task.openQuestion.status === "open" &&
          task.openQuestion.questionId === entry.questionId
        );
      })
      .map((entry) => ({ ...entry }));
  }

  private logEvent(event: string, message: string, context: Record<string, unknown>): void {
    const logger = this.deps.logger;
    if (!logger) return;
    const cleaned: Record<string, string | number | boolean | null | undefined> = {};
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) continue;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        cleaned[key] = value;
      } else {
        cleaned[key] = String(value);
      }
    }
    void logger.info(event, message, cleaned);
  }

  private taskContext(task: OrchestrationTaskRecord): Record<string, unknown> {
    const context: Record<string, unknown> = {
      task_id: task.taskId,
      coordinator_session: task.coordinatorSession,
      target_agent: task.targetAgent,
      status: task.status,
    };
    if (task.groupId !== undefined) {
      context.group_id = task.groupId;
    }
    if (task.workerSession !== undefined) {
      context.worker_session = task.workerSession;
    }
    return context;
  }

  private groupContext(group: OrchestrationGroupRecord): Record<string, unknown> {
    return {
      group_id: group.groupId,
      coordinator_session: group.coordinatorSession,
      title: group.title,
    };
  }

  private startWorkerCancellation(task: OrchestrationTaskRecord): void {
    const resolveCancelFn =
      task.correctionPending?.reason === "misrouted_answer"
        ? () => this.deps.interruptWorkerTask ?? this.deps.cancelWorkerTask
        : () => this.deps.cancelWorkerTask;
    if (!task.workerSession || !resolveCancelFn()) {
      void (async () => {
        try {
          await this.completeTaskCancellation(task.taskId);
        } catch (error) {
          this.logEvent("orchestration.task.cancel_early_fail", "early cancellation completion failed", {
            task_id: task.taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return;
    }

    void (async () => {
      try {
        // Re-read the task from current state to avoid stale workerSession
        const state = await this.deps.loadState();
        const freshTask = state.orchestration.tasks[task.taskId];
        if (!freshTask || !freshTask.workerSession) {
          await this.completeTaskCancellation(task.taskId);
          return;
        }
        const cancelFn = resolveCancelFn();
        if (!cancelFn) {
          await this.completeTaskCancellation(task.taskId);
          return;
        }
        await cancelFn({
          taskId: task.taskId,
          workerSession: freshTask.workerSession,
          workspace: freshTask.workspace,
          targetAgent: freshTask.targetAgent,
        });
        await this.completeTaskCancellation(task.taskId);
      } catch (error) {
        await this.failTaskCancellation(task.taskId, error instanceof Error ? error.message : String(error));
      }
    })();
  }
}

function isRequestDelegateInput(
  input: RequestDelegateInput | RequestDelegateRpcInput,
): input is RequestDelegateInput {
  return "sourceKind" in input;
}
