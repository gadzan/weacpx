import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { NonInteractivePermissions, PermissionMode } from "../config/types";
import { resolveSpawnCommand } from "../process/spawn-command";
import { getPromptText } from "../transport/prompt-output";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type SessionCreateRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

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
  ) {}

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
    const createdWithHelper = await this.runSessionCreate(createSpec.command, createSpec.args, input.cwd);

    if (createdWithHelper.code !== 0) {
      throw new Error(
        createdWithHelper.stderr ||
          createdWithHelper.stdout ||
          ensured.stderr ||
          ensured.stdout ||
          "failed to create session",
      );
    }

    return {};
  }

  async prompt(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
    text: string;
  }): Promise<{ text: string }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildPromptArgs(input, [
      "prompt",
      "-s",
      input.name,
      input.text,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);
    return { text: getPromptText(result) };
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
    const nonInteractivePermissions = this.options.nonInteractivePermissions ?? "fail";
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

async function shellSessionCreateRunner(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const helperPath = fileURLToPath(new URL("../../scripts/acpx-session-new-helper.sh", import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", [helperPath, command, cwd, ...args], {
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
