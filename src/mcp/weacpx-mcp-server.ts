import { stdin, stdout } from "node:process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetTaskPayloadRequestSchema,
  ListToolsRequestSchema,
  McpError,
  RELATED_TASK_META_KEY,
  type CallToolResult,
  type CreateTaskResult,
  type Root,
  type Task,
  type Result,
} from "@modelcontextprotocol/sdk/types.js";
import type { CreateTaskOptions, TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodError } from "zod";

import { readVersion } from "../version.js";
import type { OrchestrationIpcEndpoint } from "../orchestration/orchestration-ipc";
import type { OrchestrationTaskRecord } from "../orchestration/orchestration-types";
import { resolveDefaultOrchestrationEndpoint } from "./resolve-endpoint";
import { buildWeacpxMcpToolRegistry } from "./weacpx-mcp-tools";
import { createOrchestrationTransport, type WeacpxMcpTransport } from "./weacpx-mcp-transport";

const TASK_OPTIONS_CACHE_LIMIT = 1_000;
const TASKS_LIST_PAGE_SIZE = 100;

export interface WeacpxMcpServerOptions {
  transport?: WeacpxMcpTransport;
  coordinatorSession?: string;
  sourceHandle?: string;
  isExternalCoordinator?: boolean;
  resolveIdentity?: (context: WeacpxMcpIdentityResolutionContext) => Promise<WeacpxMcpIdentity>;
  availableAgents?: string[];
}

export interface WeacpxMcpIdentity {
  coordinatorSession: string;
  sourceHandle?: string;
  // True when the coordinator session is registered as an external coordinator
  // (typical for MCP clients like Claude Code / Codex / OpenCode). External
  // coordinators cannot route through human-input packages, so those tools are
  // filtered out of the registry to avoid advertising calls that always throw.
  isExternalCoordinator?: boolean;
}

export interface WeacpxMcpIdentityResolutionContext {
  clientName?: string;
  listRoots: () => Promise<Root[]>;
}

export const WEACPX_MCP_SERVER_INSTRUCTIONS = [
  "Use these tools to orchestrate work across other agents under your coordinator session.",
  "",
  "Typical lifecycle for a single delegation:",
  "Preferred MCP Tasks lifecycle (for clients that support task-augmented tools/call):",
  "1. Call delegate_request with task execution requested. It returns a native MCP task handle immediately.",
  "2. Use tasks/get or tasks/list to poll status; use tasks/result after terminal status, or on input_required to receive an actionable next-step package; use tasks/cancel to cancel.",
  "   - When tasks/result returns input_required, that result stream is complete. Call the recommended tool, then resume polling with tasks/get / tasks/result.",
  "3. Status mapping: working = running, input_required = needs_confirmation / blocked / waiting_for_human / contested review, completed / failed / cancelled are terminal.",
  "",
  "Legacy tool lifecycle for clients without MCP Tasks support:",
  "1. delegate_request → returns { taskId, status }.",
  "   - status=running: the worker has started; go to step 2.",
  "   - status=needs_confirmation: tell the user, then call task_approve or task_reject based on their response. After task_approve, return to step 2 to wait for the worker. Do not call task_wait before approval.",
  "2. task_wait(taskId) → blocks until the task is done, needs attention, or times out.",
  "   - status=terminal: go to step 3.",
  "   - status=attention_required: the task is in needs_confirmation / blocked / waiting_for_human, or has reviewPending set. Call task_get(taskId) to read the actual status and any openQuestion / reviewPending fields, then branch:",
  "       * needs_confirmation -> task_approve or task_reject (after approval, go back to step 2)",
  "       * blocked or waiting_for_human -> coordinator_answer_question (the answer can come from you or be relayed from a human you consulted)",
  "       * reviewPending set -> coordinator_review_contested_result with accept or discard",
  "     After resolving, call task_wait again to keep waiting.",
  "   - status=timeout: the task is still running. Call task_wait again to keep waiting, or task_get for a snapshot.",
  "3. The task is terminal. Call task_get(taskId) to read the worker's final result, then summarize it for the user. Do not invent results that did not come from task_get.",
  "",
  "Batching: use group_new before a wave of delegate_request calls and pass groupId on each, then group_get / group_list / group_cancel to manage the batch.",
  "Cancellation: task_cancel aborts a single running task; group_cancel aborts the whole batch.",
  "Discovery: task_list / group_list recover taskIds and groupIds from earlier in the session.",
  "",
  "worker_raise_question is worker-side only — call it from inside a delegated task when you are blocked, not from the coordinator that is waiting on a delegation.",
].join("\n");

