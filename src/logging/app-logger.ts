import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { LoggingLevel } from "../config/types";

const LEVEL_ORDER: Record<LoggingLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
};

interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

interface CreateAppLoggerOptions {
  filePath: string;
  level: LoggingLevel;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays: number;
  now?: () => Date;
}

export interface AppLogger {
  debug: (event: string, message: string, context?: LogContext) => Promise<void>;
  info: (event: string, message: string, context?: LogContext) => Promise<void>;
  error: (event: string, message: string, context?: LogContext) => Promise<void>;
  cleanup: () => Promise<void>;
}

export function createNoopAppLogger(): AppLogger {
  return {
    debug: async () => {},
    info: async () => {},
    error: async () => {},
    cleanup: async () => {},
  };
}

export function createAppLogger(options: CreateAppLoggerOptions): AppLogger {
  const now = options.now ?? (() => new Date());

  return {
    debug: async (event, message, context) => {
      await writeLog("debug", event, message, context);
    },
    info: async (event, message, context) => {
      await writeLog("info", event, message, context);
    },
    error: async (event, message, context) => {
      await writeLog("error", event, message, context);
    },
    cleanup: async () => {
      await cleanupExpiredRotatedLogs(options.filePath, options.retentionDays, now);
    },
  };

  async function writeLog(
    level: LoggingLevel,
    event: string,
    message: string,
    context: LogContext = {},
  ): Promise<void> {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[options.level]) {
      return;
    }

    const line = formatLogLine(now(), level, event, message, context);
    await mkdir(dirname(options.filePath), { recursive: true });
    await rotateIfNeeded(options.filePath, Buffer.byteLength(line), options.maxSizeBytes, options.maxFiles);
    await appendFile(options.filePath, line, "utf8");
  }
}

async function rotateIfNeeded(
  filePath: string,
  incomingSize: number,
  maxSizeBytes: number,
  maxFiles: number,
): Promise<void> {
  let currentSize = 0;
  try {
    currentSize = (await stat(filePath)).size;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  if (currentSize + incomingSize <= maxSizeBytes) {
    return;
  }

  if (currentSize === 0) {
    return;
  }

  if (maxFiles <= 0) {
    await rm(filePath, { force: true });
    return;
  }

  await rm(`${filePath}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    try {
      await rename(source, `${filePath}.${index + 1}`);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  await rename(filePath, `${filePath}.1`);
}

async function cleanupExpiredRotatedLogs(
  filePath: string,
  retentionDays: number,
  now: () => Date,
): Promise<void> {
  const parentDir = dirname(filePath);
  const prefix = `${basename(filePath)}.`;
  const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;

  let files: string[] = [];
  try {
    files = await readdir(parentDir);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  for (const file of files) {
    if (!file.startsWith(prefix) || !/^\d+$/.test(file.slice(prefix.length))) {
      continue;
    }

    const candidate = join(parentDir, file);
    const details = await stat(candidate);
    if (details.mtime.getTime() < cutoff) {
      await rm(candidate, { force: true });
    }
  }
}

function formatLogLine(
  time: Date,
  level: LoggingLevel,
  event: string,
  message: string,
  context: LogContext,
): string {
  const fields = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);

  const suffix = fields.length > 0 ? ` ${fields.join(" ")}` : "";
  return `${time.toISOString()} ${level.toUpperCase()} ${event} message=${formatValue(message)}${suffix}\n`;
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
