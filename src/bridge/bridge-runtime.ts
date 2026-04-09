import { copyFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { NonInteractivePermissions, PermissionMode } from "../config/types";
import { resolveSpawnCommand } from "../process/spawn-command";
import { getPromptText } from "../transport/prompt-output";
import { createStreamingPromptState, parseStreamingDataChunk } from "../transport/streaming-prompt";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type SessionCreateRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;
type PromptRunner = typeof runStreamingPrompt;

interface StreamingPromptRunnerOptions {
  spawnPrompt?: (command: string, args: string[]) => PromptStreamProcess;
  setIntervalFn?: (fn: () => void, delay: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
  maxSegmentWaitMs?: number;
  flushCheckIntervalMs?: number;
  now?: () => number;
}

interface PromptStreamProcess {
  stdout: {
    setEncoding: (encoding: string) => void;
    on: (event: "data", handler: (chunk: string | Buffer) => void) => void;
  };
  stderr: {
    on: (event: "data", handler: (chunk: string | Buffer) => void) => void;
  };
  on: {
    (event: "error", handler: (error: Error) => void): void;
    (event: "close", handler: (code: number | null) => void): void;
  };
}

interface BridgeRuntimeOptions {
  permissionMode?: PermissionMode;
  nonInteractivePermissions?: NonInteractivePermissions;
}

export class BridgeRuntime {
  constructor(
    private readonly command: string = "acpx",
    private readonly run: CommandRunner = defaultRunner,
    private readonly runSessionCreate: SessionCreateRunner = shellSessionCreateRunner,
    private readonly options: BridgeRuntimeOptions = {},
    private readonly runPromptCommand: PromptRunner = defaultPromptRunner,
  ) {}

  async updatePermissionPolicy(policy: {
    permissionMode: PermissionMode;
    nonInteractivePermissions: NonInteractivePermissions;
  }): Promise<Record<string, never>> {
    this.options.permissionMode = policy.permissionMode;
    this.options.nonInteractivePermissions = policy.nonInteractivePermissions;
    return {};
  }

  async hasSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ exists: boolean }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "show",
      input.name,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);

    return { exists: result.code === 0 };
  }

  async ensureSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<Record<string, never>> {
    const ensuredSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "ensure",
      "--name",
      input.name,
    ]));
    const ensured = await this.run(ensuredSpec.command, ensuredSpec.args);
    if (ensured.code === 0) {
      return {};
    }

    const existingSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, ["sessions", "show", input.name]));
    const existing = await this.run(existingSpec.command, existingSpec.args);
    if (existing.code === 0) {
      return {};
    }

    const createSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, ["sessions", "new", "--name", input.name]));
    const created = await this.runSessionCreate(createSpec.command, createSpec.args, input.cwd);

    if (created.code === 0) {
      return {};
    }

    const output = created.stderr || created.stdout || "";
    if (output.includes("EPERM") && await tryRepairAcpxSessionIndex()) {
      const repaired = await this.run(existingSpec.command, existingSpec.args);
      if (repaired.code === 0) {
        return {};
      }
    }

    throw new Error(output || ensured.stderr || ensured.stdout || "failed to create session");
  }

  async prompt(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
    text: string;
  }, onEvent?: (event: { type: "prompt.segment"; text: string }) => void): Promise<{ text: string }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildPromptArgs(input, [
      "prompt",
      "-s",
      input.name,
      input.text,
    ]));
    const result = onEvent
      ? await this.runPromptCommand(spawnSpec.command, spawnSpec.args, onEvent)
      : await this.run(spawnSpec.command, spawnSpec.args);
    return { text: getPromptText(result) };
  }

  async setMode(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
    modeId: string;
  }): Promise<Record<string, never>> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "set-mode",
      "-s",
      input.name,
      input.modeId,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "set-mode failed");
    }

    return {};
  }

  async cancel(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ cancelled: boolean; message: string }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "cancel",
      "-s",
      input.name,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "cancel failed");
    }

    return {
      cancelled: true,
      message: result.stdout.trim(),
    };
  }

  async shutdown(): Promise<Record<string, never>> {
    return {};
  }

  private buildSessionArgs(
    input: {
      agent: string;
      agentCommand?: string;
      cwd: string;
      name: string;
    },
    tail: string[],
  ): string[] {
    const prefix = [
      "--format",
      "quiet",
      "--cwd",
      input.cwd,
      ...this.buildPermissionArgs(),
    ];
    if (input.agentCommand) {
      return [...prefix, "--agent", input.agentCommand, ...tail];
    }

    return [...prefix, input.agent, ...tail];
  }

  private buildPromptArgs(
    input: {
      agent: string;
      agentCommand?: string;
      cwd: string;
      name: string;
    },
    tail: string[],
  ): string[] {
    const prefix = [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      input.cwd,
      ...this.buildPermissionArgs(),
    ];
    if (input.agentCommand) {
      return [...prefix, "--agent", input.agentCommand, ...tail];
    }

    return [...prefix, input.agent, ...tail];
  }

  private buildPermissionArgs(): string[] {
    const permissionMode = this.options.permissionMode ?? "approve-all";
    const nonInteractivePermissions = this.options.nonInteractivePermissions ?? "deny";
    const modeFlag =
      permissionMode === "approve-reads"
        ? "--approve-reads"
        : permissionMode === "deny-all"
          ? "--deny-all"
          : "--approve-all";

    return [modeFlag, "--non-interactive-permissions", nonInteractivePermissions];
  }
}

