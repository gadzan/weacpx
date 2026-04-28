import { readFile } from "node:fs/promises";

import { writePrivateFileAtomic } from "../util/private-file.js";
import { createEmptyState, type AppState } from "./types";
import {
  createEmptyOrchestrationState,
  type OrchestrationCorrectionPendingRecord,
  type OrchestrationCoordinatorQuestionStateRecord,
  type OrchestrationCoordinatorRouteContextRecord,
  type OrchestrationGroupRecord,
  type OrchestrationHumanQuestionPackageMessageRecord,
  type OrchestrationHumanQuestionPackageRecord,
  type OrchestrationOpenQuestionRecord,
  type OrchestrationReviewPendingRecord,
  type OrchestrationSourceKind,
  type OrchestrationState,
  type OrchestrationTaskRecord,
  type OrchestrationTaskStatus,
  type OrchestrationQueuedQuestionRecord,
  type WorkerBindingRecord,
} from "../orchestration/orchestration-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isTaskStatus(value: unknown): value is OrchestrationTaskStatus {
  return (
    value === "pending" ||
    value === "needs_confirmation" ||
    value === "running" ||
    value === "blocked" ||
    value === "waiting_for_human" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isSourceKind(value: unknown): value is OrchestrationSourceKind {
  return value === "human" || value === "coordinator" || value === "worker";
}

function isOpenQuestionRecord(value: unknown): value is OrchestrationOpenQuestionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.questionId) &&
    isString(value.question) &&
    isString(value.whyBlocked) &&
    isString(value.whatIsNeeded) &&
    isString(value.askedAt) &&
    (value.status === "open" || value.status === "answered" || value.status === "superseded") &&
    isOptionalString(value.answeredAt) &&
    (value.answerSource === undefined || value.answerSource === "coordinator" || value.answerSource === "human") &&
    isOptionalString(value.answerText) &&
    isOptionalString(value.packageId) &&
    isOptionalString(value.lastWakeError) &&
    isOptionalString(value.lastResumeError)
  );
}

function isReviewPendingRecord(value: unknown): value is OrchestrationReviewPendingRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.reviewId) &&
    value.reason === "misrouted_answer" &&
    isString(value.createdAt) &&
    isString(value.resultId) &&
    isString(value.resultText)
  );
}

function isCorrectionPendingRecord(value: unknown): value is OrchestrationCorrectionPendingRecord {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.requestedAt) && value.reason === "misrouted_answer";
}

function isTaskRecord(value: unknown): value is OrchestrationTaskRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.taskId) &&
    isString(value.sourceHandle) &&
    isSourceKind(value.sourceKind) &&
    isString(value.coordinatorSession) &&
    isOptionalString(value.workerSession) &&
    isString(value.workspace) &&
    isString(value.targetAgent) &&
    isOptionalString(value.role) &&
    isString(value.task) &&
    isTaskStatus(value.status) &&
    isString(value.summary) &&
    isString(value.resultText) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isOptionalString(value.chatKey) &&
    isOptionalString(value.replyContextToken) &&
    isOptionalString(value.accountId) &&
    isOptionalString(value.deliveryAccountId) &&
    isOptionalString(value.coordinatorInjectedAt) &&
    isOptionalString(value.cancelRequestedAt) &&
    isOptionalString(value.cancelCompletedAt) &&
    isOptionalString(value.lastCancelError) &&
    isOptionalBoolean(value.noticePending) &&
    isOptionalString(value.noticeSentAt) &&
    isOptionalString(value.lastNoticeError) &&
    isOptionalBoolean(value.injectionPending) &&
    isOptionalString(value.injectionAppliedAt) &&
    isOptionalString(value.lastInjectionError) &&
    isOptionalString(value.lastProgressAt) &&
    isOptionalString(value.groupId) &&
    (value.openQuestion === undefined || isOpenQuestionRecord(value.openQuestion)) &&
    (value.reviewPending === undefined || isReviewPendingRecord(value.reviewPending)) &&
    (value.correctionPending === undefined || isCorrectionPendingRecord(value.correctionPending))
  );
}

function isWorkerBindingRecord(value: unknown): value is WorkerBindingRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.sourceHandle) &&
    isString(value.coordinatorSession) &&
    isString(value.workspace) &&
    isString(value.targetAgent) &&
    isOptionalString(value.role)
  );
}

function isGroupRecord(value: unknown): value is OrchestrationGroupRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.groupId) &&
    isString(value.coordinatorSession) &&
    isString(value.title) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isOptionalString(value.coordinatorInjectedAt) &&
    isOptionalBoolean(value.injectionPending) &&
    isOptionalString(value.injectionAppliedAt) &&
    isOptionalString(value.lastInjectionError)
  );
}

