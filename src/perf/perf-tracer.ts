import { randomBytes } from "node:crypto";

import type { AppLogger } from "../logging/app-logger";
import { createPerfLogWriter, type PerfLogWriter } from "./perf-log-writer";

export type SpanOutcome = "ok" | "error" | "aborted";
export type PerfContext = Record<string, string | number | boolean | null | undefined>;

export interface PerfSpan {
  readonly traceId: string;
  mark(event: string, context?: PerfContext): void;
  setOutcome(outcome: SpanOutcome, context?: PerfContext): void;
}

export interface PerfTracer {
  wrapTurn<T>(
    seed: { chatKey: string; kind: "command" | "prompt" },
    run: (span: PerfSpan) => Promise<T>,
  ): Promise<T>;
  flush(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface FormatLineArgs {
  isoNow: Date;
  event: string;
  traceId: string;
  chatKey: string;
  sinceStartMs: number;
  sinceLastMs: number;
  context?: PerfContext;
}

export interface FormatSummaryArgs {
  isoNow: Date;
  traceId: string;
  chatKey: string;
  kind: "command" | "prompt";
  outcome: SpanOutcome;
  totalMs: number;
  marks: Array<{ e: string; t: number }>;
  outcomeContext?: PerfContext;
}

export interface CreatePerfTracerOptions {
  filePath: string;
  maxSizeBytes: number;
  maxFiles: number;
  retentionDays: number;
  appLogger: AppLogger;
  now?: () => number;
  isoNow?: () => Date;
  randomId?: () => string;
  formatLine?: (args: FormatLineArgs) => string;
  formatSummaryLine?: (args: FormatSummaryArgs) => string;
}

const NOOP_SPAN: PerfSpan = {
  traceId: "-",
  mark: () => {},
  setOutcome: () => {},
};

export function createNoopPerfTracer(): PerfTracer {
  return {
    async wrapTurn(_seed, run) {
      return run(NOOP_SPAN);
    },
    async flush() {},
    async cleanup() {},
  };
}

export function createPerfTracer(options: CreatePerfTracerOptions): PerfTracer {
  const now = options.now ?? (() => performance.now());
  const isoNow = options.isoNow ?? (() => new Date());
  const randomId = options.randomId ?? defaultRandomId;
  const formatLine = options.formatLine ?? defaultFormatLine;
  const formatSummary = options.formatSummaryLine ?? defaultFormatSummaryLine;
  let disabled = false;

  const writer: PerfLogWriter = createPerfLogWriter({
    filePath: options.filePath,
    maxSizeBytes: options.maxSizeBytes,
    maxFiles: options.maxFiles,
    retentionDays: options.retentionDays,
    onPermanentFailure: (info) => {
      disabled = true;
      void options.appLogger
        .error(
          "perf.disabled_due_to_io_error",
          "perf logging disabled after repeated IO failures",
          {
            perfLogPath: info.perfLogPath,
            failureCount: info.failureCount,
            lastError: info.lastError,
          },
        )
        .catch(() => {});
    },
  });

  return {
    async wrapTurn(seed, run) {
      if (disabled) {
        return run(NOOP_SPAN);
      }
      const traceId = randomId();
      let startTime: number | undefined;
      const marks: Array<{ e: string; t: number }> = [];
      let lastMarkTime: number | undefined;
      let explicitOutcome: SpanOutcome | undefined;
      let outcomeContext: PerfContext | undefined;

      const span: PerfSpan = {
        traceId,
        mark(event, context) {
          if (disabled) return;
          try {
            const t = now();
            if (startTime === undefined) {
              startTime = t;
              lastMarkTime = t;
            }
            const since = t - startTime;
            const sinceLast = t - lastMarkTime!;
            lastMarkTime = t;
            marks.push({ e: event, t: Math.round(since) });
            const line = formatLine({
              isoNow: isoNow(),
              event,
              traceId,
              chatKey: seed.chatKey,
              sinceStartMs: Math.round(since),
              sinceLastMs: Math.round(sinceLast),
              context,
            });
            writer.enqueue(line);
          } catch {
            // perf mark failures never escape into business code
          }
        },
        setOutcome(outcome, context) {
          explicitOutcome = outcome;
          outcomeContext = context;
        },
      };

      let thrown: unknown;
      try {
        return await run(span);
      } catch (err) {
        thrown = err;
        throw err;
      } finally {
        try {
          if (!disabled) {
            let outcome: SpanOutcome;
            if (explicitOutcome !== undefined) {
              outcome = explicitOutcome;
            } else if (thrown !== undefined) {
              outcome = "error";
            } else {
              outcome = "ok";
            }
            const t = now();
            const effectiveStart = startTime ?? t;
            const summary = formatSummary({
              isoNow: isoNow(),
              traceId,
              chatKey: seed.chatKey,
              kind: seed.kind,
              outcome,
              totalMs: Math.round(t - effectiveStart),
              marks,
              outcomeContext,
            });
            writer.enqueue(summary);
          }
        } catch {
          // never let perf-internal errors mask the business exception
        }
      }
    },
    async flush() {
      await writer.flush();
    },
    async cleanup() {
      await writer.cleanup();
    },
  };
}

function defaultRandomId(): string {
  return randomBytes(6).toString("hex");
}

export function defaultFormatLine(args: FormatLineArgs): string {
  const ctxFields = args.context
    ? Object.entries(args.context)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(" ")
    : "";
  const ctxPrefix = ctxFields ? ` ${ctxFields}` : "";
  return `${args.isoNow.toISOString()} PERF ${args.event} trace=${args.traceId} chatKey=${formatValue(args.chatKey)}${ctxPrefix} sinceStartMs=${args.sinceStartMs} sinceLastMs=${args.sinceLastMs}\n`;
}

export function defaultFormatSummaryLine(args: FormatSummaryArgs): string {
  const extra = args.outcomeContext
    ? " " +
      Object.entries(args.outcomeContext)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(" ")
    : "";
  const marksJson = JSON.stringify(args.marks);
  return `${args.isoNow.toISOString()} PERF turn.done trace=${args.traceId} chatKey=${formatValue(args.chatKey)} kind=${formatValue(args.kind)} outcome=${formatValue(args.outcome)} totalMs=${args.totalMs}${extra} marks=${JSON.stringify(marksJson)}\n`;
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
