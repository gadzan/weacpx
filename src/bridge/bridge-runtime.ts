import { copyFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { spawn } from "node:child_process";

import type { NonInteractivePermissions, PermissionMode, WechatReplyMode } from "../config/types";
import { resolveSpawnCommand } from "../process/spawn-command";
import { getPromptText } from "../transport/prompt-output";
import { createStructuredPromptFile } from "../transport/prompt-media";
import { createStreamingPromptState, parseStreamingDataChunk } from "../transport/streaming-prompt";
import { parseMissingOptionalDep } from "./parse-missing-optional-dep";
import { deriveParentPackageName } from "../recovery/discover-parent-package-paths";
import { AcpxQueueOwnerLauncher } from "../transport/acpx-queue-owner-launcher";
import { permissionModeToFlag } from "../transport/permission-mode-flag";
import { runAgentSessionList } from "../transport/agent-session-list";
import type {
  EnsureSessionProgress,
  MissingOptionalDepErrorData,
} from "../transport/acpx-bridge/acpx-bridge-protocol";
import type { AgentSessionListResult, PromptMediaInput } from "../transport/types";
import type { ToolEventMode } from "../transport/tool-event-mode.js";
import type { ToolUseEvent } from "../channels/types.js";

type BridgePromptStreamEvent =
  | { type: "prompt.segment"; text: string }
  | { type: "prompt.tool_event"; event: ToolUseEvent }
  | { type: "prompt.thought"; text: string };

export class EnsureSessionFailedError extends Error {
  readonly kind: "missing_optional_dep" | "generic";
  readonly data?: MissingOptionalDepErrorData;
  constructor(
    message: string,
    kind: "missing_optional_dep" | "generic",
    data?: MissingOptionalDepErrorData,
  ) {
    super(message);
    this.name = "EnsureSessionFailedError";
    this.kind = kind;
    this.data = data;
  }
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  onStderrLine?: (line: string) => void;
}
type CommandRunner = (command: string, args: string[], options?: CommandRunnerOptions) => Promise<CommandResult>;
type SessionCreateRunner = (command: string, args: string[], cwd: string, options?: CommandRunnerOptions) => Promise<CommandResult>;
type PromptRunner = typeof runStreamingPrompt;
type RepairSessionIndexFn = () => Promise<boolean>;

interface BridgeSessionInput {
  agent: string;
  agentCommand?: string;
  cwd: string;
  name: string;
  mcpCoordinatorSession?: string;
  mcpSourceHandle?: string;
  replyMode?: "stream" | "final" | "verbose";
  media?: PromptMediaInput;
  toolEvents?: boolean;
  toolEventMode?: ToolEventMode;
}

interface StreamingPromptRunnerOptions {
  spawnPrompt?: (command: string, args: string[]) => PromptStreamProcess;
  setIntervalFn?: (fn: () => void, delay: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
  maxSegmentWaitMs?: number;
  flushCheckIntervalMs?: number;
  now?: () => number;
  formatToolCalls?: boolean;
  toolEventMode?: ToolEventMode;
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
  permissionPolicy?: string;
  /** Idle TTL (seconds) passed to acpx as `--ttl` on prompt; 0 = keep alive forever. */
  queueOwnerTtlSeconds?: number;
}

export class BridgeRuntime {
  // undefined = not yet probed; true/false = probed result.
  // Older acpx builds don't accept --verbose; we feature-detect lazily on first
  // ensure failure that looks like "unknown option", then disable verbose for
  // this runtime's lifetime. A restart re-probes.
  private acpxVerboseSupported: boolean | undefined = undefined;

  constructor(
    private readonly command: string = "acpx",
    private readonly run: CommandRunner = defaultRunner,
    private readonly runSessionCreate: SessionCreateRunner = shellSessionCreateRunner,
    private readonly options: BridgeRuntimeOptions = {},
    private readonly runPromptCommand: PromptRunner = defaultPromptRunner,
    private readonly repairSessionIndex: RepairSessionIndexFn = tryRepairAcpxSessionIndex,
    private readonly queueOwnerLauncher: Pick<AcpxQueueOwnerLauncher, "launch"> = new AcpxQueueOwnerLauncher({
      acpxCommand: command,
      // Coordinator sessions pre-spawn the queue owner here (before `acpx prompt`),
      // so the owner's warm window must be set at launch — the prompt's `--ttl`
      // can't extend an already-running owner. Launcher ttl is milliseconds.
      ...(typeof options.queueOwnerTtlSeconds === "number" && Number.isFinite(options.queueOwnerTtlSeconds)
        ? { ttlMs: options.queueOwnerTtlSeconds * 1000 }
        : {}),
    }),
  ) {}

  async updatePermissionPolicy(policy: {
    permissionMode: PermissionMode;
    nonInteractivePermissions: NonInteractivePermissions;
    permissionPolicy?: string;
  }): Promise<Record<string, never>> {
    this.options.permissionMode = policy.permissionMode;
    this.options.nonInteractivePermissions = policy.nonInteractivePermissions;
    this.options.permissionPolicy = policy.permissionPolicy;
    return {};
  }

  async listAgentSessions(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    cursor?: string;
    filterCwd?: string;
  }): Promise<AgentSessionListResult | undefined> {
    return await runAgentSessionList({
      filterCwd: input.filterCwd,
      runList: async (includeFilterCwd) => {
        const spec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
          "sessions",
          "list",
          ...(includeFilterCwd && input.filterCwd ? ["--filter-cwd", input.filterCwd] : []),
          ...(input.cursor ? ["--cursor", input.cursor] : []),
        ], { format: "json" }));
        return await this.run(spec.command, spec.args);
      },
      formatError: (result) => result.stderr || result.stdout || `sessions list failed with exit code ${result.code}`,
    });
  }

  async resumeAgentSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
    agentSessionId: string;
  }): Promise<Record<string, never>> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "new",
      "--name",
      input.name,
      "--resume-session",
      input.agentSessionId,
    ], { format: "quiet" }));
    const result = await this.runSessionCreate(spawnSpec.command, spawnSpec.args, input.cwd);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "sessions resume failed");
    }
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

  async tailSessionHistory(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
    lines: number;
  }): Promise<{ text: string }> {
    const candidates = [
      ["sessions", "history", "quiet", "-s", input.name, String(input.lines)],
      ["sessions", "history", "quiet", input.name, String(input.lines)],
      ["sessions", "history", "-s", input.name, "--tail", String(input.lines)],
      ["sessions", "history", input.name, "--tail", String(input.lines)],
      ["sessions", "history", "--name", input.name, "--tail", String(input.lines)],
    ];

    let lastResult: CommandResult | undefined;
    for (const tailArgs of candidates) {
      const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, tailArgs));
      const result = await this.run(spawnSpec.command, spawnSpec.args);
      if (result.code === 0) {
        return { text: result.stdout.trimEnd() };
      }
      lastResult = result;
    }

    const message = lastResult?.stderr || lastResult?.stdout || "sessions history failed";
    throw new Error(message);
  }

  async ensureSession(
    input: BridgeSessionInput,
    onProgress?: (progress: EnsureSessionProgress) => void,
  ): Promise<Record<string, never>> {
    onProgress?.("spawn");
    const onStderrLine = onProgress
      ? (line: string) => {
          const trimmed = line.replace(/\r$/, "").trimEnd();
          if (trimmed.length === 0) return;
          onProgress({ kind: "note", text: trimmed });
        }
      : undefined;

    const runWithVerboseFallback = async (
      tailArgs: string[],
      runner: (command: string, args: string[]) => Promise<CommandResult>,
    ): Promise<CommandResult> => {
      const useVerbose = this.acpxVerboseSupported !== false;
      const spec = resolveSpawnCommand(
        this.command,
        this.buildSessionArgs(input, tailArgs, { verbose: useVerbose }),
      );
      const result = await runner(spec.command, spec.args);
      if (result.code === 0) {
        if (useVerbose) this.acpxVerboseSupported = true;
        return result;
      }
      if (useVerbose && isUnknownVerboseOption(result.stderr, result.stdout)) {
        this.acpxVerboseSupported = false;
        const retrySpec = resolveSpawnCommand(
          this.command,
          this.buildSessionArgs(input, tailArgs, { verbose: false }),
        );
        return await runner(retrySpec.command, retrySpec.args);
      }
      return result;
    };

    const ensured = await runWithVerboseFallback(
      ["sessions", "ensure", "--name", input.name],
      (command, args) => this.run(command, args, { onStderrLine }),
    );
    if (ensured.code === 0) {
      onProgress?.("ready");
      return {};
    }

    const existingSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, ["sessions", "show", input.name]));
    const existing = await this.run(existingSpec.command, existingSpec.args);
    if (existing.code === 0) {
      onProgress?.("ready");
      return {};
    }

    onProgress?.("initializing");
    const created = await runWithVerboseFallback(
      ["sessions", "new", "--name", input.name],
      (command, args) => this.runSessionCreate(command, args, input.cwd, { onStderrLine }),
    );

    if (created.code === 0) {
      onProgress?.("ready");
      return {};
    }

    const output = created.stderr || created.stdout || "";
    if (output.includes("EPERM") && await this.repairSessionIndex()) {
      const repaired = await this.run(existingSpec.command, existingSpec.args);
      if (repaired.code === 0) {
        onProgress?.("ready");
        return {};
      }
    }

    const rawMessage = output || ensured.stderr || ensured.stdout || "failed to create session";
    // Strip [acpx] verbose log lines so they can't trigger false-positive optional-dep parsing.
    const parseInput = rawMessage
      .split(/\r\n|\r|\n/)
      .filter((line) => !/^\s*\[acpx\]/.test(line))
      .join("\n");
    const parsed = parseMissingOptionalDep(parseInput);
    if (parsed) {
      const parentPackagePath = this.resolveParentPackagePath(input, parsed.package);
      throw new EnsureSessionFailedError(rawMessage, "missing_optional_dep", {
        package: parsed.package,
        parentPackagePath,
      });
    }
    throw new EnsureSessionFailedError(rawMessage, "generic");
  }

  private resolveParentPackagePath(
    input: { agent: string; agentCommand?: string },
    platformPackage: string,
  ): string | null {
    // Guess parent package name: strip trailing -<os>[-<arch>][-<libc>] suffixes
    const guess = deriveParentPackageName(platformPackage);
    const candidates = [input.agentCommand, input.agent, guess].filter(
      (c): c is string => Boolean(c),
    );
    for (const candidate of candidates) {
      try {
        const resolved = require.resolve(`${candidate}/package.json`, {
          paths: [process.cwd(), ...(require.resolve.paths(candidate) ?? [])],
        });
        return dirname(resolved);
      } catch {
        continue;
      }
    }
    return null;
  }

  async prompt(input: BridgeSessionInput & { text: string }, onEvent?: (event: BridgePromptStreamEvent) => void): Promise<{ text: string }> {
    await this.launchMcpQueueOwnerIfNeeded(input);
    const structuredPrompt = await createStructuredPromptFile(input.text, input.media);
    const spawnSpec = resolveSpawnCommand(this.command, this.buildPromptArgs(input, [
      "prompt",
      "-s",
      input.name,
      ...(structuredPrompt ? ["--file", structuredPrompt.filePath] : [input.text]),
    ]));
    const formatToolCalls = (input.replyMode ?? "verbose") === "verbose";
    // toolEventMode (Phase 1) wins; toolEvents:true (Phase 0 legacy) maps to "structured".
    const toolEventMode: ToolEventMode =
      input.toolEventMode ?? (input.toolEvents === true ? "structured" : "text");
    try {
      const result = onEvent
        ? await this.runPromptCommand(spawnSpec.command, spawnSpec.args, onEvent, {
            formatToolCalls,
            toolEventMode,
          })
        : await this.run(spawnSpec.command, spawnSpec.args);
      return { text: getPromptText(result) };
    } finally {
      try {
        await structuredPrompt?.cleanup();
      } catch {
        // Prompt outcome is more important than best-effort temp file cleanup.
      }
    }
  }

  private async launchMcpQueueOwnerIfNeeded(input: BridgeSessionInput): Promise<void> {
    if (!input.mcpCoordinatorSession) {
      return;
    }
    const record = await this.readSessionRecord(input);
    await this.queueOwnerLauncher.launch({
      acpxRecordId: record.acpxRecordId,
      coordinatorSession: input.mcpCoordinatorSession,
      ...(input.mcpSourceHandle ? { sourceHandle: input.mcpSourceHandle } : {}),
      permissionMode: this.options.permissionMode ?? "approve-all",
      nonInteractivePermissions: this.options.nonInteractivePermissions ?? "deny",
    });
  }

  private async readSessionRecord(input: BridgeSessionInput): Promise<{ acpxRecordId: string; agentSessionId?: string }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "show",
      input.name,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "sessions show failed");
    }
    try {
      const parsed = JSON.parse(result.stdout) as { acpxRecordId?: unknown; id?: unknown; agentSessionId?: unknown };
      let acpxRecordId: string | undefined;
      if (typeof parsed.acpxRecordId === "string") {
        acpxRecordId = parsed.acpxRecordId;
      } else if (typeof parsed.id === "string") {
        acpxRecordId = parsed.id;
      }
      const agentSessionId = typeof parsed.agentSessionId === "string" ? parsed.agentSessionId : undefined;
      if (acpxRecordId) {
        return { acpxRecordId, agentSessionId };
      }
    } catch {
      const firstLine = result.stdout.trim().split(/\r?\n/, 1)[0];
      if (firstLine && /^[\w.:-]+$/.test(firstLine) && firstLine.length >= 8) {
        return { acpxRecordId: firstLine };
      }
    }
    throw new Error("failed to resolve acpx session record id");
  }

  async getAgentSessionId(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ agentSessionId: string | undefined }> {
    const record = await this.readSessionRecord(input);
    return { agentSessionId: record.agentSessionId };
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

  async removeSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<Record<string, never>> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "close",
      input.name,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);

    if (result.code === 0) {
      return {};
    }
    if (isMissingBridgeSessionError(result.stderr, result.stdout)) {
      return {};
    }
    throw new Error(result.stderr || result.stdout || "sessions close failed");
  }

  async shutdown(): Promise<Record<string, never>> {
    return {};
  }

  private buildSessionArgs(
    input: {
      agent: string;
      agentCommand?: string;
      cwd: string;
      name?: string;
    },
    tail: string[],
    options: { verbose?: boolean; format?: "quiet" | "json" } = {},
  ): string[] {
    const prefix: string[] = [
      "--format",
      options.format ?? "quiet",
      "--cwd",
      input.cwd,
      ...this.buildPermissionArgs(),
    ];
    if (options.verbose) {
      prefix.push("--verbose");
    }
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
      ...this.buildQueueOwnerTtlArgs(),
    ];
    if (input.agentCommand) {
      return [...prefix, "--agent", input.agentCommand, ...tail];
    }

    return [...prefix, input.agent, ...tail];
  }

  // `--ttl` only governs the prompt path's queue owner warm window, so it is
  // intentionally limited to buildPromptArgs (not the shared session args).
  private buildQueueOwnerTtlArgs(): string[] {
    const ttl = this.options.queueOwnerTtlSeconds;
    if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
      return [];
    }
    return ["--ttl", String(ttl)];
  }

  private buildPermissionArgs(): string[] {
    const permissionMode = this.options.permissionMode ?? "approve-all";
    const nonInteractivePermissions = this.options.nonInteractivePermissions ?? "deny";
    const modeFlag = permissionModeToFlag(permissionMode);

    const args = [modeFlag, "--non-interactive-permissions", nonInteractivePermissions];
    if (typeof this.options.permissionPolicy === "string" && this.options.permissionPolicy.trim().length > 0) {
      args.push("--permission-policy", this.options.permissionPolicy);
    }
    return args;
  }
}

