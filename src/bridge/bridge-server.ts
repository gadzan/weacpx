import { type BridgeMethod, type BridgeResponse } from "../transport/acpx-bridge/acpx-bridge-protocol";
import { PromptCommandError } from "../transport/prompt-output";
import { BridgeRuntime } from "./bridge-runtime";

interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export class BridgeServer {
  constructor(private readonly runtime: BridgeRuntime) {}

  async handleLine(line: string): Promise<string> {
    const request = JSON.parse(line) as BridgeRequest;

    try {
      const result = await this.dispatch(request.method, request.params);
      return `${JSON.stringify({
        id: request.id,
        ok: true,
        result,
      } satisfies BridgeResponse)}\n`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${JSON.stringify({
        id: request.id,
        ok: false,
        error: {
          code: "BRIDGE_INTERNAL_ERROR",
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
          agent: String(params.agent),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: String(params.cwd),
          name: String(params.name),
        });
      case "ensureSession":
        return await this.runtime.ensureSession({
          agent: String(params.agent),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: String(params.cwd),
          name: String(params.name),
        });
      case "prompt":
        return await this.runtime.prompt({
          agent: String(params.agent),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: String(params.cwd),
          name: String(params.name),
          text: String(params.text),
        });
      case "cancel":
        return await this.runtime.cancel({
          agent: String(params.agent),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: String(params.cwd),
          name: String(params.name),
        });
      default:
        throw new Error(`unsupported bridge method: ${method}`);
    }
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}
