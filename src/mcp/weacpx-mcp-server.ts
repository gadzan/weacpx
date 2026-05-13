import { stdin, stdout } from "node:process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodError } from "zod";

import { readVersion } from "../version.js";
import type { OrchestrationIpcEndpoint } from "../orchestration/orchestration-ipc";
import { resolveDefaultOrchestrationEndpoint } from "./resolve-endpoint";
import { buildWeacpxMcpToolRegistry } from "./weacpx-mcp-tools";
import { createOrchestrationTransport, type WeacpxMcpTransport } from "./weacpx-mcp-transport";

export interface WeacpxMcpServerOptions {
  transport?: WeacpxMcpTransport;
  coordinatorSession?: string;
  sourceHandle?: string;
  resolveIdentity?: (context: WeacpxMcpIdentityResolutionContext) => Promise<WeacpxMcpIdentity>;
  availableAgents?: string[];
}

export interface WeacpxMcpIdentity {
  coordinatorSession: string;
  sourceHandle?: string;
}

export interface WeacpxMcpIdentityResolutionContext {
  clientName?: string;
  listRoots: () => Promise<Root[]>;
}

export function createWeacpxMcpServer(options: WeacpxMcpServerOptions): Server {
  const server = new Server(
    {
      name: "weacpx-orchestration",
      version: readVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  let toolState: ReturnType<typeof buildToolState> | null = null;
  let toolStatePromise: Promise<ReturnType<typeof buildToolState>> | null = null;
  async function getToolState() {
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
          ...(options.availableAgents ? { availableAgents: options.availableAgents } : {}),
        });
        return toolState;
      })
      .finally(() => {
        toolStatePromise = null;
      });
    return await toolStatePromise;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = (await getToolState()).tools;
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: normalizeInputSchemaJson(zodToJsonSchema(tool.inputSchema)),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const toolMap = (await getToolState()).toolMap;
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }

    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(ErrorCode.InvalidParams, formatZodError(parsed.error));
    }

    return await tool.handler(parsed.data);
  });

  return server;
}

function buildToolState(options: { transport: WeacpxMcpTransport; coordinatorSession: string; sourceHandle?: string; availableAgents?: string[] }) {
  const tools = buildWeacpxMcpToolRegistry(options);
  return {
    tools,
    toolMap: new Map(tools.map((tool) => [tool.name, tool])),
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
  const triggerShutdown = (reason: string, context?: Record<string, unknown>) => {
    if (disposed) return;
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
