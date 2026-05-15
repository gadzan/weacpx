import { appendFile as fsAppendFile, mkdir as fsMkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { rotateIfNeeded, cleanupExpiredRotatedLogs } from "../logging/rotating-file-writer";

export interface PerfPermanentFailure {
  perfLogPath: string;
  failureCount: number;
  lastError: string;
}

export interface CreatePerfLogWriterOptions {
  filePath: string;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays?: number;
  onPermanentFailure: (info: PerfPermanentFailure) => void;
  failureThreshold?: number;
  // Test hooks
  appendImpl?: (path: string, data: string) => Promise<void>;
  mkdirImpl?: (path: string, opts: { recursive: true }) => Promise<void>;
  now?: () => Date;
}

export interface PerfLogWriter {
  enqueue(line: string): void;
  flush(): Promise<void>;
  cleanup(): Promise<void>;
  isDisabled(): boolean;
}

export function createPerfLogWriter(options: CreatePerfLogWriterOptions): PerfLogWriter {
  const append = options.appendImpl ?? ((p, d) => fsAppendFile(p, d, "utf8"));
  const mkdir = options.mkdirImpl ?? ((p, o) => fsMkdir(p, o).then(() => undefined));
  const now = options.now ?? (() => new Date());
  const threshold = options.failureThreshold ?? 5;

  let pending: string[] = [];
  let writeChain: Promise<void> = Promise.resolve();
  let consecutiveFailures = 0;
  let disabled = false;

  const writer: PerfLogWriter = {
    enqueue(line) {
      if (disabled) return;
      pending.push(line);
      void scheduleDrain();
    },
    async flush() {
      await scheduleDrain();
      await writeChain;
    },
    async cleanup() {
      if (disabled) return;
      try {
        await cleanupExpiredRotatedLogs(options.filePath, options.retentionDays ?? 7, now);
      } catch {
        /* swallow */
      }
    },
    isDisabled() {
      return disabled;
    },
  };

  return writer;

  function scheduleDrain(): Promise<void> {
    if (disabled || pending.length === 0) {
      return writeChain;
    }
    const batch = pending;
    pending = [];
    writeChain = writeChain.catch(() => {}).then(() => drainBatch(batch));
    return writeChain;
  }

  async function drainBatch(batch: string[]): Promise<void> {
    if (disabled) return;
    const data = batch.join("");
    try {
      await mkdir(dirname(options.filePath), { recursive: true });
      await rotateIfNeeded(options.filePath, Buffer.byteLength(data), options.maxSizeBytes, options.maxFiles);
      await append(options.filePath, data);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold) {
        disabled = true;
        pending = [];
        options.onPermanentFailure({
          perfLogPath: options.filePath,
          failureCount: consecutiveFailures,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
