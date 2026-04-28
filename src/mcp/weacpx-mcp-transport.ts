import { OrchestrationClient } from "../orchestration/orchestration-client";
import type { OrchestrationIpcEndpoint } from "../orchestration/orchestration-ipc";
import type {
  CancelGroupResult,
  CoordinatorFollowUpHumanPackageResult,
  CoordinatorRequestHumanInputResult,
  CoordinatorTaskQuestionRef,
  OrchestrationGroupListFilter,
  OrchestrationTaskFilter,
  RequestDelegateRpcResult,
} from "../orchestration/orchestration-service";
import type {
  OrchestrationGroupRecord,
  OrchestrationGroupSummary,
  OrchestrationTaskRecord,
} from "../orchestration/orchestration-types";

export interface WeacpxMcpDelegateRequest {
  coordinatorSession: string;
  sourceHandle?: string;
  targetAgent: string;
  task: string;
  role?: string;
  groupId?: string;
}

export interface WeacpxMcpTaskIdArgs {
  coordinatorSession: string;
  taskId: string;
}

export interface WeacpxMcpTaskListArgs extends Pick<
  OrchestrationTaskFilter,
  "status" | "stuck" | "sort" | "order"
> {
  coordinatorSession: string;
}

export interface WeacpxMcpGroupIdArgs {
  coordinatorSession: string;
  groupId: string;
}

export interface WeacpxMcpGroupNewArgs {
  coordinatorSession: string;
  title: string;
}

export interface WeacpxMcpGroupListArgs extends Pick<
  OrchestrationGroupListFilter,
  "status" | "stuck" | "sort" | "order"
> {
  coordinatorSession: string;
}

export interface WeacpxMcpTaskQuestionRef extends CoordinatorTaskQuestionRef {}

export interface WeacpxMcpWorkerRaiseQuestionArgs {
  sourceHandle: string;
  taskId: string;
  question: string;
  whyBlocked: string;
  whatIsNeeded: string;
}

export interface WeacpxMcpCoordinatorAnswerQuestionArgs {
  coordinatorSession: string;
  taskId: string;
  questionId: string;
  answer: string;
}

export interface WeacpxMcpCoordinatorRequestHumanInputArgs {
  coordinatorSession: string;
  taskQuestions: WeacpxMcpTaskQuestionRef[];
  promptText: string;
  expectedActivePackageId?: string;
}

export interface WeacpxMcpCoordinatorFollowUpHumanPackageArgs {
  coordinatorSession: string;
  packageId: string;
  priorMessageId: string;
  taskQuestions: WeacpxMcpTaskQuestionRef[];
  promptText: string;
}

export interface WeacpxMcpCoordinatorReviewContestedResultArgs {
  coordinatorSession: string;
  taskId: string;
  reviewId: string;
  decision: "accept" | "discard";
}

export interface WeacpxMcpTransport {
  delegateRequest: (input: WeacpxMcpDelegateRequest) => Promise<RequestDelegateRpcResult>;
  createGroup: (input: WeacpxMcpGroupNewArgs) => Promise<OrchestrationGroupRecord>;
  getGroup: (input: WeacpxMcpGroupIdArgs) => Promise<OrchestrationGroupSummary | null>;
  listGroups: (input: WeacpxMcpGroupListArgs) => Promise<OrchestrationGroupSummary[]>;
  cancelGroup: (input: WeacpxMcpGroupIdArgs) => Promise<CancelGroupResult>;
  getTask: (input: WeacpxMcpTaskIdArgs) => Promise<OrchestrationTaskRecord | null>;
  listTasks: (input: WeacpxMcpTaskListArgs) => Promise<OrchestrationTaskRecord[]>;
  approveTask: (input: WeacpxMcpTaskIdArgs) => Promise<OrchestrationTaskRecord>;
  rejectTask: (input: WeacpxMcpTaskIdArgs) => Promise<OrchestrationTaskRecord>;
  cancelTask: (input: WeacpxMcpTaskIdArgs) => Promise<OrchestrationTaskRecord>;
  workerRaiseQuestion: (
    input: WeacpxMcpWorkerRaiseQuestionArgs,
  ) => Promise<{ taskId: string; questionId: string; status: "blocked" }>;
  coordinatorAnswerQuestion: (
    input: WeacpxMcpCoordinatorAnswerQuestionArgs,
  ) => Promise<OrchestrationTaskRecord>;
  coordinatorRequestHumanInput: (
    input: WeacpxMcpCoordinatorRequestHumanInputArgs,
  ) => Promise<CoordinatorRequestHumanInputResult>;
  coordinatorFollowUpHumanPackage: (
    input: WeacpxMcpCoordinatorFollowUpHumanPackageArgs,
  ) => Promise<CoordinatorFollowUpHumanPackageResult>;
  coordinatorReviewContestedResult: (
    input: WeacpxMcpCoordinatorReviewContestedResultArgs,
  ) => Promise<OrchestrationTaskRecord>;
}

interface OrchestrationClientLike {
  delegateRequest: OrchestrationClient["delegateRequest"];
  createGroup: OrchestrationClient["createGroup"];
  getGroup: OrchestrationClient["getGroup"];
  listGroups: OrchestrationClient["listGroups"];
  cancelGroup: OrchestrationClient["cancelGroup"];
  getTaskForCoordinator: OrchestrationClient["getTaskForCoordinator"];
  listTasks: OrchestrationClient["listTasks"];
  approveTask: OrchestrationClient["approveTask"];
  rejectTask: OrchestrationClient["rejectTask"];
  cancelTaskForCoordinator: OrchestrationClient["cancelTaskForCoordinator"];
  workerRaiseQuestion: OrchestrationClient["workerRaiseQuestion"];
  coordinatorAnswerQuestion: OrchestrationClient["coordinatorAnswerQuestion"];
  coordinatorRequestHumanInput: OrchestrationClient["coordinatorRequestHumanInput"];
  coordinatorFollowUpHumanPackage: OrchestrationClient["coordinatorFollowUpHumanPackage"];
  coordinatorReviewContestedResult: OrchestrationClient["coordinatorReviewContestedResult"];
}