export function createWeacpxMcpServer(options: WeacpxMcpServerOptions): Server {
  let getToolState!: () => Promise<ReturnType<typeof buildToolState>>;
  const taskOptionsById = new Map<string, CreateTaskOptions>();
  const server = new Server(
    {
      name: "weacpx-orchestration",
      version: readVersion(),
    },
    {
      capabilities: {
        tools: {},
        tasks: {
          list: {},
          cancel: {},
          requests: { tools: { call: {} } },
        },
      },
      instructions: WEACPX_MCP_SERVER_INSTRUCTIONS,
      taskStore: createWeacpxTaskStore(async () => await getToolState(), taskOptionsById),
    },
  );

  let toolState: ReturnType<typeof buildToolState> | null = null;
  let toolStatePromise: Promise<ReturnType<typeof buildToolState>> | null = null;
  getToolState = async function getToolState() {
    if (toolState) {
      return toolState;
    }
    if (toolStatePromise) {
      return await toolStatePromise;
    }
    toolStatePromise = resolveMcpIdentity(server, options)
      .then((identity) => {
        if (!options.transport) {
          throw new Error("weacpx MCP transport is not configured");
        }
        toolState = buildToolState({
          transport: options.transport,
          coordinatorSession: identity.coordinatorSession,
          ...(identity.sourceHandle ? { sourceHandle: identity.sourceHandle } : {}),
          ...(identity.isExternalCoordinator ? { isExternalCoordinator: true } : {}),
          ...(options.availableAgents ? { availableAgents: options.availableAgents } : {}),
        });
        return toolState;
      })
      .finally(() => {
        toolStatePromise = null;
      });
    return await toolStatePromise;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = (await getToolState()).tools;
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: normalizeInputSchemaJson(zodToJsonSchema(tool.inputSchema)),
        ...(tool.execution ? { execution: tool.execution } : {}),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult | CreateTaskResult> => {
    const toolMap = (await getToolState()).toolMap;
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }

    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(ErrorCode.InvalidParams, formatZodError(parsed.error));
    }

    if (request.params.task) {
      if (tool.name !== "delegate_request") {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool ${tool.name} does not support MCP task execution`,
        );
      }
      return await createDelegationMcpTask({
        state: await getToolState(),
        args: parsed.data,
        taskParams: request.params.task,
        taskOptionsById,
      });
    }

    return await tool.handler(parsed.data);
  });

  // The SDK's default tasks/result handler waits until a task is terminal.
  // weacpx also uses input_required for external approval/blocker workflows,
  // where the coordinator must call another tool before the task can continue.
  // Return an actionable package immediately for input_required so task-aware
  // clients do not deadlock waiting for a result that depends on their action.
  server.setRequestHandler(GetTaskPayloadRequestSchema, async (request): Promise<Result> => {
    const state = await getToolState();
    const task = await state.transport.getTask({
      coordinatorSession: state.coordinatorSession,
      taskId: request.params.taskId,
    });
    if (!task) {
      throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
    }
    return withRelatedTaskMeta(renderNativeTaskPayloadResult(task), task.taskId);
  });

  return server;
}

function buildToolState(options: {
  transport: WeacpxMcpTransport;
  coordinatorSession: string;
  sourceHandle?: string;
  isExternalCoordinator?: boolean;
  availableAgents?: string[];
}) {
  const tools = buildWeacpxMcpToolRegistry(options);
  return {
    tools,
    toolMap: new Map(tools.map((tool) => [tool.name, tool])),
    transport: options.transport,
    coordinatorSession: options.coordinatorSession,
    sourceHandle: options.sourceHandle,
  };
}

async function createDelegationMcpTask(input: {
  state: ReturnType<typeof buildToolState>;
  args: unknown;
  taskParams: CreateTaskOptions;
  taskOptionsById: Map<string, CreateTaskOptions>;
}): Promise<CreateTaskResult> {
  const delegateTool = input.state.toolMap.get("delegate_request");
  if (!delegateTool) {
    throw new McpError(ErrorCode.MethodNotFound, "delegate_request is not registered");
  }

  const result = await delegateTool.handler(input.args);
  if (result.isError) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      result.content.map((item) => item.type === "text" ? item.text : "").filter(Boolean).join("\n") || "Delegation failed",
    );
  }

  const structured = result.structuredContent as { taskId?: unknown } | undefined;
  const taskId = typeof structured?.taskId === "string" ? structured.taskId : undefined;
  if (!taskId) {
    throw new McpError(ErrorCode.InternalError, "delegate_request did not return a taskId");
  }
  rememberTaskOptions(input.taskOptionsById, taskId, input.taskParams);

  const task = await input.state.transport.getTask({
    coordinatorSession: input.state.coordinatorSession,
    taskId,
  });

  if (!task) {
    throw new McpError(
      ErrorCode.InternalError,
      `delegate_request created task "${taskId}" but it was not readable from orchestration state`,
    );
  }

  return {
    task: toMcpTask(task, input.taskParams),
  };
}

function createWeacpxTaskStore(
  resolveState: () => Promise<ReturnType<typeof buildToolState>>,
  taskOptionsById: Map<string, CreateTaskOptions>,
): TaskStore {
  return {
    createTask: async () => {
      throw new Error("weacpx native MCP tasks are created by delegate_request");
    },
    getTask: async (taskId) => {
      const state = await resolveState();
      const task = await state.transport.getTask({ coordinatorSession: state.coordinatorSession, taskId });
      return task ? toMcpTask(task, taskOptionsById.get(taskId)) : null;
    },
    storeTaskResult: async () => {
      throw new Error("weacpx native MCP task results are stored by orchestration");
    },
    getTaskResult: async (taskId) => {
      const state = await resolveState();
      const task = await state.transport.getTask({ coordinatorSession: state.coordinatorSession, taskId });
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      return renderNativeTaskPayloadResult(task);
    },
    updateTaskStatus: async (taskId, status, statusMessage) => {
      const state = await resolveState();
      if (status === "cancelled") {
        await state.transport.cancelTask({ coordinatorSession: state.coordinatorSession, taskId });
        return;
      }
      throw new Error(`weacpx MCP task status is read-only (${status}${statusMessage ? `: ${statusMessage}` : ""})`);
    },
    listTasks: async (cursor) => {
      const state = await resolveState();
      const tasks = await state.transport.listTasks({
        coordinatorSession: state.coordinatorSession,
        sort: "updatedAt",
        order: "desc",
      });
      pruneTaskOptions(taskOptionsById, new Set(tasks.map((task) => task.taskId)));
      const offset = parseTaskListCursor(cursor);
      const page = tasks.slice(offset, offset + TASKS_LIST_PAGE_SIZE);
      const nextOffset = offset + page.length;
      return {
        tasks: page.map((task) => toMcpTask(task, taskOptionsById.get(task.taskId))),
        ...(nextOffset < tasks.length ? { nextCursor: String(nextOffset) } : {}),
      };
    },
  };
}

function rememberTaskOptions(
  taskOptionsById: Map<string, CreateTaskOptions>,
  taskId: string,
  options: CreateTaskOptions,
): void {
  taskOptionsById.set(taskId, normalizeCreateTaskOptions(options));
  while (taskOptionsById.size > TASK_OPTIONS_CACHE_LIMIT) {
    const oldestKey = taskOptionsById.keys().next().value;
    if (oldestKey === undefined) break;
    taskOptionsById.delete(oldestKey);
  }
}

function pruneTaskOptions(taskOptionsById: Map<string, CreateTaskOptions>, taskIds: Set<string>): void {
  for (const taskId of taskOptionsById.keys()) {
    if (!taskIds.has(taskId)) {
      taskOptionsById.delete(taskId);
    }
  }
}

function parseTaskListCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid tasks/list cursor: ${cursor}`);
  }
  return offset;
}