function spawnCapture(
  command: string,
  args: string[],
  options?: { cwd?: string; onStderrLine?: (line: string) => void },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let stderrTail = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (!options?.onStderrLine) return;
      stderrTail += text;
      // Split on both \n and \r so Windows CRLF and bare-\r progress bars both emit lines.
      const matches = stderrTail.split(/\r\n|\r|\n/);
      // Last element is the unterminated tail (or "" if input ended on a separator).
      stderrTail = matches.pop() ?? "";
      for (const line of matches) {
        options.onStderrLine(line);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (options?.onStderrLine && stderrTail.length > 0) {
        options.onStderrLine(stderrTail);
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function defaultRunner(
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
): Promise<CommandResult> {
  return await spawnCapture(command, args, options);
}

export async function runStreamingPrompt(
  command: string,
  args: string[],
  onEvent?: (event: BridgePromptStreamEvent) => void,
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
    const toolEventMode: ToolEventMode = options.toolEventMode ?? "text";
    const state = createStreamingPromptState(options.formatToolCalls ?? false, {
      mode: toolEventMode,
      ...(onEvent && (toolEventMode === "structured" || toolEventMode === "both")
        ? { onToolEvent: (toolEvent) => onEvent({ type: "prompt.tool_event", event: toolEvent }) }
        : {}),
      // `onEvent` here is the synchronous `writeLine` path in bridge-server —
      // it emits a `prompt.thought` NDJSON line and returns immediately. The
      // async `onThought` chain lives on the client side (acpx-bridge-transport),
      // so this side has no callback to await before resolving the prompt.
      ...(onEvent
        ? { onThought: (chunk) => onEvent({ type: "prompt.thought", text: chunk }) }
        : {}),
    });
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
  onEvent?: (event: BridgePromptStreamEvent) => void,
  options?: StreamingPromptRunnerOptions,
): Promise<CommandResult> {
  return await runStreamingPrompt(command, args, onEvent, options);
}

async function shellSessionCreateRunner(
  command: string,
  args: string[],
  cwd: string,
  options?: CommandRunnerOptions,
): Promise<CommandResult> {
  return await spawnCapture(command, args, { cwd, onStderrLine: options?.onStderrLine });
}

export function selectLatestAcpxSessionIndexTmp(files: string[]): string | null {
  let latestTmp: string | null = null;
  let latestTime = 0;

  for (const file of files) {
    const match = file.match(/^index\.json\.\d+\.(\d+)\.tmp$/);
    if (!match) {
      continue;
    }

    const timestamp = Number(match[1]);
    if (timestamp > latestTime) {
      latestTime = timestamp;
      latestTmp = file;
    }
  }

  return latestTmp;
}

interface RepairAcpxSessionIndexDeps {
  platform?: NodeJS.Platform;
  home?: string;
  readdirFn?: typeof readdir;
  copyFileFn?: typeof copyFile;
}

/**
 * On Windows, acpx uses rename() to atomically update the session index,
 * but antivirus or file system lockers can block this operation (EPERM).
 * This function finds the latest tmp file written by acpx and copies it
 * over the index.json as a fallback.
 */
export async function tryRepairAcpxSessionIndex(deps: RepairAcpxSessionIndexDeps = {}): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return false;
  }

  const home = deps.home ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (!home) {
    return false;
  }

  const pathJoin = platform === "win32" ? win32.join : join;
  const sessionsDir = pathJoin(home, ".acpx", "sessions");
  const indexPath = pathJoin(sessionsDir, "index.json");
  const readdirFn = deps.readdirFn ?? readdir;
  const copyFileFn = deps.copyFileFn ?? copyFile;

  let files: string[];
  try {
    files = await readdirFn(sessionsDir);
  } catch {
    return false;
  }

  const latestTmp = selectLatestAcpxSessionIndexTmp(files);
  if (!latestTmp) {
    return false;
  }

  try {
    await copyFileFn(pathJoin(sessionsDir, latestTmp), indexPath);
    return true;
  } catch {
    return false;
  }
}

function isUnknownVerboseOption(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`;
  // Commander-style ("error: unknown option '--verbose'"), yargs, and generic "unrecognized".
  return /(unknown|unrecognized)\b[^\n]*--verbose/i.test(combined);
}

function isMissingBridgeSessionError(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("no named session") ||
    combined.includes("no cwd session") ||
    combined.includes("session not found") ||
    combined.includes("unknown session") ||
    combined.includes("no acpx session found")
  );
}
