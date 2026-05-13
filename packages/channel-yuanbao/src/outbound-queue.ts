/**
 * Per-chat outbound text queue.
 *
 * Three strategies:
 * - `immediate`    — every push sends right away (legacy behaviour).
 * - `merge-text`   — buffer pushes, flush when buffer ≥ minChars OR idleMs
 *                    elapses since the last push OR the session is flushed.
 *                    Always splits at fence/table-safe boundaries when the
 *                    buffer exceeds maxChars.
 * - `merge-on-flush` — never send until `flush()` is called (used when
 *                      `disableBlockStreaming: true`).
 *
 * Aborts: `abort()` drops the buffer, prevents future sends, and resolves
 * `flush()` with whatever was already delivered.
 */

import { chunkMarkdownAware, endsWithTableRow, hasUnclosedFence } from "./markdown-chunker.js";

export type OutboundQueueStrategy = "immediate" | "merge-text" | "merge-on-flush";

export interface OutboundQueueSession {
  push(text: string): Promise<void>;
  flush(): Promise<{ sentContent: boolean }>;
  abort(): void;
}

export interface OutboundQueueLog {
  debug?: (msg: string, context?: Record<string, unknown>) => void;
  warn?: (msg: string, context?: Record<string, unknown>) => void;
}

export interface OutboundQueueScheduledTimer {
  cancel: () => void;
}

export type OutboundQueueScheduler = (handler: () => void, ms: number) => OutboundQueueScheduledTimer;

export interface OutboundQueueOptions {
  strategy: OutboundQueueStrategy;
  minChars: number;
  maxChars: number;
  idleMs: number;
  sendText: (text: string) => Promise<void>;
  isAborted?: () => boolean;
  /** Override the chunker (e.g. to enforce `overflowPolicy: "stop"`). */
  chunkText?: (text: string, maxChars: number) => string[];
  /** Override scheduling for tests. Default: setTimeout. */
  schedule?: OutboundQueueScheduler;
  log?: OutboundQueueLog;
}

const defaultSchedule: OutboundQueueScheduler = (handler, ms) => {
  const id = setTimeout(handler, ms);
  return { cancel: () => clearTimeout(id) };
};

function defaultChunk(text: string, maxChars: number): string[] {
  return chunkMarkdownAware(text, maxChars);
}

export function createOutboundQueueSession(opts: OutboundQueueOptions): OutboundQueueSession {
  switch (opts.strategy) {
    case "immediate":
      return createImmediateSession(opts);
    case "merge-on-flush":
      return createMergeOnFlushSession(opts);
    case "merge-text":
    default:
      return createMergeTextSession(opts);
  }
}

function createImmediateSession(opts: OutboundQueueOptions): OutboundQueueSession {
  const chunkText = opts.chunkText ?? defaultChunk;
  const isAborted = opts.isAborted ?? (() => false);
  let aborted = false;
  let sendChain: Promise<void> = Promise.resolve();
  let sentContent = false;

  return {
    push(text) {
      if (aborted || isAborted()) return Promise.resolve();
      if (!text.length) return Promise.resolve();
      const next = sendChain.then(async () => {
        if (aborted || isAborted()) return;
        // chunkText may throw under `overflowPolicy: "stop"`; let it propagate
        // to the caller of push() — sendChain's catch keeps the chain alive.
        const chunks = chunkText(text, opts.maxChars);
        for (const chunk of chunks) {
          if (aborted || isAborted()) return;
          if (!chunk) continue;
          await opts.sendText(chunk);
          sentContent = true;
        }
      });
      sendChain = next.catch(() => {});
      return next;
    },
    async flush() {
      await sendChain;
      return { sentContent };
    },
    abort() {
      aborted = true;
    },
  };
}

function createMergeOnFlushSession(opts: OutboundQueueOptions): OutboundQueueSession {
  const chunkText = opts.chunkText ?? defaultChunk;
  const isAborted = opts.isAborted ?? (() => false);
  let aborted = false;
  let buffer = "";
  let sentContent = false;

  return {
    push(text) {
      if (aborted || isAborted()) return Promise.resolve();
      buffer += text;
      return Promise.resolve();
    },
    async flush() {
      if (aborted || isAborted()) return { sentContent };
      const pending = buffer;
      buffer = "";
      if (!pending) return { sentContent };
      const chunks = chunkText(pending, opts.maxChars);
      for (const chunk of chunks) {
        if (aborted || isAborted()) break;
        if (!chunk.trim()) continue;
        await opts.sendText(chunk);
        sentContent = true;
      }
      return { sentContent };
    },
    abort() {
      aborted = true;
      buffer = "";
    },
  };
}

function createMergeTextSession(opts: OutboundQueueOptions): OutboundQueueSession {
  const chunkText = opts.chunkText ?? defaultChunk;
  const isAborted = opts.isAborted ?? (() => false);
  const schedule = opts.schedule ?? defaultSchedule;
  let aborted = false;
  let buffer = "";
  let sendChain: Promise<void> = Promise.resolve();
  let sentContent = false;
  let idleTimer: OutboundQueueScheduledTimer | null = null;

  const cancelIdle = (): void => {
    idleTimer?.cancel();
    idleTimer = null;
  };

  const armIdle = (): void => {
    cancelIdle();
    if (opts.idleMs <= 0) return;
    idleTimer = schedule(() => {
      idleTimer = null;
      sendChain = sendChain.then(() => drain(true));
    }, opts.idleMs);
  };

  async function drain(force: boolean): Promise<void> {
    if (aborted || isAborted() || !buffer.length) return;

    let chunks: string[];
    try {
      chunks = chunkText(buffer, opts.maxChars);
    } catch (error) {
      // Drop the offending buffer so subsequent pushes can recover — otherwise
      // every future drain would re-throw the same chunker error (e.g. when
      // `overflowPolicy: "stop"` and a single fragment exceeds maxChars).
      buffer = "";
      throw error;
    }

    let toSend: string[];
    if (force || chunks.length > 1) {
      toSend = force ? chunks : chunks.slice(0, -1);
      buffer = force ? "" : chunks[chunks.length - 1]!;
    } else {
      const only = chunks[0]!;
      if (only.length < opts.minChars) return;
      if (hasUnclosedFence(only)) return;
      if (endsWithTableRow(only)) return;
      toSend = chunks;
      buffer = "";
    }

    if (toSend.length === 0) return;
    for (const chunk of toSend) {
      if (aborted || isAborted()) return;
      if (!chunk.trim()) continue;
      await opts.sendText(chunk);
      sentContent = true;
    }
  }

  return {
    push(text) {
      if (aborted || isAborted()) return Promise.resolve();
      if (!text.length) return Promise.resolve();
      buffer += text;
      armIdle();
      const next = sendChain.then(() => drain(false));
      sendChain = next.catch(() => {});
      return next;
    },
    async flush() {
      cancelIdle();
      await sendChain;
      if (aborted || isAborted()) return { sentContent };
      await drain(true);
      return { sentContent };
    },
    abort() {
      cancelIdle();
      aborted = true;
      buffer = "";
    },
  };
}
