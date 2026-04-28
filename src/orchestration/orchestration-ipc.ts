import { createHash } from "node:crypto";
import { join } from "node:path";

import type {
  CancelGroupResult,
  CancelTaskInput,
  CoordinatorFollowUpHumanPackageResult,
  CoordinatorRequestHumanInputResult,
  CoordinatorTaskQuestionRef,
  OrchestrationTaskFilter,
  RecordWorkerReplyInput,
  RequestDelegateRpcInput,
  RequestDelegateRpcResult,
  WorkerRaiseQuestionInput,
} from "./orchestration-service";
import type {
  OrchestrationGroupRecord,
  OrchestrationGroupSummary,
  OrchestrationTaskRecord,
} from "./orchestration-types";

export type OrchestrationRpcMethod =
  | "delegate.request"
  | "task.get"
  | "task.list"
  | "task.approve"
  | "task.reject"
  | "task.cancel"
  | "worker.reply"
  | "worker.raise_question"
  | "coordinator.answer_question"
  | "coordinator.retract_answer"
  | "coordinator.request_human_input"
  | "coordinator.follow_up_human_package"
  | "coordinator.review_contested_result"
  | "group.new"
  | "group.get"
  | "group.list"
  | "group.cancel";

export interface OrchestrationIpcEndpoint {
  kind: "unix" | "named-pipe";
  path: string;
}

export interface OrchestrationRpcRequest {
  id: string;
  method: OrchestrationRpcMethod;
  params: Record<string, unknown>;
}

export interface OrchestrationRpcSuccessResponse<Result = unknown> {
  id: string;
  ok: true;
  result: Result;
}

export interface OrchestrationRpcErrorResponse {
  id: string;
  ok: false;
  error: {
    code: "ORCHESTRATION_INVALID_REQUEST" | "ORCHESTRATION_INTERNAL_ERROR";
    message: string;
  };
}

export type OrchestrationRpcResponse<Result = unknown> =
  | OrchestrationRpcSuccessResponse<Result>
  | OrchestrationRpcErrorResponse;

export interface OrchestrationRpcHandlers {
  requestDelegate: (input: RequestDelegateRpcInput) => Promise<RequestDelegateRpcResult>;
  getTask: (taskId: string) => Promise<OrchestrationTaskRecord | null>;
  listTasks: (filter?: OrchestrationTaskFilter) => Promise<OrchestrationTaskRecord[]>;
  approveTask: (input: { taskId: string; coordinatorSession: string }) => Promise<OrchestrationTaskRecord>;
  rejectTask: (input: { taskId: string; coordinatorSession: string }) => Promise<OrchestrationTaskRecord>;
  cancelTask: (input: CancelTaskInput) => Promise<OrchestrationTaskRecord>;
  recordWorkerReply: (input: RecordWorkerReplyInput) => Promise<OrchestrationTaskRecord>;
  workerRaiseQuestion: (
    input: WorkerRaiseQuestionInput,
  ) => Promise<{ taskId: string; questionId: string; status: "blocked" }>;
  coordinatorAnswerQuestion: (input: {
    coordinatorSession: string;
    taskId: string;
    questionId: string;
    answer: string;
  }) => Promise<OrchestrationTaskRecord>;
  coordinatorRequestHumanInput: (input: {
    coordinatorSession: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
    expectedActivePackageId?: string;
  }) => Promise<CoordinatorRequestHumanInputResult>;
  coordinatorFollowUpHumanPackage: (input: {
    coordinatorSession: string;
    packageId: string;
    priorMessageId: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
  }) => Promise<CoordinatorFollowUpHumanPackageResult>;
  coordinatorReviewContestedResult: (input: {
    coordinatorSession: string;
    taskId: string;
    reviewId: string;
    decision: "accept" | "discard";
  }) => Promise<OrchestrationTaskRecord>;
  createGroup: (input: { coordinatorSession: string; title: string }) => Promise<OrchestrationGroupRecord>;
  getGroupSummary: (input: { coordinatorSession: string; groupId: string }) => Promise<OrchestrationGroupSummary | null>;
  listGroupSummaries: (input: {
    coordinatorSession: string;
    status?: "pending" | "running" | "terminal";
    stuck?: boolean;
    sort?: "updatedAt" | "createdAt";
    order?: "asc" | "desc";
  }) => Promise<OrchestrationGroupSummary[]>;
  cancelGroup: (input: { coordinatorSession: string; groupId: string }) => Promise<CancelGroupResult>;
}

export function resolveOrchestrationEndpoint(
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
): OrchestrationIpcEndpoint {
  if (platform === "win32") {
    const suffix = createHash("sha256").update(runtimeDir).digest("hex").slice(0, 12);
    return {
      kind: "named-pipe",
      path: `\\\\.\\pipe\\weacpx-orchestration-${suffix}`,
    };
  }

  return {
    kind: "unix",
    path: join(runtimeDir, "orchestration.sock"),
  };
}

export function createOrchestrationEndpoint(
  path: string,
  platform: NodeJS.Platform = process.platform,
): OrchestrationIpcEndpoint {
  return {
    kind: platform === "win32" || path.startsWith("\\\\.\\pipe\\") ? "named-pipe" : "unix",
    path,
  };
}

export function encodeOrchestrationRpcRequest(request: OrchestrationRpcRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function encodeOrchestrationRpcResponse(response: OrchestrationRpcResponse): string {
  return `${JSON.stringify(response)}\n`;
}
