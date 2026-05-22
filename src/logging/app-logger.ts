import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { LoggingLevel } from "../config/types";
import { rotateIfNeeded, cleanupExpiredRotatedLogs } from "./rotating-file-writer";

const LEVEL_ORDER: Record<LoggingLevel, number> = {
  error: 0,
  info: 1,
  debug: 2,
};

type LogContextValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

interface LogContext {
  [key: string]: LogContextValue;
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
  flush: () => Promise<void>;
}

export function createNoopAppLogger(): AppLogger {
  return {
    debug: async () => {},
    info: async () => {},
    error: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  };
}

export function createAppLogger(options: CreateAppLoggerOptions): AppLogger {
  const now = options.now ?? (() => new Date());
  let writeChain = Promise.resolve();
  let modeEnsured = false;

  return {
    debug: async (event, message, context) => {
      await enqueueWrite("debug", event, message, context);
    },
    info: async (event, message, context) => {
      await enqueueWrite("info", event, message, context);
    },
    error: async (event, message, context) => {
      await enqueueWrite("error", event, message, context);
    },
    cleanup: async () => {
      await cleanupExpiredRotatedLogs(options.filePath, options.retentionDays, now);
    },
    flush: async () => {
      await writeChain;
    },
  };

  function enqueueWrite(
    level: LoggingLevel,
    event: string,
    message: string,
    context: LogContext = {},
  ): Promise<void> {
    const writePromise = writeChain.catch(() => {}).then(() => writeLog(level, event, message, context));
    writeChain = writePromise;
    return writePromise;
  }

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
    if (!modeEnsured) {
      // Harden a log file created before 0o600 was enforced. A missing file
      // (first run) throws ENOENT and is ignored — appendFile then creates it
      // at 0o600. Runs once per logger instance.
      modeEnsured = true;
      await chmod(options.filePath, 0o600).catch(() => {});
    }
    await rotateIfNeeded(options.filePath, Buffer.byteLength(line), options.maxSizeBytes, options.maxFiles);
    await appendFile(options.filePath, line, { encoding: "utf8", mode: 0o600 });
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

function formatValue(value: LogContextValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

