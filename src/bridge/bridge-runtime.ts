import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type SessionCreateRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

export class BridgeRuntime {
  constructor(
    private readonly command: string = "acpx",
    private readonly run: CommandRunner = defaultRunner,
    private readonly runSessionCreate: SessionCreateRunner = shellSessionCreateRunner,
  ) {}

  async hasSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ exists: boolean }> {
    const result = await this.run(this.command, this.buildSessionArgs(input, [
      "sessions",
      "show",
      input.name,
    ]));

    return { exists: result.code === 0 };
  }

  async ensureSession(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<Record<string, never>> {
    const ensured = await this.run(this.command, this.buildSessionArgs(input, ["sessions", "ensure", "--name", input.name]));
    if (ensured.code === 0) {
      return {};
    }

    const existing = await this.run(
      this.command,
      this.buildSessionArgs(input, ["sessions", "show", input.name]),
    );
    if (existing.code === 0) {
      return {};
    }

    const createdWithHelper = await this.runSessionCreate(
      this.command,
      this.buildSessionArgs(input, ["sessions", "new", "--name", input.name]),
      input.cwd,
    );

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
    const result = await this.run(this.command, this.buildSessionArgs(input, [
      "prompt",
      "-s",
      input.name,
      input.text,
    ]));

    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "prompt failed");
    }

    return { text: result.stdout.trim() };
  }

  async cancel(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ cancelled: boolean; message: string }> {
    const result = await this.run(this.command, this.buildSessionArgs(input, [
      "cancel",
      "-s",
      input.name,
    ]));

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
    if (input.agentCommand) {
      return ["--format", "quiet", "--cwd", input.cwd, "--agent", input.agentCommand, ...tail];
    }

    return ["--format", "quiet", "--cwd", input.cwd, input.agent, ...tail];
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
