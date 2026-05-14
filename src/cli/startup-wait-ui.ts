import type { DaemonStartupWait, DaemonStartupWaitPoll } from "../daemon/daemon-controller";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_SPINNER_FRAME = "⠋";
const ENVIRONMENT_HINT_DELAY_MS = 20_000;

export interface StartupWaitUi {
  wait?: DaemonStartupWait;
  stop: () => void;
}

export function renderStartupWaitLine(input: {
  elapsedMs: number;
  timeoutMs: number;
  frame: string;
}): string {
  const elapsedSeconds = Math.floor(input.elapsedMs / 1_000);
  const timeoutSeconds = Math.ceil(input.timeoutMs / 1_000);
  const detail = input.elapsedMs >= ENVIRONMENT_HINT_DELAY_MS
    ? "，首次启动可能需要准备依赖和运行环境"
    : "";

  return `${input.frame} 正在创建初始会话${detail} ${elapsedSeconds}s / ${timeoutSeconds}s，按 Ctrl+B 跳过等待`;
}

export function createStartupWaitUi(input: {
  isInteractive: () => boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  onInterrupt?: () => void;
}): StartupWaitUi {
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  if (!input.isInteractive() || !stdin.isTTY || !stdout.isTTY) {
    return { stop: () => {} };
  }

  let skipped = false;
  let interrupted = false;
  let frameIndex = 0;
  let rawModeEnabled = false;
  let stopped = false;
  const cleanup = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    stdin.off("data", onData);
    if (rawModeEnabled && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
    stdin.pause();
    stdout.write("\r\u001b[2K");
  };
  const onData = (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.includes(2)) {
      skipped = true;
    }
    if (buffer.includes(3)) {
      interrupted = true;
      cleanup();
      (input.onInterrupt ?? (() => process.kill(process.pid, "SIGINT")))();
    }
  };

  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
    rawModeEnabled = true;
  }
  stdin.resume();
  stdin.on("data", onData);

  const render = (poll: DaemonStartupWaitPoll) => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? DEFAULT_SPINNER_FRAME;
    frameIndex += 1;
    stdout.write(`\r\u001b[2K${renderStartupWaitLine({
      elapsedMs: poll.elapsedMs,
      timeoutMs: poll.timeoutMs,
      frame,
    })}`);
  };

  return {
    wait: {
      onPoll: render,
      shouldStopWaiting: () => {
        if (interrupted) {
          throw new Error("startup wait interrupted");
        }
        return skipped;
      },
    },
    stop: cleanup,
  };
}
