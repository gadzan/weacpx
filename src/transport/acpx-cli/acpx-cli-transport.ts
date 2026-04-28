import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { spawn as spawnPty } from "node-pty";

import { resolveSpawnCommand } from "../../process/spawn-command";
import type { NonInteractivePermissions, PermissionMode } from "../../config/types";
import type {
  EnsureSessionProgress,
  PermissionPolicy,
  ReplyQuotaContext,
  ResolvedSession,
  SessionTransport,
} from "../types";
import { getPromptText, normalizeCommandError } from "../prompt-output";
import { createStreamingPromptState, parseStreamingDataChunk } from "../streaming-prompt";
import { buildOverflowSummary, createQuotaGatedReplySink } from "../quota-gated-reply-sink";
import { ensureNodePtyHelperExecutable, resolveNodePtyHelperPath } from "./node-pty-helper";
import { terminateProcessTree } from "../../process/terminate-process-tree";
import { AcpxQueueOwnerLauncher } from "../acpx-queue-owner-launcher";
import { permissionModeToFlag } from "../permission-mode-flag";

interface AcpxCliTransportOptions {
  command?: string;
  sessionInitTimeoutMs?: number;
  permissionMode?: PermissionMode;
  nonInteractivePermissions?: NonInteractivePermissions;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  timeoutMs?: number;
}

type CommandRunner = (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>;
type PtyRunner = (command: string, args: string[], options?: RunOptions) => Promise<CommandResult>;
const require = createRequire(import.meta.url);

async function defaultRunner(command: string, args: string[], options?: RunOptions): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const spawnSpec = resolveSpawnCommand(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timeoutId = options?.timeoutMs
      ? setTimeout(() => {
          void terminateProcessTree(child.pid ?? 0);
          reject(new Error(`acpx command timed out after ${options.timeoutMs}ms: ${renderCommandForError(args)}`));
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });
    child.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function defaultPtyRunner(command: string, args: string[], options?: RunOptions): Promise<CommandResult> {
  const helperPath = resolveNodePtyHelperPath(
    require.resolve("node-pty/package.json"),
    process.platform,
    process.arch,
  );
  await ensureNodePtyHelperExecutable(helperPath);

  return await new Promise((resolve, reject) => {
    const spawnSpec = resolveSpawnCommand(command, args);
    const child = spawnPty(spawnSpec.command, spawnSpec.args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    let output = "";

    const timeoutId = options?.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`acpx command timed out after ${options.timeoutMs}ms: ${renderCommandForError(args)}`));
        }, options.timeoutMs)
      : undefined;

    child.onData((chunk) => {
      output += chunk;
    });

    child.onExit(({ exitCode }) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ code: exitCode, stdout: output, stderr: "" });
    });
  });
}

export class AcpxCliTransport implements SessionTransport {
  private readonly command: string;
  private readonly sessionInitTimeoutMs: number;
  private permissionMode: PermissionMode;
  private nonInteractivePermissions: NonInteractivePermissions;
  private readonly runCommand: CommandRunner;
  private readonly runPtyCommand: PtyRunner;
  private readonly queueOwnerLauncher: Pick<AcpxQueueOwnerLauncher, "launch">;

  constructor(
    options: AcpxCliTransportOptions,
    runCommand: CommandRunner = defaultRunner,
    runPtyCommand: PtyRunner = defaultPtyRunner,
    queueOwnerLauncher?: Pick<AcpxQueueOwnerLauncher, "launch">,
  ) {
    this.command = options.command ?? "acpx";
    this.sessionInitTimeoutMs = options.sessionInitTimeoutMs ?? 120_000;
    this.permissionMode = options.permissionMode ?? "approve-all";
    this.nonInteractivePermissions = options.nonInteractivePermissions ?? "deny";
    this.runCommand = runCommand;
    this.runPtyCommand = runPtyCommand;
    this.queueOwnerLauncher = queueOwnerLauncher ?? new AcpxQueueOwnerLauncher({
      acpxCommand: this.command,
    });
  }

  // acpx-cli transport does not stream stderr back to the caller, so "note" progress
  // is never emitted. Users on this transport still see the initial "spawn" hint from
  // CommandRouter (emitted before the call) but will not receive mid-flight updates.
  async ensureSession(session: ResolvedSession, _onProgress?: (progress: EnsureSessionProgress) => void): Promise<void> {
    const args = this.buildArgs(session, [
      "sessions",
      "new",
      "--name",
      session.transportSession,
    ]);
    const runEnsure = session.agentCommand ? this.run : this.runWithPty;
    await runEnsure.call(this, args, {
      timeoutMs: this.sessionInitTimeoutMs,
    });
  }