function isQueuedQuestionRecord(value: unknown): value is OrchestrationQueuedQuestionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return isString(value.taskId) && isString(value.questionId) && isString(value.enqueuedAt);
}

function isCoordinatorQuestionStateRecord(value: unknown): value is OrchestrationCoordinatorQuestionStateRecord {
  if (!isRecord(value)) {
    return false;
  }

  const queuedQuestions = value.queuedQuestions;
  if (queuedQuestions !== undefined && !Array.isArray(queuedQuestions)) {
    return false;
  }

  return (
    (value.activePackageId === undefined || isString(value.activePackageId)) &&
    (queuedQuestions === undefined || queuedQuestions.every(isQueuedQuestionRecord))
  );
}

function isCoordinatorRouteContextRecord(value: unknown): value is OrchestrationCoordinatorRouteContextRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.coordinatorSession) &&
    isString(value.chatKey) &&
    isOptionalString(value.accountId) &&
    isOptionalString(value.replyContextToken) &&
    isString(value.updatedAt)
  );
}

function isHumanQuestionPackageMessageRecord(value: unknown): value is OrchestrationHumanQuestionPackageMessageRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.messageId) &&
    (value.kind === "initial" || value.kind === "follow_up") &&
    isString(value.promptText) &&
    isString(value.createdAt) &&
    isOptionalString(value.deliveredAt) &&
    isOptionalString(value.deliveredChatKey) &&
    isOptionalString(value.deliveryAccountId) &&
    isOptionalString(value.lastDeliveryError)
  );
}

function isHumanQuestionPackageRecord(value: unknown): value is OrchestrationHumanQuestionPackageRecord {
  if (!isRecord(value)) {
    return false;
  }

  const initialTaskIds = value.initialTaskIds;
  const openTaskIds = value.openTaskIds;
  const resolvedTaskIds = value.resolvedTaskIds;
  const messages = value.messages;

  return (
    isString(value.packageId) &&
    isString(value.coordinatorSession) &&
    (value.status === "active" || value.status === "closed") &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isOptionalString(value.closedAt) &&
    Array.isArray(initialTaskIds) && initialTaskIds.every(isString) &&
    Array.isArray(openTaskIds) && openTaskIds.every(isString) &&
    Array.isArray(resolvedTaskIds) && resolvedTaskIds.every(isString) &&
    Array.isArray(messages) && messages.every(isHumanQuestionPackageMessageRecord) &&
    isOptionalString(value.awaitingReplyMessageId)
  );
}

function parseOrchestrationState(raw: unknown, path: string): OrchestrationState {
  if (raw === undefined) {
    return createEmptyOrchestrationState();
  }

  if (!isRecord(raw)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration"`);
  }

  const tasks = raw.tasks;
  if (tasks !== undefined && !isRecord(tasks)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.tasks"`);
  }

  const workerBindings = raw.workerBindings;
  if (workerBindings !== undefined && !isRecord(workerBindings)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.workerBindings"`);
  }

  const groups = raw.groups;
  if (groups !== undefined && !isRecord(groups)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.groups"`);
  }

  const humanQuestionPackages = raw.humanQuestionPackages;
  if (humanQuestionPackages !== undefined && !isRecord(humanQuestionPackages)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.humanQuestionPackages"`);
  }

  const coordinatorQuestionState = raw.coordinatorQuestionState;
  if (coordinatorQuestionState !== undefined && !isRecord(coordinatorQuestionState)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.coordinatorQuestionState"`);
  }

  const coordinatorRoutes = raw.coordinatorRoutes;
  if (coordinatorRoutes !== undefined && !isRecord(coordinatorRoutes)) {
    throw new Error(`state file "${path}" must contain an object field "orchestration.coordinatorRoutes"`);
  }

  const parsedTasks: OrchestrationState["tasks"] = {};
  for (const [taskId, task] of Object.entries(tasks ?? {})) {
    if (!isTaskRecord(task)) {
      throw new Error(`state file "${path}" contains an invalid orchestration task at "${taskId}"`);
    }
    parsedTasks[taskId] = task;
  }

  const parsedWorkerBindings: OrchestrationState["workerBindings"] = {};
  for (const [workerSession, binding] of Object.entries(workerBindings ?? {})) {
    if (!isWorkerBindingRecord(binding)) {
      throw new Error(
        `state file "${path}" contains an invalid orchestration worker binding at "${workerSession}"`,
      );
    }
    parsedWorkerBindings[workerSession] = binding;
  }

  const parsedGroups: OrchestrationState["groups"] = {};
  for (const [groupId, group] of Object.entries(groups ?? {})) {
    if (!isGroupRecord(group)) {
      throw new Error(`state file "${path}" contains an invalid orchestration group at "${groupId}"`);
    }
    parsedGroups[groupId] = group;
  }

  const parsedHumanQuestionPackages: OrchestrationState["humanQuestionPackages"] = {};
  for (const [packageId, packageRecord] of Object.entries(humanQuestionPackages ?? {})) {
    if (!isHumanQuestionPackageRecord(packageRecord)) {
      throw new Error(`state file "${path}" contains an invalid human question package at "${packageId}"`);
    }
    parsedHumanQuestionPackages[packageId] = packageRecord;
  }

  const parsedCoordinatorQuestionState: OrchestrationState["coordinatorQuestionState"] = {};
  for (const [coordinatorSession, questionState] of Object.entries(coordinatorQuestionState ?? {})) {
    if (!isCoordinatorQuestionStateRecord(questionState)) {
      throw new Error(
        `state file "${path}" contains an invalid coordinator question state at "${coordinatorSession}"`,
      );
    }
    parsedCoordinatorQuestionState[coordinatorSession] = {
      activePackageId: questionState.activePackageId,
      queuedQuestions: (questionState.queuedQuestions ?? []).map((question) => ({ ...question })),
    };
  }

  const parsedCoordinatorRoutes: OrchestrationState["coordinatorRoutes"] = {};
  for (const [coordinatorSession, route] of Object.entries(coordinatorRoutes ?? {})) {
    if (!isCoordinatorRouteContextRecord(route)) {
      throw new Error(`state file "${path}" contains an invalid coordinator route at "${coordinatorSession}"`);
    }
    parsedCoordinatorRoutes[coordinatorSession] = route;
  }

  return {
    tasks: parsedTasks,
    workerBindings: parsedWorkerBindings,
    groups: parsedGroups,
    humanQuestionPackages: parsedHumanQuestionPackages,
    coordinatorQuestionState: parsedCoordinatorQuestionState,
    coordinatorRoutes: parsedCoordinatorRoutes,
  };
}

