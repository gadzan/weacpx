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
  transport: WeacpxMcpTransport;
  coordinatorSession?: string;
  sourceHandle?: string;
  resolveIdentity?: (context: WeacpxMcpIdentityResolutionContext) => Promise<WeacpxMcpIdentity>;
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
        toolState = buildToolState({
          transport: options.transport,
          coordinatorSession: identity.coordinatorSession,
          ...(identity.sourceHandle ? { sourceHandle: identity.sourceHandle } : {}),
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

function buildToolState(options: WeacpxMcpServerOptions & { coordinatorSession: string }) {
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

export async function runWeacpxMcpServer(options: {
  endpoint?: OrchestrationIpcEndpoint;
  coordinatorSession?: string;
  sourceHandle?: string;
  resolveIdentity?: WeacpxMcpServerOptions["resolveIdentity"];
}): Promise<void> {
  const transport = createOrchestrationTransport(
    options.endpoint ?? resolveDefaultOrchestrationEndpoint(process.env, process.platform),
  );
  const server = createWeacpxMcpServer({
    transport,
    ...(options.coordinatorSession ? { coordinatorSession: options.coordinatorSession } : {}),
    ...(options.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
    ...(options.resolveIdentity ? { resolveIdentity: options.resolveIdentity } : {}),
  });
  const stdio = new StdioServerTransport(stdin, stdout);
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
