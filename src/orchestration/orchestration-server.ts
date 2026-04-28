import { rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";

import {
  encodeOrchestrationRpcResponse,
  type OrchestrationIpcEndpoint,
  type OrchestrationRpcHandlers,
  type OrchestrationRpcMethod,
  type OrchestrationRpcRequest,
} from "./orchestration-ipc";
import type {
  CancelTaskInput,
  CoordinatorTaskQuestionRef,
  OrchestrationGroupListFilter,
  OrchestrationTaskFilter,
  RecordWorkerReplyInput,
  RequestDelegateRpcInput,
  WorkerRaiseQuestionInput,
} from "./orchestration-service";

class OrchestrationInvalidRequestError extends Error {}

const ORCHESTRATION_RPC_METHODS = new Set<OrchestrationRpcMethod>([
  "delegate.request",
  "task.get",
  "task.list",
  "task.approve",
  "task.reject",
  "task.cancel",
  "worker.reply",
  "worker.raise_question",
  "coordinator.answer_question",
  "coordinator.request_human_input",
  "coordinator.follow_up_human_package",
  "coordinator.review_contested_result",
  "group.new",
  "group.get",
  "group.list",
  "group.cancel",
]);

interface OrchestrationServerDeps {
  createServer?: typeof createServer;
  removeFile?: (path: string) => Promise<void>;
}

export class OrchestrationServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private started = false;

  constructor(
    readonly endpoint: OrchestrationIpcEndpoint,
    private readonly handlers: OrchestrationRpcHandlers,
    private readonly deps: OrchestrationServerDeps = {},
  ) {}

  async start(): Promise<void> {
    await this.stop();

    if (this.endpoint.kind === "unix" && (await canConnectToEndpoint(this.endpoint.path))) {
      throw new Error(`orchestration endpoint is already in use: ${this.endpoint.path}`);
    }

    const factory = this.deps.createServer ?? createServer;
    this.server = factory((socket) => {
      this.sockets.add(socket);
      socket.setEncoding("utf8");
      let buffer = "";

      socket.on("data", (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            void this.handleSocketLine(socket, line);
          }
          newlineIndex = buffer.indexOf("\n");
        }
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
      });

      socket.on("error", () => {
        this.sockets.delete(socket);
      });
    });

    await this.listenWithUnixSocketRecovery();
    this.started = true;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && !isServerNotRunningError(error)) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (this.started) {
      this.started = false;
      await this.cleanupEndpoint();
    }
  }

  async handleLine(line: string): Promise<string> {
    let requestId = extractRequestId(line);

    try {
      const request = parseRequest(line);
      requestId = request.id;
      const result = await this.dispatch(request.method, request.params);
      return encodeOrchestrationRpcResponse({ id: request.id, ok: true, result });
    } catch (error) {
      return encodeOrchestrationRpcResponse({
        id: requestId,
        ok: false,
        error: {
          code:
            error instanceof OrchestrationInvalidRequestError
              ? "ORCHESTRATION_INVALID_REQUEST"
              : "ORCHESTRATION_INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleSocketLine(socket: Socket, line: string): Promise<void> {
    const response = await this.handleLine(line);
    if (!socket.destroyed) {
      socket.write(response);
    }
  }

  private async dispatch(method: OrchestrationRpcMethod, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "delegate.request":
        return await this.handlers.requestDelegate(params as unknown as RequestDelegateRpcInput);
      case "task.get":
        return await this.dispatchTaskGet(params);
      case "task.list":
        return await this.handlers.listTasks(requireOptionalObject(params, "filter") as OrchestrationTaskFilter | undefined);
      case "task.approve":
        return await this.handlers.approveTask({
          taskId: requireString(params, "taskId"),
          coordinatorSession: requireString(params, "coordinatorSession"),
        });
      case "task.reject":
        return await this.handlers.rejectTask({
          taskId: requireString(params, "taskId"),
          coordinatorSession: requireString(params, "coordinatorSession"),
        });
      // Ownership is validated inside the service layer (requestTaskCancellation
      // checks coordinatorSession) rather than extracted here — the cancel input
      // shape carries its own identity, unlike task.get which uses a dedicated
      // coordinator-scoped wrapper.
      case "task.cancel":
        return await this.handlers.cancelTask(params as unknown as CancelTaskInput);
      case "worker.reply":
        await this.handlers.recordWorkerReply(params as unknown as RecordWorkerReplyInput);
        return { accepted: true };
      case "worker.raise_question":
        return await this.handlers.workerRaiseQuestion(this.parseWorkerRaiseQuestionInput(params));
      case "coordinator.answer_question":
        return await this.handlers.coordinatorAnswerQuestion({
          coordinatorSession: requireString(params, "coordinatorSession"),
          taskId: requireString(params, "taskId"),
          questionId: requireString(params, "questionId"),
          answer: requireString(params, "answer"),
        });
      case "coordinator.request_human_input":
        {
          const expectedActivePackageId = requireOptionalString(params, "expectedActivePackageId");
        return await this.handlers.coordinatorRequestHumanInput({
          coordinatorSession: requireString(params, "coordinatorSession"),
          taskQuestions: requireTaskQuestions(params, "taskQuestions"),
          promptText: requireString(params, "promptText"),
          ...(expectedActivePackageId !== undefined ? { expectedActivePackageId } : {}),
        });
        }
      case "coordinator.follow_up_human_package":
        return await this.handlers.coordinatorFollowUpHumanPackage({
          coordinatorSession: requireString(params, "coordinatorSession"),
          packageId: requireString(params, "packageId"),
          priorMessageId: requireString(params, "priorMessageId"),
          taskQuestions: requireTaskQuestions(params, "taskQuestions"),
          promptText: requireString(params, "promptText"),
        });
      case "coordinator.review_contested_result":
        return await this.handlers.coordinatorReviewContestedResult({
          coordinatorSession: requireString(params, "coordinatorSession"),
          taskId: requireString(params, "taskId"),
          reviewId: requireString(params, "reviewId"),
          decision: requireEnum(params, "decision", ["accept", "discard"]),
        });
      case "group.new":
        return await this.handlers.createGroup({
          coordinatorSession: requireString(params, "coordinatorSession"),
          title: requireString(params, "title"),
        });
      case "group.get":
        return await this.handlers.getGroupSummary({
          coordinatorSession: requireString(params, "coordinatorSession"),
          groupId: requireString(params, "groupId"),
        });
      case "group.list":
        return await this.handlers.listGroupSummaries(this.parseGroupListFilter(params));
      case "group.cancel":
        return await this.handlers.cancelGroup({
          coordinatorSession: requireString(params, "coordinatorSession"),
          groupId: requireString(params, "groupId"),
        });
      default:
        throw new OrchestrationInvalidRequestError(`unsupported orchestration method: ${method}`);
    }
  }

  private async dispatchTaskGet(params: Record<string, unknown>) {
    const taskId = requireString(params, "taskId");
    const coordinatorSession = requireOptionalString(params, "coordinatorSession");
    const task = await this.handlers.getTask(taskId);
    if (!task) {
      return null;
    }
    if (coordinatorSession !== undefined && task.coordinatorSession !== coordinatorSession) {
      return null;
    }
    return task;
  }

  private parseWorkerRaiseQuestionInput(params: Record<string, unknown>): WorkerRaiseQuestionInput {
    return {
      taskId: requireString(params, "taskId"),
      sourceHandle: requireString(params, "sourceHandle"),
      question: requireString(params, "question"),
      whyBlocked: requireString(params, "whyBlocked"),
      whatIsNeeded: requireString(params, "whatIsNeeded"),
    };
  }

  private parseGroupListFilter(params: Record<string, unknown>): OrchestrationGroupListFilter {
    const status = requireOptionalEnum(params, "status", ["pending", "running", "terminal"]);
    const stuck = requireOptionalBoolean(params, "stuck");
    const sort = requireOptionalEnum(params, "sort", ["updatedAt", "createdAt"]);
    const order = requireOptionalEnum(params, "order", ["asc", "desc"]);
    return {
      coordinatorSession: requireString(params, "coordinatorSession"),
      ...(status !== undefined ? { status } : {}),
      ...(stuck !== undefined ? { stuck } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(order !== undefined ? { order } : {}),
    };
  }

  private async cleanupEndpoint(): Promise<void> {
    if (this.endpoint.kind !== "unix") {
      return;
    }

    const removeFile = this.deps.removeFile ?? (async (path: string) => {
      await rm(path, { force: true });
    });
    await removeFile(this.endpoint.path);
  }

  private async listenWithUnixSocketRecovery(): Promise<void> {
    const server = this.server;
    if (!server) {
      throw new Error("orchestration server failed to initialize");
    }

    try {
      await listen(server, this.endpoint.path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (this.endpoint.kind !== "unix" || code !== "EADDRINUSE") {
        throw error;
      }

      const isLive = await canConnectToEndpoint(this.endpoint.path);
      if (isLive) {
        throw new Error(`orchestration endpoint is already in use: ${this.endpoint.path}`);
      }

      await this.cleanupEndpoint();
      await listen(server, this.endpoint.path);
    }
  }
}

function extractRequestId(line: string): string {
  try {
    const raw = JSON.parse(line) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "unknown";
    }

    const id = (raw as Record<string, unknown>).id;
    return typeof id === "string" && id.length > 0 ? id : "unknown";
  } catch {
    return "unknown";
  }
}

function parseRequest(line: string): OrchestrationRpcRequest {
  let raw: unknown;

  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    throw new OrchestrationInvalidRequestError("request must be valid JSON");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrchestrationInvalidRequestError("request must be a JSON object");
  }

  const request = raw as Record<string, unknown>;
  const { id, method, params } = request;

  if (typeof id !== "string" || id.length === 0) {
    throw new OrchestrationInvalidRequestError("id must be a non-empty string");
  }
  if (typeof method !== "string" || !ORCHESTRATION_RPC_METHODS.has(method as OrchestrationRpcMethod)) {
    throw new OrchestrationInvalidRequestError(`unsupported orchestration method: ${String(method)}`);
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new OrchestrationInvalidRequestError("params must be an object");
  }

  return {
    id,
    method: method as OrchestrationRpcMethod,
    params: params as Record<string, unknown>,
  };
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new OrchestrationInvalidRequestError(`${key} must be a non-empty string`);
  }

  return value;
}

function requireOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new OrchestrationInvalidRequestError(`${key} must be a non-empty string`);
  }
  return value;
}

function requireOptionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new OrchestrationInvalidRequestError(`${key} must be a boolean when provided`);
  }
  return value;
}

function requireOptionalEnum<const T extends readonly string[]>(
  params: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new OrchestrationInvalidRequestError(
      `${key} must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T[number];
}

function requireEnum<const T extends readonly string[]>(
  params: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] {
  const value = params[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new OrchestrationInvalidRequestError(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function requireOptionalObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrchestrationInvalidRequestError(`${key} must be an object when provided`);
  }

  return value as Record<string, unknown>;
}

function requireTaskQuestions(
  params: Record<string, unknown>,
  key: string,
): CoordinatorTaskQuestionRef[] {
  const value = params[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new OrchestrationInvalidRequestError(`${key} must be a non-empty array`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OrchestrationInvalidRequestError(`${key}[${index}] must be an object`);
    }

    return {
      taskId: requireString(entry as Record<string, unknown>, "taskId"),
      questionId: requireString(entry as Record<string, unknown>, "questionId"),
    };
  });
}

async function canConnectToEndpoint(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(path);
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ECONNREFUSED") {
        finish(false);
        return;
      }

      finish(true);
    });
  });
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(path);
  });
}

function isServerNotRunningError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}
