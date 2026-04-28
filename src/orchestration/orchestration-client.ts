import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import {
  encodeOrchestrationRpcRequest,
  type OrchestrationIpcEndpoint,
  type OrchestrationRpcMethod,
  type OrchestrationRpcResponse,
} from "./orchestration-ipc";
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

interface OrchestrationClientDeps {
  createId?: () => string;
  timeoutMs?: number;
}

export class OrchestrationClient {
  private readonly createId: () => string;
  private readonly timeoutMs: number;

  constructor(
    private readonly endpoint: OrchestrationIpcEndpoint,
    deps: OrchestrationClientDeps = {},
  ) {
    this.createId = deps.createId ?? (() => randomUUID());
    this.timeoutMs = deps.timeoutMs ?? 30_000;
  }

  async delegateRequest(input: RequestDelegateRpcInput): Promise<RequestDelegateRpcResult> {
    return await this.request<RequestDelegateRpcResult>("delegate.request", input);
  }

  async getTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    return await this.request<OrchestrationTaskRecord | null>("task.get", { taskId });
  }

  async getTaskForCoordinator(input: {
    coordinatorSession: string;
    taskId: string;
  }): Promise<OrchestrationTaskRecord | null> {
    return await this.request<OrchestrationTaskRecord | null>(
      "task.get",
      input,
    );
  }

  async listTasks(filter?: OrchestrationTaskFilter): Promise<OrchestrationTaskRecord[]> {
    return await this.request<OrchestrationTaskRecord[]>("task.list", filter ? { filter } : {});
  }

  async approveTask(input: {
    coordinatorSession: string;
    taskId: string;
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "task.approve",
      input,
    );
  }

  async rejectTask(input: {
    coordinatorSession: string;
    taskId: string;
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "task.reject",
      input,
    );
  }

  async cancelTask(input: CancelTaskInput): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>("task.cancel", input);
  }

  async cancelTaskForCoordinator(input: {
    coordinatorSession: string;
    taskId: string;
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "task.cancel",
      input,
    );
  }

  async workerReply(input: RecordWorkerReplyInput): Promise<{ accepted: true }> {
    return await this.request<{ accepted: true }>("worker.reply", input);
  }

  async workerRaiseQuestion(
    input: WorkerRaiseQuestionInput,
  ): Promise<{ taskId: string; questionId: string; status: "blocked" }> {
    return await this.request<{ taskId: string; questionId: string; status: "blocked" }>(
      "worker.raise_question",
      input,
    );
  }

  async coordinatorAnswerQuestion(input: {
    coordinatorSession: string;
    taskId: string;
    questionId: string;
    answer: string;
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "coordinator.answer_question",
      input,
    );
  }

  async coordinatorRetractAnswer(input: {
    coordinatorSession: string;
    taskId: string;
    questionId: string;
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "coordinator.retract_answer",
      input,
    );
  }

  async coordinatorRequestHumanInput(input: {
    coordinatorSession: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
    expectedActivePackageId?: string;
  }): Promise<CoordinatorRequestHumanInputResult> {
    return await this.request<CoordinatorRequestHumanInputResult>(
      "coordinator.request_human_input",
      input,
    );
  }

  async coordinatorFollowUpHumanPackage(input: {
    coordinatorSession: string;
    packageId: string;
    priorMessageId: string;
    taskQuestions: CoordinatorTaskQuestionRef[];
    promptText: string;
  }): Promise<CoordinatorFollowUpHumanPackageResult> {
    return await this.request<CoordinatorFollowUpHumanPackageResult>(
      "coordinator.follow_up_human_package",
      input,
    );
  }

  async coordinatorReviewContestedResult(input: {
    coordinatorSession: string;
    taskId: string;
    reviewId: string;
    decision: "accept" | "discard";
  }): Promise<OrchestrationTaskRecord> {
    return await this.request<OrchestrationTaskRecord>(
      "coordinator.review_contested_result",
      input,
    );
  }

  async createGroup(input: { coordinatorSession: string; title: string }): Promise<OrchestrationGroupRecord> {
    return await this.request<OrchestrationGroupRecord>("group.new", input);
  }

  async getGroup(input: {
    coordinatorSession: string;
    groupId: string;
  }): Promise<OrchestrationGroupSummary | null> {
    return await this.request<OrchestrationGroupSummary | null>(
      "group.get",
      input,
    );
  }

  async listGroups(input: {
    coordinatorSession: string;
    status?: "pending" | "running" | "terminal";
    stuck?: boolean;
    sort?: "updatedAt" | "createdAt";
    order?: "asc" | "desc";
  }): Promise<OrchestrationGroupSummary[]> {
    return await this.request<OrchestrationGroupSummary[]>(
      "group.list",
      input,
    );
  }

  async cancelGroup(input: { coordinatorSession: string; groupId: string }): Promise<CancelGroupResult> {
    return await this.request<CancelGroupResult>("group.cancel", input);
  }

  async request<Result>(method: OrchestrationRpcMethod, params: unknown): Promise<Result> {
    const id = this.createId();

    return await new Promise<Result>((resolve, reject) => {
      const socket = createConnection(this.endpoint.path);
      let buffer = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        socket.destroy();
        reject(error);
      };

      timer = setTimeout(() => {
        fail(new Error(`orchestration RPC timeout after ${this.timeoutMs}ms: ${method}`));
      }, this.timeoutMs);

      socket.setEncoding("utf8");
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.write(
          encodeOrchestrationRpcRequest({
            id,
            method,
            params: params as Record<string, unknown>,
          }),
        );
      });
      socket.on("data", (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0 || settled) {
          return;
        }

        const line = buffer.slice(0, newlineIndex);
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        socket.end();

        try {
          const response = JSON.parse(line) as OrchestrationRpcResponse<Result>;
          if (response.id !== id) {
            reject(new Error(`orchestration response id mismatch: expected ${id}, received ${response.id}`));
            return;
          }
          if (!response.ok) {
            reject(new Error(response.error.message));
            return;
          }
          resolve(response.result);
        } catch (error) {
          reject(error);
        }
      });
      socket.once("end", () => {
        if (!settled) {
          fail(new Error("orchestration server closed without a response"));
        }
      });
    });
  }
}