function renderNativeTaskPayloadResult(task: OrchestrationTaskRecord): Result {
  if (toMcpTaskStatus(task) === "input_required") {
    return renderInputRequiredTaskResult(task);
  }
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return renderNativeTaskResult(task);
  }
  throw new McpError(
    ErrorCode.InvalidRequest,
    `Task ${task.taskId} is still ${task.status}; use tasks/get until it is terminal or input_required`,
  );
}

function withRelatedTaskMeta(result: Result, taskId: string): Result {
  return {
    ...result,
    _meta: {
      ...result._meta,
      [RELATED_TASK_META_KEY]: { taskId },
    },
  };
}

function renderNativeTaskResult(task: OrchestrationTaskRecord): Result {
  const isError = task.status === "failed" || task.status === "cancelled";
  const text = [
    `Task "${task.taskId}" finished with status ${task.status}.`,
    task.resultText.trim().length > 0 ? task.resultText : task.summary,
  ].filter((line) => line.trim().length > 0).join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: { task },
    ...(isError ? { isError: true } : {}),
  } as CallToolResult;
}

function renderInputRequiredTaskResult(task: OrchestrationTaskRecord): Result {
  const actions = inputRequiredActions(task);
  const text = [
    `Task "${task.taskId}" requires input before it can continue.`,
    task.summary.trim().length > 0 ? task.summary : "",
    task.openQuestion ? `Open question: ${task.openQuestion.question}` : "",
    `Next: call task_get("${task.taskId}") to inspect details, then ${actions.join(" or ")}.`,
  ].filter((line) => line.trim().length > 0).join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      task,
      nextAction: {
        kind: "input_required",
        taskId: task.taskId,
        recommendedTools: actions,
      },
    },
  } as CallToolResult;
}

