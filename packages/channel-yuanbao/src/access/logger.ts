import type { AppLogger } from "weacpx/plugin-api";

export type LogSink = {
  info?: (msg: string, context?: Record<string, unknown>) => void;
  warn?: (msg: string, context?: Record<string, unknown>) => void;
  error?: (msg: string, context?: Record<string, unknown>) => void;
  debug?: (msg: string, context?: Record<string, unknown>) => void;
};

export type ModuleLog = {
  info: (msg: string, context?: Record<string, unknown>) => void;
  warn: (msg: string, context?: Record<string, unknown>) => void;
  error: (msg: string, context?: Record<string, unknown>) => void;
  debug: (msg: string, context?: Record<string, unknown>) => void;
};

function stringifyContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return "";
  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return "";
  }
}

function isAppLogger(sink: LogSink | AppLogger | undefined): sink is AppLogger {
  return Boolean(
    sink &&
    typeof (sink as AppLogger).cleanup === "function" &&
    typeof (sink as AppLogger).flush === "function"
  );
}

const SENSITIVE_KEYS = new Set([
  "token",
  "signature",
  "appkey",
  "app_key",
  "appsecret",
  "app_secret",
  "secret",
  "password",
  "x-token",
  "authorization",
]);

function maskString(value: string): string {
  if (value.length < 8) return "***";
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) {
    if (typeof value === "string") return maskString(value);
    if (value === null || value === undefined) return value;
    return "***";
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? sanitizeRecord(item as Record<string, unknown>)
        : item,
    );
  }
  if (value && typeof value === "object") {
    return sanitizeRecord(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

export function sanitizeLogContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return sanitizeRecord(context);
}

export function createYuanbaoLog(module: string, sink?: LogSink | AppLogger): ModuleLog {
  const eventBase = `yuanbao.${module}`;
  return {
    info: (msg, context) => {
      const safe = sanitizeLogContext(context);
      if (isAppLogger(sink)) void sink.info(`${eventBase}.info`, msg, safe as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.info?.(msg, safe);
    },
    warn: (msg, context) => {
      const safe = sanitizeLogContext(context);
      if (isAppLogger(sink)) void sink.info(`${eventBase}.warn`, msg, safe as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.warn?.(msg, safe);
    },
    error: (msg, context) => {
      const safe = sanitizeLogContext(context);
      if (isAppLogger(sink)) void sink.error(`${eventBase}.error`, msg, safe as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.error?.(`${msg}${stringifyContext(safe)}`);
    },
    debug: (msg, context) => {
      const safe = sanitizeLogContext(context);
      if (isAppLogger(sink)) void sink.debug(`${eventBase}.debug`, msg, safe as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.debug?.(msg, safe);
    },
  };
}