export function createOrchestrationTransport(
  endpoint: OrchestrationIpcEndpoint,
  deps: { client?: OrchestrationClientLike } = {},
): WeacpxMcpTransport {
  const client = deps.client ?? new OrchestrationClient(endpoint);

  return {
    delegateRequest: async (input) =>
      await client.delegateRequest({
        sourceHandle: input.sourceHandle ?? input.coordinatorSession,
        targetAgent: input.targetAgent,
        task: input.task,
        ...(input.role ? { role: input.role } : {}),
        ...(input.groupId ? { groupId: input.groupId } : {}),
      }),
    createGroup: async (input) => await client.createGroup(input),
    getGroup: async (input) => await client.getGroup(input),
    listGroups: async (input) => await client.listGroups(input),
    cancelGroup: async (input) => await client.cancelGroup(input),
    getTask: async (input) => await client.getTaskForCoordinator(input),
    listTasks: async (input) =>
      await client.listTasks({
        coordinatorSession: input.coordinatorSession,
        ...(input.status ? { status: input.status } : {}),
        ...(input.stuck !== undefined ? { stuck: input.stuck } : {}),
        ...(input.sort ? { sort: input.sort } : {}),
        ...(input.order ? { order: input.order } : {}),
      }),
    approveTask: async (input) => await client.approveTask(input),
    rejectTask: async (input) => await client.rejectTask(input),
    cancelTask: async (input) => await client.cancelTaskForCoordinator(input),
    workerRaiseQuestion: async (input) => {
      const sourceHandle = input.sourceHandle.trim();
      if (sourceHandle.length === 0) {
        throw new Error(
          "worker_raise_question requires a bound sourceHandle; start mcp-stdio with --source-handle or WEACPX_SOURCE_HANDLE",
        );
      }
      return await client.workerRaiseQuestion({
        taskId: input.taskId,
        sourceHandle,
        question: input.question,
        whyBlocked: input.whyBlocked,
        whatIsNeeded: input.whatIsNeeded,
      });
    },
    coordinatorAnswerQuestion: async (input) => await client.coordinatorAnswerQuestion(input),
    coordinatorRequestHumanInput: async (input) => await client.coordinatorRequestHumanInput(input),
    coordinatorFollowUpHumanPackage: async (input) => await client.coordinatorFollowUpHumanPackage(input),
    coordinatorReviewContestedResult: async (input) => await client.coordinatorReviewContestedResult(input),
  };
}

export function createMemoryTransport(
  delegateRequest: WeacpxMcpTransport["delegateRequest"],
  overrides: Partial<Omit<WeacpxMcpTransport, "delegateRequest">> = {},
): WeacpxMcpTransport {
  const unimplemented = (name: string) => async () => {
    throw new Error(`memory transport ${name} is not implemented`);
  };

  return {
    delegateRequest: async (input) => await delegateRequest(input),
    createGroup: overrides.createGroup ?? (unimplemented("createGroup") as WeacpxMcpTransport["createGroup"]),
    getGroup: overrides.getGroup ?? (unimplemented("getGroup") as WeacpxMcpTransport["getGroup"]),
    listGroups: overrides.listGroups ?? (unimplemented("listGroups") as WeacpxMcpTransport["listGroups"]),
    cancelGroup: overrides.cancelGroup ?? (unimplemented("cancelGroup") as WeacpxMcpTransport["cancelGroup"]),
    getTask: overrides.getTask ?? (unimplemented("getTask") as WeacpxMcpTransport["getTask"]),
    listTasks: overrides.listTasks ?? (unimplemented("listTasks") as WeacpxMcpTransport["listTasks"]),
    approveTask: overrides.approveTask ?? (unimplemented("approveTask") as WeacpxMcpTransport["approveTask"]),
    rejectTask: overrides.rejectTask ?? (unimplemented("rejectTask") as WeacpxMcpTransport["rejectTask"]),
    cancelTask: overrides.cancelTask ?? (unimplemented("cancelTask") as WeacpxMcpTransport["cancelTask"]),
    workerRaiseQuestion:
      overrides.workerRaiseQuestion ?? (unimplemented("workerRaiseQuestion") as WeacpxMcpTransport["workerRaiseQuestion"]),
    coordinatorAnswerQuestion:
      overrides.coordinatorAnswerQuestion
      ?? (unimplemented("coordinatorAnswerQuestion") as WeacpxMcpTransport["coordinatorAnswerQuestion"]),
    coordinatorRequestHumanInput:
      overrides.coordinatorRequestHumanInput
      ?? (unimplemented("coordinatorRequestHumanInput") as WeacpxMcpTransport["coordinatorRequestHumanInput"]),
    coordinatorFollowUpHumanPackage:
      overrides.coordinatorFollowUpHumanPackage
      ?? (unimplemented("coordinatorFollowUpHumanPackage") as WeacpxMcpTransport["coordinatorFollowUpHumanPackage"]),
    coordinatorReviewContestedResult:
      overrides.coordinatorReviewContestedResult
      ?? (unimplemented("coordinatorReviewContestedResult") as WeacpxMcpTransport["coordinatorReviewContestedResult"]),
  };
}