function isReplyMode(value: unknown): value is AppState["sessions"][string]["reply_mode"] {
  return value === "stream" || value === "final" || value === "verbose";
}

function isSessionRecord(value: unknown): value is AppState["sessions"][string] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.alias) &&
    isString(value.agent) &&
    isString(value.workspace) &&
    isString(value.transport_session) &&
    isOptionalString(value.transport_agent_command) &&
    isOptionalString(value.mode_id) &&
    (value.reply_mode === undefined || isReplyMode(value.reply_mode)) &&
    isString(value.created_at) &&
    isString(value.last_used_at)
  );
}

function parseSessions(raw: Record<string, unknown>, path: string): AppState["sessions"] {
  const sessions: AppState["sessions"] = {};
  for (const [alias, value] of Object.entries(raw)) {
    if (!isSessionRecord(value)) {
      throw new Error(`state file "${path}" contains malformed session record "${alias}"`);
    }
    sessions[alias] = value;
  }
  return sessions;
}

function isChatContextRecord(value: unknown): value is AppState["chat_contexts"][string] {
  return isRecord(value) && isString(value.current_session);
}

function parseChatContexts(raw: Record<string, unknown>, path: string): AppState["chat_contexts"] {
  const chatContexts: AppState["chat_contexts"] = {};
  for (const [chatKey, value] of Object.entries(raw)) {
    if (!isChatContextRecord(value)) {
      throw new Error(`state file "${path}" contains malformed chat context record "${chatKey}"`);
    }
    chatContexts[chatKey] = value;
  }
  return chatContexts;
}

export function parseState(raw: unknown, path: string): AppState {
  if (!isRecord(raw)) {
    throw new Error(`state file "${path}" must contain a JSON object`);
  }

  const sessions = raw.sessions;
  if (!isRecord(sessions)) {
    throw new Error(`state file "${path}" must contain an object field "sessions"`);
  }

  const chatContexts = raw.chat_contexts;
  if (!isRecord(chatContexts)) {
    throw new Error(`state file "${path}" must contain an object field "chat_contexts"`);
  }

  const orchestration = parseOrchestrationState(raw.orchestration, path);

  return {
    sessions: parseSessions(sessions, path),
    chat_contexts: parseChatContexts(chatContexts, path),
    orchestration,
  };
}

export class StateStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppState> {
    try {
      const content = await readFile(this.path, "utf8");
      if (content.trim() === "") {
        return createEmptyState();
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch (error) {
        throw new Error(`failed to parse state file "${this.path}"`, {
          cause: error,
        });
      }

      return parseState(parsed, this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyState();
      }
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    await writePrivateFileAtomic(this.path, JSON.stringify(state, null, 2));
  }
}
