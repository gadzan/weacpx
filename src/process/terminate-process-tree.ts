import { spawn } from "node:child_process";

type ProcessCommandRunner = (command: string, args: string[]) => Promise<number>;
type KillProcess = (pid: number, signal: NodeJS.Signals) => void;
type IsProcessRunning = (pid: number) => boolean;

export async function terminateProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  runCommand: ProcessCommandRunner = defaultRunProcessCommand,
  killProcess: KillProcess = (targetPid, signal) => {
    process.kill(targetPid, signal);
  },
  isProcessRunning: IsProcessRunning = defaultIsProcessRunning,
): Promise<void> {
  if (pid <= 0) {
    return;
  }

  if (platform === "win32") {
    try {
      await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch {
      // Process tree already exited or could not be found.
    }
    return;
  }

  const targetPid = pid > 0 ? -pid : pid;

  try {
    killProcess(targetPid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(targetPid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    killProcess(targetPid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunProcessCommand(command: string, args: string[]): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