async function defaultRunner(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runStreamingPrompt(
  command: string,
  args: string[],
  onEvent?: (event: { type: "prompt.segment"; text: string }) => void,
  options: StreamingPromptRunnerOptions = {},
): Promise<CommandResult> {
  const spawnPrompt = options.spawnPrompt ?? ((spawnCommand, spawnArgs) =>
    spawn(spawnCommand, spawnArgs, { stdio: ["ignore", "pipe", "pipe"] }) as unknown as PromptStreamProcess);
  const setIntervalFn = options.setIntervalFn ?? ((fn, delay) => setInterval(fn, delay));
  const clearIntervalFn = options.clearIntervalFn ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  const maxSegmentWaitMs = options.maxSegmentWaitMs ?? 30_000;
  const flushCheckIntervalMs = options.flushCheckIntervalMs ?? 5_000;
  const now = options.now ?? (() => Date.now());

  return await new Promise((resolve, reject) => {
    const child = spawnPrompt(command, args);
    let stdout = "";
    let stderr = "";
    const state = createStreamingPromptState();
    let lastReplyAt = now();

    const flushBuffer = () => {
      const remaining = state.buffer.trim();
      if (remaining.length > 0) {
        state.buffer = "";
        onEvent?.({ type: "prompt.segment", text: remaining });
        lastReplyAt = now();
      }
    };

    const timer = setIntervalFn(() => {
      if (state.buffer.trim().length > 0 && now() - lastReplyAt >= maxSegmentWaitMs) {
        flushBuffer();
      }
    }, flushCheckIntervalMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string | Buffer) => {
      const text = String(chunk);
      stdout += text;
      parseStreamingDataChunk(state, text);
      for (const segment of state.segments.splice(0)) {
        onEvent?.({ type: "prompt.segment", text: segment });
        lastReplyAt = now();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearIntervalFn(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearIntervalFn(timer);
      const remaining = state.finalize();
      if (remaining.length > 0) {
        onEvent?.({ type: "prompt.segment", text: remaining });
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function defaultPromptRunner(
  command: string,
  args: string[],
  onEvent?: (event: { type: "prompt.segment"; text: string }) => void,
): Promise<CommandResult> {
  return await runStreamingPrompt(command, args, onEvent);
}

async function shellSessionCreateRunner(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * On Windows, acpx uses rename() to atomically update the session index,
 * but antivirus or file system lockers can block this operation (EPERM).
 * This function finds the latest tmp file written by acpx and copies it
 * over the index.json as a fallback.
 */
async function tryRepairAcpxSessionIndex(): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (!home) {
    return false;
  }

  const sessionsDir = join(home, ".acpx", "sessions");
  const indexPath = join(sessionsDir, "index.json");

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return false;
  }

  const tmpFiles = files.filter(
    (f) => f.startsWith("index.json.") && f.endsWith(".tmp"),
  );
  if (tmpFiles.length === 0) {
    return false;
  }

  let latestTmp = "";
  let latestTime = 0;
  for (const f of tmpFiles) {
    const match = f.match(/^index\.json\.\d+\.(\d+)\.tmp$/);
    if (match && Number(match[1]) > latestTime) {
      latestTime = Number(match[1]);
      latestTmp = f;
    }
  }

  if (!latestTmp) {
    return false;
  }

  try {
    await copyFile(join(sessionsDir, latestTmp), indexPath);
    return true;
  } catch {
    return false;
  }
}
