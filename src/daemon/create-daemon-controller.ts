import { mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";

import { DaemonController } from "./daemon-controller";
import type { DaemonPaths } from "./daemon-files";

interface SpawnRequest {
  mode: "direct" | "windows-hidden";
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    detached?: boolean;
    stdio: ["ignore", number | "pipe", number | "ignore"];
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
        return await (options.spawnProcess ?? defaultSpawnProcess)(
          buildSpawnRequest(paths, options, stdoutHandle.fd, stderrHandle.fd),
        );
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

function buildSpawnRequest(
  paths: DaemonPaths,
  options: CreateDaemonControllerOptions,
  stdoutFd: number,
  stderrFd: number,
): SpawnRequest {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return {
      mode: "windows-hidden",
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        buildWindowsLauncherScript(),
      ],
      options: {
        cwd: options.cwd,
        env: {
          ...options.env,
          WEACPX_DAEMON_COMMAND: options.processExecPath,
          WEACPX_DAEMON_ARG0: options.cliEntryPath,
          WEACPX_DAEMON_ARG1: "run",
          WEACPX_DAEMON_CWD: options.cwd,
          WEACPX_DAEMON_STDOUT: paths.stdoutLog,
          WEACPX_DAEMON_STDERR: paths.stderrLog,
        },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    };
  }

  return {
    mode: "direct",
    command: options.processExecPath,
    args: [options.cliEntryPath, "run"],
    options: {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: ["ignore", stdoutFd, stderrFd],
    },
  };
}

function buildWindowsLauncherScript(): string {
  const script = [
    "$process = Start-Process -FilePath $env:WEACPX_DAEMON_COMMAND `",
    "  -ArgumentList @($env:WEACPX_DAEMON_ARG0, $env:WEACPX_DAEMON_ARG1) `",
    "  -WorkingDirectory $env:WEACPX_DAEMON_CWD `",
    "  -RedirectStandardOutput $env:WEACPX_DAEMON_STDOUT `",
    "  -RedirectStandardError $env:WEACPX_DAEMON_STDERR `",
    "  -WindowStyle Hidden `",
    "  -PassThru",
    "[Console]::Out.WriteLine($process.Id)",
  ].join("\n");

  return Buffer.from(script, "utf16le").toString("base64");
}

async function defaultSpawnProcess(request: SpawnRequest): Promise<number> {
  if (request.mode === "windows-hidden") {
    return await spawnWindowsHiddenProcess(request);
  }

  const child = spawn(request.command, request.args, request.options);
  child.unref();
  return child.pid ?? 0;
}

async function spawnWindowsHiddenProcess(request: SpawnRequest): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, request.options);
    let stdout = "";
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      if (settled) {
        return;
      }

      const pid = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        return;
      }

      settled = true;
      child.unref();
      resolve(pid);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      if (code !== 0) {
        settled = true;
        reject(new Error(`Failed to launch hidden Windows daemon process (exit ${code ?? 1})`));
        return;
      }

      const pid = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        settled = true;
        reject(new Error("Failed to read daemon pid from hidden Windows launcher"));
        return;
      }

      settled = true;
      resolve(pid);
    });
  });
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
