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

export function createYuanbaoLog(module: string, sink?: LogSink | AppLogger): ModuleLog {
  const eventBase = `yuanbao.${module}`;
  return {
    info: (msg, context) => {
      if (isAppLogger(sink)) void sink.info(`${eventBase}.info`, msg, context as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.info?.(msg, context);
    },
    warn: (msg, context) => {
      if (isAppLogger(sink)) void sink.info(`${eventBase}.warn`, msg, context as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.warn?.(msg, context);
    },
    error: (msg, context) => {
      if (isAppLogger(sink)) void sink.error(`${eventBase}.error`, msg, context as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.error?.(`${msg}${stringifyContext(context)}`);
    },
    debug: (msg, context) => {
      if (isAppLogger(sink)) void sink.debug(`${eventBase}.debug`, msg, context as Record<string, string | number | boolean | undefined> | undefined);
      else sink?.debug?.(msg, context);
    },
  };
}
