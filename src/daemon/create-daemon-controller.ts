import { mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";

import { DaemonController } from "./daemon-controller";
import type { DaemonPaths } from "./daemon-files";

interface SpawnRequest {
  command: string;
  args: string[];
  options: {
    cwd: string;
    detached: boolean;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", number, number];
    windowsHide?: boolean;
  };
}

interface CreateDaemonControllerOptions {
  processExecPath: string;
  cliEntryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnProcess?: (request: SpawnRequest) => Promise<number>;
  isProcessRunning?: (pid: number) => boolean;
  terminateProcess?: (pid: number) => Promise<void>;
}

export function createDaemonController(
  paths: DaemonPaths,
  options: CreateDaemonControllerOptions,
): DaemonController {
  return new DaemonController(paths, {
    isProcessRunning: options.isProcessRunning ?? defaultIsProcessRunning,
    spawnDetached: async () => {
      await mkdir(paths.runtimeDir, { recursive: true });
      const stdoutHandle = await open(paths.stdoutLog, "a");
      const stderrHandle = await open(paths.stderrLog, "a");

      try {
        return await (options.spawnProcess ?? defaultSpawnProcess)({
          command: options.processExecPath,
          args: [options.cliEntryPath, "run"],
          options: {
            cwd: options.cwd,
            detached: true,
            env: options.env,
            stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
            ...(options.platform ?? process.platform) === "win32" ? { windowsHide: true } : {},
          },
        });
      } finally {
        await stdoutHandle.close();
        await stderrHandle.close();
      }
    },
    terminateProcess: options.terminateProcess ?? defaultTerminateProcess,
  });
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultSpawnProcess(request: SpawnRequest): Promise<number> {
  const child = spawn(request.command, request.args, request.options);
  child.unref();
  return child.pid ?? 0;
}

async function defaultTerminateProcess(pid: number): Promise<void> {
  await terminateProcessTree(pid);
}

type ProcessCommandRunner = (command: string, args: string[]) => Promise<number>;

export async function terminateProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  runCommand: ProcessCommandRunner = defaultRunProcessCommand,
): Promise<void> {
  if (platform === "win32") {
    try {
      await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      // Process tree already exited or could not be found.
    }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!defaultIsProcessRunning(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function defaultRunProcessCommand(command: string, args: string[]): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