function inputRequiredActions(task: OrchestrationTaskRecord): string[] {
  const actions: string[] = [];
  if (task.status === "needs_confirmation") {
    actions.push("task_approve", "task_reject");
  }
  if (task.status === "blocked" || task.status === "waiting_for_human" || task.openQuestion) {
    actions.push("coordinator_answer_question");
  }
  if (task.reviewPending) {
    actions.push("coordinator_review_contested_result");
  }
  return actions.length > 0 ? actions : ["task_get"];
}

function toMcpTask(
  task: Pick<OrchestrationTaskRecord, "taskId" | "status" | "createdAt" | "updatedAt" | "summary"> & Partial<Pick<OrchestrationTaskRecord, "lastProgressAt" | "lastProgressSummary" | "reviewPending">>,
  options: CreateTaskOptions = {},
): Task {
  const statusMessage = mcpTaskStatusMessage(task);
  return {
    taskId: task.taskId,
    status: toMcpTaskStatus(task),
    ttl: options.ttl ?? null,
    createdAt: task.createdAt,
    lastUpdatedAt: task.updatedAt,
    ...(options.pollInterval !== undefined ? { pollInterval: options.pollInterval } : {}),
    ...(statusMessage ? { statusMessage } : {}),
  };
}

function mcpTaskStatusMessage(
  task: Pick<OrchestrationTaskRecord, "summary"> & Partial<Pick<OrchestrationTaskRecord, "lastProgressAt" | "lastProgressSummary">>,
): string | undefined {
  const lines = [
    task.summary.trim().length > 0 ? task.summary : "",
    task.lastProgressSummary ? `Latest progress: ${task.lastProgressSummary}` : "",
    task.lastProgressAt ? `Last progress at: ${task.lastProgressAt}` : "",
  ].filter((line) => line.trim().length > 0);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function toMcpTaskStatus(
  task: Pick<OrchestrationTaskRecord, "status"> & Partial<Pick<OrchestrationTaskRecord, "reviewPending">>,
): Task["status"] {
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failed";
  if (task.status === "cancelled") return "cancelled";
  if (
    task.status === "needs_confirmation"
    || task.status === "blocked"
    || task.status === "waiting_for_human"
    || task.reviewPending !== undefined
  ) {
    return "input_required";
  }
  return "working";
}

function normalizeCreateTaskOptions(options: CreateTaskOptions): CreateTaskOptions {
  return {
    ttl: options.ttl ?? null,
    ...(options.pollInterval !== undefined ? { pollInterval: options.pollInterval } : {}),
  };
}

async function resolveMcpIdentity(server: Server, options: WeacpxMcpServerOptions): Promise<WeacpxMcpIdentity> {
  if (options.resolveIdentity) {
    return await options.resolveIdentity({
      clientName: server.getClientVersion()?.name,
      listRoots: async () => (await server.listRoots()).roots,
    });
  }
  if (options.coordinatorSession) {
    return {
      coordinatorSession: options.coordinatorSession,
      ...(options.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
      ...(options.isExternalCoordinator ? { isExternalCoordinator: true } : {}),
    };
  }
  throw new McpError(
    ErrorCode.InvalidRequest,
    "weacpx MCP identity is not configured; run through `weacpx mcp-stdio` or provide --coordinator-session",
  );
}

interface McpShutdownEventSource {
  on(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
  off(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
}

type McpShutdownSignalSource = Pick<NodeJS.Process, "on" | "off">;

type McpIntervalHandle = ReturnType<typeof setInterval>;

export interface McpStdioShutdownHookOptions {
  stdin: McpShutdownEventSource;
  stdout: McpShutdownEventSource;
  shutdown: () => void | Promise<void>;
  platform?: NodeJS.Platform;
  parentPid?: number;
  parentCheckIntervalMs?: number;
  signalSource?: McpShutdownSignalSource;
  isProcessRunning?: (pid: number) => boolean;
  setIntervalFn?: (callback: () => void, ms: number) => McpIntervalHandle;
  clearIntervalFn?: (handle: McpIntervalHandle) => void;
  onDiagnostic?: (event: string, context?: Record<string, unknown>) => void;
}

export function installMcpStdioShutdownHooks(options: McpStdioShutdownHookOptions): () => void {
  const platform = options.platform ?? process.platform;
  const signalSource = options.signalSource ?? process;
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const setIntervalFn = options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));
  const parentPid = options.parentPid ?? process.ppid;
  const parentCheckIntervalMs = options.parentCheckIntervalMs ?? parseParentCheckIntervalMs(process.env.WEACPX_MCP_PARENT_CHECK_INTERVAL_MS);

  let disposed = false;
  let triggered = false;
  const triggerShutdown = (reason: string, context?: Record<string, unknown>) => {
    if (disposed || triggered) return;
    // Mark triggered (not disposed) before dispatching so concurrent events
    // (stdin.close + stdout.error in the same tick, redundant signal handlers)
    // don't each re-enter and produce duplicate diagnostics. runWeacpxMcpServer
    // protects shutdown() itself via shuttingDown; this flag owns the
    // diagnostic stream only and leaves the cleanup function free to release
    // listeners and the parent timer.
    triggered = true;
    options.onDiagnostic?.("mcp.stdio.shutdown", { reason, ...(context ?? {}) });
    void options.shutdown();
  };
  const onStreamEnd = () => triggerShutdown("stdin.end");
  const onStreamClose = () => triggerShutdown("stdin.close");
  const onStdinError = (error: unknown) => triggerShutdown("stdin.error", errorContext(error));
  const onStdoutError = (error: unknown) => triggerShutdown("stdout.error", errorContext(error));
  const onSignal = (signal: NodeJS.Signals) => triggerShutdown("signal", { signal });

  options.stdin.on("end", onStreamEnd);
  options.stdin.on("close", onStreamClose);
  options.stdin.on("error", onStdinError);
  options.stdout.on("error", onStdoutError);

  const signals: NodeJS.Signals[] = platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const signalListeners = signals.map((signal) => ({ signal, listener: () => onSignal(signal) }));
  for (const { signal, listener } of signalListeners) {
    signalSource.on(signal, listener);
  }

  let parentTimer: McpIntervalHandle | undefined;
  if (parentPid > 1 && parentCheckIntervalMs > 0) {
    parentTimer = setIntervalFn(() => {
      if (!isProcessRunning(parentPid)) {
        triggerShutdown("parent_dead", { parentPid });
      }
    }, parentCheckIntervalMs);
    parentTimer.unref?.();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    options.stdin.off("end", onStreamEnd);
    options.stdin.off("close", onStreamClose);
    options.stdin.off("error", onStdinError);
    options.stdout.off("error", onStdoutError);
    for (const { signal, listener } of signalListeners) {
      signalSource.off(signal, listener);
    }
    if (parentTimer) {
      clearIntervalFn(parentTimer);
    }
  };
}

function parseParentCheckIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) return 5_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

function errorContext(error: unknown): Record<string, unknown> {
  const record = error as { code?: unknown; message?: unknown } | undefined;
  return {
    ...(typeof record?.code === "string" ? { code: record.code } : {}),
    ...(typeof record?.message === "string" ? { message: record.message } : {}),
  };
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | undefined)?.code;
    return code !== "ESRCH";
  }
}

