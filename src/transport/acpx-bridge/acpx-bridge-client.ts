import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import {
  type BridgeMethod,
  type BridgeMessage,
  type BridgeResponse,
  type EnsureSessionProgressStage,
  encodeBridgeRequest,
} from "./acpx-bridge-protocol";
import { PromptCommandError } from "../prompt-output";
import { MissingOptionalDepError } from "../../recovery/errors";
import { terminateProcessTree } from "../../process/terminate-process-tree";
import type { ToolUseEvent } from "../../channels/types.js";
import { getLocale } from "../../i18n";

// `boolean | void` return mirrors Writable.write: `false` only signals
// backpressure (the line is still queued and delivered), never failure.
// Real write failures are reported through the optional callback.
type WriteLine = (line: string, onWriteError?: (error?: Error | null) => void) => boolean | void;

export type BridgeEvent =
  | { type: "prompt.segment"; text: string }
  | { type: "prompt.tool_event"; event: ToolUseEvent }
  | { type: "prompt.thought"; text: string }
  | { type: "session.progress"; stage: EnsureSessionProgressStage }
  | { type: "session.note"; text: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onEvent?: (event: BridgeEvent) => void;
}

export class AcpxBridgeClient {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private terminalError: Error | null = null;

  constructor(private readonly writeLine: WriteLine) {}

  request<TResult>(
    method: BridgeMethod,
    params: Record<string, unknown>,
    onEvent?: (event: BridgeEvent) => void,
  ): Promise<TResult> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }

    const id = String(this.nextId);
    this.nextId += 1;

    return awaitable<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        onEvent,
      });

      try {
        // A `false` return only signals backpressure (the line is still
        // queued and delivered), so it is deliberately ignored here. Only a
        // real write error — reported via the callback — fails the request.
        this.writeLine(
          encodeBridgeRequest({
            id,
            method,
            params,
          }),
          (error) => {
            if (error && this.pending.delete(id)) {
              reject(error);
            }
          },
        );
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleLine(line: string): void {
    let message: BridgeMessage;
    try {
      message = JSON.parse(line) as BridgeMessage;
    } catch {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if ("event" in message) {
      if (message.event === "prompt.segment") {
        pending.onEvent?.({
          type: "prompt.segment",
          text: message.text,
        });
      } else if (message.event === "prompt.tool_event") {
        pending.onEvent?.({
          type: "prompt.tool_event",
          event: message.toolEvent,
        });
      } else if (message.event === "prompt.thought") {
        pending.onEvent?.({
          type: "prompt.thought",
          text: message.text,
        });
      } else if (message.event === "session.progress") {
        pending.onEvent?.({
          type: "session.progress",
          stage: message.stage,
        });
      } else if (message.event === "session.note") {
        pending.onEvent?.({
          type: "session.note",
          text: message.text,
        });
      }
      return;
    }

    const response = message as BridgeResponse;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    if (response.error.kind === "missing_optional_dep" && response.error.data) {
      pending.reject(
        new MissingOptionalDepError({
          package: response.error.data.package,
          parentPackagePath: response.error.data.parentPackagePath,
          rawMessage: response.error.message,
        }),
      );
      return;
    }

    if (response.error.details?.exitCode !== undefined) {
      pending.reject(
        new PromptCommandError(response.error.message, {
          code: response.error.details.exitCode,
          stdout: response.error.details.stdout ?? "",
          stderr: response.error.details.stderr ?? "",
        }),
      );
      return;
    }

    pending.reject(new Error(response.error.message));
  }

  handleExit(error: Error): void {
    this.terminalError = error;
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();

    for (const pending of pendingRequests) {
      pending.reject(error);
    }
  }
}

export interface ManagedBridgeClient extends AcpxBridgeClient {
  waitUntilReady(): Promise<void>;
  dispose(): Promise<void>;
}

interface SpawnedBridgeClientOptions {
  acpxCommand?: string;
  bridgeEntryPath?: string;
  cwd?: string;
  permissionMode?: string;
  nonInteractivePermissions?: string;
  permissionPolicy?: string;
  queueOwnerTtlSeconds?: number;
  sessionInitTimeoutMs?: number;
}

export function buildBridgeSpawnEnv(
  options: SpawnedBridgeClientOptions = {},
): Record<string, string> {
  return {
    XACPX_LANG: getLocale(),
    XACPX_BRIDGE_ACPX_COMMAND: options.acpxCommand ?? "acpx",
    XACPX_BRIDGE_PERMISSION_MODE: options.permissionMode ?? "approve-all",
    XACPX_BRIDGE_NON_INTERACTIVE_PERMISSIONS: options.nonInteractivePermissions ?? "deny",
    ...(typeof options.permissionPolicy === "string" && options.permissionPolicy.trim().length > 0
      ? { XACPX_BRIDGE_PERMISSION_POLICY: options.permissionPolicy }
      : {}),
    ...(typeof options.queueOwnerTtlSeconds === "number" && Number.isFinite(options.queueOwnerTtlSeconds)
      ? { XACPX_BRIDGE_QUEUE_OWNER_TTL_SECONDS: String(options.queueOwnerTtlSeconds) }
      : {}),
    ...(typeof options.sessionInitTimeoutMs === "number"
      && Number.isFinite(options.sessionInitTimeoutMs)
      && options.sessionInitTimeoutMs > 0
      ? { XACPX_BRIDGE_SESSION_INIT_TIMEOUT_MS: String(options.sessionInitTimeoutMs) }
      : {}),
  };
}

export function buildBridgeSpawnSpec(options: {
  execPath: string;
  bridgeEntryPath: string;
}): { command: string; args: string[] } {
  if (options.execPath.endsWith("bun")) {
    return {
      command: options.execPath,
      args: ["run", options.bridgeEntryPath],
    };
  }

  return {
    command: options.execPath,
    args: [options.bridgeEntryPath],
  };
}

export async function spawnAcpxBridgeClient(
  options: SpawnedBridgeClientOptions = {},
): Promise<ManagedBridgeClient> {
  const bridgeEntryPath =
    options.bridgeEntryPath ?? fileURLToPath(new URL("../../bridge/bridge-main.ts", import.meta.url));
  const spawnSpec = buildBridgeSpawnSpec({
    execPath: process.execPath,
    bridgeEntryPath,
  });
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...buildBridgeSpawnEnv(options),
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const client = new AcpxBridgeClient(
    (line, onWriteError) => child.stdin.write(line, onWriteError),
  ) as ManagedBridgeClient;
  const output = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  output.on("line", (line) => {
    client.handleLine(line);
  });

  child.on("exit", () => {
    output.close();
    client.handleExit(new Error("bridge process exited before responding"));
  });
  child.on("error", (error) => {
    client.handleExit(error);
  });

  client.waitUntilReady = async () => {
    await client.request("ping", {});
  };
  client.dispose = async () => {
    try {
      await client.request("shutdown", {});
    } finally {
      child.stdin.end();
      await terminateProcessTree(child.pid ?? 0, { detachedProcessGroup: false });
    }
  };

  await client.waitUntilReady();
  return client;
}

function awaitable<TResult>(
  executor: (resolve: (value: TResult) => void, reject: (error: unknown) => void) => void,
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    executor(resolve, reject);
  });
}
