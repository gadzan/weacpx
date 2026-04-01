import { type BridgeMethod, type BridgeResponse } from "../transport/acpx-bridge/acpx-bridge-protocol";
import { PromptCommandError } from "../transport/prompt-output";
import { BridgeRuntime } from "./bridge-runtime";

interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

class BridgeInvalidRequestError extends Error {}

const BRIDGE_METHODS = new Set<BridgeMethod>([
  "ping",
  "shutdown",
  "hasSession",
  "ensureSession",
  "prompt",
  "setMode",
  "cancel",
]);

export class BridgeServer {
  constructor(private readonly runtime: BridgeRuntime) {}

  async handleLine(line: string): Promise<string> {
    let requestId = extractRequestId(line);

    try {
      const request = parseBridgeRequest(line);
      requestId = request.id;

      const result = await this.dispatch(request.method, request.params);
      return `${JSON.stringify({
        id: request.id,
        ok: true,
        result,
      } satisfies BridgeResponse)}\n`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${JSON.stringify({
        id: requestId,
        ok: false,
        error: {
          code: error instanceof BridgeInvalidRequestError ? "BRIDGE_INVALID_REQUEST" : "BRIDGE_INTERNAL_ERROR",
          message,
          ...(error instanceof PromptCommandError
            ? {
                details: {
                  exitCode: error.exitCode,
                  stdout: error.stdout,
                  stderr: error.stderr,
                },
              }
            : {}),
        },
      } satisfies BridgeResponse)}\n`;
    }
  }

  private async dispatch(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "ping":
        return {};
      case "shutdown":
        return await this.runtime.shutdown();
      case "hasSession":
        return await this.runtime.hasSession({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
        });
      case "ensureSession":
        return await this.runtime.ensureSession({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
        });
      case "prompt":
        return await this.runtime.prompt({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
          text: requireString(params, "text"),
        });
      case "setMode":
        return await this.runtime.setMode({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
          modeId: requireString(params, "modeId"),
        });
      case "cancel":
        return await this.runtime.cancel({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
        });
      default:
        throw new Error(`unsupported bridge method: ${method}`);
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

function parseBridgeRequest(line: string): BridgeRequest {
  let raw: unknown;

  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    throw new BridgeInvalidRequestError("request must be valid JSON");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BridgeInvalidRequestError("request must be a JSON object");
  }

  const request = raw as Record<string, unknown>;
  const id = request.id;
  const method = request.method;
  const params = request.params;

  if (typeof id !== "string" || id.length === 0) {
    throw new BridgeInvalidRequestError("id must be a non-empty string");
  }
  if (typeof method !== "string" || method.length === 0) {
    throw new BridgeInvalidRequestError("method must be a non-empty string");
  }
  if (!BRIDGE_METHODS.has(method as BridgeMethod)) {
    throw new BridgeInvalidRequestError(`unsupported bridge method: ${method}`);
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new BridgeInvalidRequestError("params must be an object");
  }

  return {
    id,
    method: method as BridgeMethod,
    params: params as Record<string, unknown>,
  };
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeInvalidRequestError(`${key} must be a non-empty string`);
  }

  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}