  async prompt(
    session: ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
    replyContext?: ReplyQuotaContext,
  ): Promise<{ text: string }> {
    await this.launchMcpQueueOwnerIfNeeded(session);
    const args = this.buildPromptArgs(session, text);
    if (reply) {
      const formatToolCalls = session.replyMode === "verbose";
      const { result, overflowCount } = await this.runStreamingPrompt(
        this.command,
        args,
        reply,
        30_000,
        formatToolCalls,
        replyContext,
      );
      const baseText = getPromptText(result);
      const summary = buildOverflowSummary(overflowCount);
      // Streaming mode already pushed every segment through reply() (mid quota).
      // Returning baseText again would duplicate what the user just saw. Only
      // surface a final-tier text when overflow happened — in that case the
      // summary is new info AND baseText carries the agent's final answer that
      // may have been partially or fully dropped from the stream.
      return { text: summary ? `${summary}\n\n${baseText}` : "" };
    }
    const result = await this.runCommand(this.command, args);
    return { text: getPromptText(result) };
  }

  async setMode(session: ResolvedSession, modeId: string): Promise<void> {
    await this.run(this.buildArgs(session, [
      "set-mode",
      "-s",
      session.transportSession,
      modeId,
    ]));
  }

  async cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }> {
    const output = await this.run(this.buildArgs(session, [
      "cancel",
      "-s",
      session.transportSession,
    ]));
    return {
      cancelled: true,
      message: output.trim(),
    };
  }


  async updatePermissionPolicy(policy: PermissionPolicy): Promise<void> {
    this.permissionMode = policy.permissionMode;
    this.nonInteractivePermissions = policy.nonInteractivePermissions;
  }

  async removeSession(session: ResolvedSession): Promise<void> {
    const result = await this.runCommand(this.command, this.buildArgs(session, [
      "sessions",
      "close",
      session.transportSession,
    ]));
    if (result.code === 0) {
      return;
    }
    if (isMissingAcpxSessionError(result.stderr, result.stdout)) {
      return;
    }
    const detail = normalizeCommandError(result) ?? `command failed with exit code ${result.code}`;
    throw new Error(detail);
  }

  async hasSession(session: ResolvedSession): Promise<boolean> {
    const result = await this.runCommand(this.command, this.buildArgs(session, [
      "sessions",
      "show",
      session.transportSession,
    ]));

    return result.code === 0;
  }

  private async launchMcpQueueOwnerIfNeeded(session: ResolvedSession): Promise<void> {
    if (!session.mcpCoordinatorSession) {
      return;
    }
    const record = await this.readSessionRecord(session);
    await this.queueOwnerLauncher.launch({
      acpxRecordId: record.acpxRecordId,
      coordinatorSession: session.mcpCoordinatorSession,
      ...(session.mcpSourceHandle ? { sourceHandle: session.mcpSourceHandle } : {}),
      permissionMode: this.permissionMode,
      nonInteractivePermissions: this.nonInteractivePermissions,
    });
  }

  private async readSessionRecord(session: ResolvedSession): Promise<{ acpxRecordId: string }> {
    const result = await this.runCommand(this.command, this.buildArgs(session, [
      "sessions",
      "show",
      session.transportSession,
    ]));
    if (result.code !== 0) {
      const detail = normalizeCommandError(result) ?? `command failed with exit code ${result.code}`;
      throw new Error(detail);
    }
    try {
      const parsed = JSON.parse(result.stdout) as { acpxRecordId?: unknown; id?: unknown };
      const acpxRecordId = typeof parsed.acpxRecordId === "string"
        ? parsed.acpxRecordId
        : typeof parsed.id === "string"
          ? parsed.id
          : undefined;
      if (acpxRecordId) {
        return { acpxRecordId };
      }
    } catch {
      const firstLine = result.stdout.trim().split(/\r?\n/, 1)[0];
      if (firstLine && /^[\w.:-]+$/.test(firstLine) && firstLine.length >= 8) {
        return { acpxRecordId: firstLine };
      }
    }
    throw new Error("failed to resolve acpx session record id");
  }

  private async run(args: string[], options?: RunOptions): Promise<string> {
    const result = await this.runCommandWithTimeout(this.runCommand, args, options);
    if (result.code !== 0) {
      const detail = normalizeCommandError(result) ?? `command failed with exit code ${result.code}`;
      throw new Error(detail);
    }
    return result.stdout;
  }

  private async runWithPty(args: string[], options?: RunOptions): Promise<string> {
    const result = await this.runCommandWithTimeout(this.runPtyCommand, args, options);
    if (result.code !== 0) {
      const detail = normalizeCommandError(result) ?? `command failed with exit code ${result.code}`;
      throw new Error(detail);
    }
    return result.stdout;
  }

  private async runCommandWithTimeout(
    runner: CommandRunner | PtyRunner,
    args: string[],
    options?: RunOptions,
  ): Promise<CommandResult> {
    const spawnSpec = resolveSpawnCommand(this.command, args);

    if (!options?.timeoutMs) {
      return await runner(spawnSpec.command, spawnSpec.args, undefined);
    }

    let timeoutId: NodeJS.Timeout | undefined;

    return await Promise.race([
      runner(spawnSpec.command, spawnSpec.args, options).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      }),
      new Promise<CommandResult>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `acpx command timed out after ${options.timeoutMs}ms: ${renderCommandForError(args)}`,
            ),
          );
        }, options.timeoutMs);
      }),
    ]);
  }

  private async runStreamingPrompt(
    command: string,
    args: string[],
    reply: (text: string) => Promise<void>,
    maxSegmentWaitMs: number = 30_000,
    formatToolCalls: boolean = false,
    replyContext?: ReplyQuotaContext,
  ): Promise<{ result: CommandResult; overflowCount: number }> {
    return await new Promise((resolve, reject) => {
      const spawnSpec = resolveSpawnCommand(command, args);
      const child = spawn(spawnSpec.command, spawnSpec.args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const state = createStreamingPromptState(formatToolCalls);
      let lastReplyAt = Date.now();

      const sink = createQuotaGatedReplySink({
        reply,
        ...(replyContext ? { replyContext } : {}),
      });

      const flushBuffer = () => {
        const remaining = state.buffer.trim();
        if (remaining.length > 0) {
          state.buffer = "";
          sink.feedSegment(remaining);
          lastReplyAt = Date.now();
        }
      };

      // Periodic timer: flush accumulated text if waiting too long
      const timer = setInterval(() => {
        if (state.buffer.trim().length > 0 && Date.now() - lastReplyAt >= maxSegmentWaitMs) {
          flushBuffer();
        }
      }, 5_000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += String(chunk);
        parseStreamingDataChunk(state, String(chunk));
        for (const segment of state.segments.splice(0)) {
          sink.feedSegment(segment);
          lastReplyAt = Date.now();
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += String(chunk);
      });

      child.on("error", (err) => {
        clearInterval(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearInterval(timer);
        const remaining = state.finalize();
        if (remaining.length > 0) {
          sink.feedSegment(remaining);
        }
        const { overflowCount } = sink.finalize();
        // Note: any aggregator trailing text is folded into the overflow
        // summary path via the final agent message (caller appends summary).
        // Wait for all in-flight reply() rejections to settle before deciding
        // whether to reject the prompt with a QuotaDeferredError. Without
        // draining, the deferred error from an outbound pushReply could
        // arrive after we already resolved, and the wake-coordinator catch
        // would never see it — silently clearing injectionPending.
        void sink.drain({ timeoutMs: 30_000 }).then(() => {
          const deferred = sink.getPendingError();
          if (deferred) {
            reject(deferred);
            return;
          }
          resolve({
            result: { code: code ?? 1, stdout, stderr },
            overflowCount,
          });
        });
      });
    });
  }

  private buildArgs(session: ResolvedSession, tail: string[]): string[] {
    const prefix = [
      "--format",
      "quiet",
      "--cwd",
      session.cwd,
      ...this.buildPermissionArgs(),
    ];
    if (session.agentCommand) {
      return [...prefix, "--agent", session.agentCommand, ...tail];
    }

    return [...prefix, session.agent, ...tail];
  }

  private buildPromptArgs(session: ResolvedSession, text: string): string[] {
    const prefix = [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      session.cwd,
      ...this.buildPermissionArgs(),
    ];
    const tail = ["prompt", "-s", session.transportSession, text];

    if (session.agentCommand) {
      return [...prefix, "--agent", session.agentCommand, ...tail];
    }

    return [...prefix, session.agent, ...tail];
  }

  private buildPermissionArgs(): string[] {
    const modeFlag = permissionModeToFlag(this.permissionMode);

    return [modeFlag, "--non-interactive-permissions", this.nonInteractivePermissions];
  }
}

function isMissingAcpxSessionError(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("no named session") ||
    combined.includes("no cwd session") ||
    combined.includes("session not found") ||
    combined.includes("unknown session") ||
    combined.includes("no acpx session found")
  );
}

function renderCommandForError(args: string[]): string {
  const rendered: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--format") {
      index += 1;
      continue;
    }

    if (arg === "--cwd") {
      index += 1;
      continue;
    }

    rendered.push(/\s/.test(arg) || arg.includes(":") ? `"${arg}"` : arg);
  }

  return rendered.join(" ");
}
