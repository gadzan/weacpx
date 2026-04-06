import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import {
  type BridgeMethod,
  type BridgeMessage,
  type BridgeResponse,
  encodeBridgeRequest,
} from "./acpx-bridge-protocol";
import { PromptCommandError } from "../prompt-output";

type WriteLine = (line: string) => boolean | void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onEvent?: (event: { type: "prompt.segment"; text: string }) => void;
}

export class AcpxBridgeClient {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private terminalError: Error | null = null;

  constructor(private readonly writeLine: WriteLine) {}

  request<TResult>(
    method: BridgeMethod,
    params: Record<string, unknown>,
    onEvent?: (event: { type: "prompt.segment"; text: string }) => void,
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
        const didWrite = this.writeLine(
          encodeBridgeRequest({
            id,
            method,
            params,
          }),
        );

        if (didWrite === false) {
          this.pending.delete(id);
          reject(new Error("bridge write buffer is full"));
        }
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
      }
      return;
    }

    const response = message as BridgeResponse;
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
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
      WEACPX_BRIDGE_ACPX_COMMAND: options.acpxCommand ?? "acpx",
      WEACPX_BRIDGE_PERMISSION_MODE: options.permissionMode ?? "approve-all",
      WEACPX_BRIDGE_NON_INTERACTIVE_PERMISSIONS: options.nonInteractivePermissions ?? "deny",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const client = new AcpxBridgeClient((line) => child.stdin.write(line)) as ManagedBridgeClient;
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
      child.kill("SIGTERM");
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
