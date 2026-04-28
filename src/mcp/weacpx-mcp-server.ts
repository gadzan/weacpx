import { stdin, stdout } from "node:process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
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
  coordinatorSession: string;
  sourceHandle?: string;
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

  const tools = buildWeacpxMcpToolRegistry(options);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalizeInputSchemaJson(zodToJsonSchema(tool.inputSchema)),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
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

export async function runWeacpxMcpServer(options: {
  endpoint?: OrchestrationIpcEndpoint;
  coordinatorSession: string;
  sourceHandle?: string;
}): Promise<void> {
  const transport = createOrchestrationTransport(
    options.endpoint ?? resolveDefaultOrchestrationEndpoint(process.env, process.platform),
  );
  const server = createWeacpxMcpServer({
    transport,
    coordinatorSession: options.coordinatorSession,
    ...(options.sourceHandle ? { sourceHandle: options.sourceHandle } : {}),
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