export async function runWeacpxMcpServer(options: {
  endpoint?: OrchestrationIpcEndpoint;
  transport?: WeacpxMcpTransport;
  coordinatorSession?: string;
  sourceHandle?: string;
  resolveIdentity?: WeacpxMcpServerOptions["resolveIdentity"];
  availableAgents?: string[];
  onDiagnostic?: (event: string, context?: Record<string, unknown>) => void;
}): Promise<void> {
  const transport = options.transport ?? createOrchestrationTransport(
    options.endpoint ?? resolveDefaultOrchestrationEndpoint(process.env, process.platform),
  );
  const server = createWeacpxMcpServer({
    transport,
    ...(options.coordinatorSession ? { coordinatorSession: options.coordinatorSession } : {}),
    ...(options.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
    ...(options.resolveIdentity ? { resolveIdentity: options.resolveIdentity } : {}),
    ...(options.availableAgents ? { availableAgents: options.availableAgents } : {}),
  });
  const stdio = new StdioServerTransport(stdin, stdout);

  let cleanupShutdownHooks: (() => void) | undefined;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanupShutdownHooks?.();
    options.onDiagnostic?.("mcp.stdio.stopping");
    // Force-exit fallback: if server.close() / stdio.close() hangs (e.g. an
    // orphaned RPC waiting on a wedged daemon), bail after 3s so the parent
    // process never sees a lingering child.
    const forceExit = setTimeout(() => process.exit(0), 3000);
    forceExit.unref();
    try {
      await server.close();
      await stdio.close();
    } catch {
      // ignore errors during shutdown
    }
    clearTimeout(forceExit);
    options.onDiagnostic?.("mcp.stdio.stopped");
    process.exit(0);
  };

  options.onDiagnostic?.("mcp.stdio.start", { parentPid: process.ppid, platform: process.platform });
  cleanupShutdownHooks = installMcpStdioShutdownHooks({
    stdin,
    stdout,
    shutdown,
    onDiagnostic: options.onDiagnostic,
  });

  await server.connect(stdio);
}

function normalizeInputSchemaJson(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...schema };
  delete normalized.$schema;
  return normalized;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "arguments";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
