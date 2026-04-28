export type OrchestrationTaskStatus =
  | "pending"
  | "needs_confirmation"
  | "running"
  | "blocked"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

export type OrchestrationSourceKind = "human" | "coordinator" | "worker";

export interface OrchestrationOpenQuestionRecord {
  questionId: string;
  question: string;
  whyBlocked: string;
  whatIsNeeded: string;
  askedAt: string;
  status: "open" | "answered" | "superseded";
  answeredAt?: string;
  answerSource?: "coordinator" | "human";
  answerText?: string;
  packageId?: string;
  lastWakeError?: string;
  lastResumeError?: string;
}

export interface OrchestrationReviewPendingRecord {
  reviewId: string;
  reason: "misrouted_answer";
  createdAt: string;
  resultId: string;
  resultText: string;
}

export interface OrchestrationCorrectionPendingRecord {
  requestedAt: string;
  reason: "misrouted_answer";
}

export interface OrchestrationTaskRecord {
  taskId: string;
  sourceHandle: string;
  sourceKind: OrchestrationSourceKind;
  coordinatorSession: string;
  workerSession?: string;
  workspace: string;
  targetAgent: string;
  role?: string;
  task: string;
  status: OrchestrationTaskStatus;
  summary: string;
  resultText: string;
  createdAt: string;
  updatedAt: string;
  chatKey?: string;
  replyContextToken?: string;
  accountId?: string;
  deliveryAccountId?: string;
  coordinatorInjectedAt?: string;
  cancelRequestedAt?: string;
  cancelCompletedAt?: string;
  lastCancelError?: string;
  noticePending?: boolean;
  noticeSentAt?: string;
  lastNoticeError?: string;
  injectionPending?: boolean;
  injectionAppliedAt?: string;
  lastInjectionError?: string;
  lastProgressAt?: string;
  groupId?: string;
  openQuestion?: OrchestrationOpenQuestionRecord;
  reviewPending?: OrchestrationReviewPendingRecord;
  correctionPending?: OrchestrationCorrectionPendingRecord;
}

export interface OrchestrationGroupRecord {
  groupId: string;
  coordinatorSession: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  coordinatorInjectedAt?: string;
  injectionPending?: boolean;
  injectionAppliedAt?: string;
  lastInjectionError?: string;
}

export interface OrchestrationGroupSummary {
  group: OrchestrationGroupRecord;
  tasks: OrchestrationTaskRecord[];
  totalTasks: number;
  pendingApprovalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  terminal: boolean;
}

export interface WorkerBindingRecord {
  sourceHandle: string;
  coordinatorSession: string;
  workspace: string;
  targetAgent: string;
  role?: string;
}

export interface OrchestrationQueuedQuestionRecord {
  taskId: string;
  questionId: string;
  enqueuedAt: string;
}

export interface OrchestrationCoordinatorQuestionStateRecord {
  activePackageId?: string;
  queuedQuestions: OrchestrationQueuedQuestionRecord[];
}

export interface OrchestrationCoordinatorRouteContextRecord {
  coordinatorSession: string;
  chatKey: string;
  accountId?: string;
  replyContextToken?: string;
  updatedAt: string;
}

export interface OrchestrationHumanQuestionPackageMessageRecord {
  messageId: string;
  kind: "initial" | "follow_up";
  promptText: string;
  createdAt: string;
  taskQuestions?: Array<{
    taskId: string;
    questionId: string;
  }>;
  routeChatKey?: string;
  routeAccountId?: string;
  routeReplyContextToken?: string;
  deliveredAt?: string;
  deliveredChatKey?: string;
  deliveryAccountId?: string;
  lastDeliveryError?: string;
}

export interface OrchestrationHumanQuestionPackageRecord {
  packageId: string;
  coordinatorSession: string;
  status: "active" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  initialTaskIds: string[];
  openTaskIds: string[];
  resolvedTaskIds: string[];
  messages: OrchestrationHumanQuestionPackageMessageRecord[];
  awaitingReplyMessageId?: string;
}

export interface OrchestrationState {
  tasks: Record<string, OrchestrationTaskRecord>;
  workerBindings: Record<string, WorkerBindingRecord>;
  groups: Record<string, OrchestrationGroupRecord>;
  humanQuestionPackages: Record<string, OrchestrationHumanQuestionPackageRecord>;
  coordinatorQuestionState: Record<string, OrchestrationCoordinatorQuestionStateRecord>;
  coordinatorRoutes: Record<string, OrchestrationCoordinatorRouteContextRecord>;
}

export function createEmptyOrchestrationState(): OrchestrationState {
  return {
    tasks: {},
    workerBindings: {},
    groups: {},
    humanQuestionPackages: {},
    coordinatorQuestionState: {},
    coordinatorRoutes: {},
  };
}
