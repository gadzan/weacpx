// Time-window batching + tool-call folding for streaming reply segments.
//
// The streaming transport emits one segment per agent_message_chunk paragraph
// or per tool_call event (e.g. "📖 path/to/file" / "🔍 query"). On WeChat
// outbound we only have a 9-message budget per inbound user message, so we
// batch nearby segments and fold consecutive identical tool-call lines into
// "<prefix> <tail> (×N)" before handing them to the reply path.

export interface SegmentAggregatorOptions {
  // Either a fixed window (legacy / test usage) or a function evaluated each
  // time we need a fresh window. The function form lets callers (e.g. the
  // quota-gated reply sink) widen the flush cadence as the per-chatKey mid
  // budget drains, so a long task can not blow through all mid slots in the
  // first burst and leave the user in a silent hole until the final answer.
  windowMs: number | (() => number);
  flush: (text: string) => void;
  now?: () => number;
}

interface FoldedRun {
  prefix: string; // first space-separated token (typically the emoji)
  tail: string; // remainder of the segment after the prefix
  count: number;
}

export class SegmentAggregator {
  private readonly windowMsOption: number | (() => number);
  private readonly flushCallback: (text: string) => void;
  private readonly now: () => number;
  private runs: FoldedRun[] = [];
  private lastFlushAt: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finalized = false;

  constructor(options: SegmentAggregatorOptions) {
    this.windowMsOption = options.windowMs;
    this.flushCallback = options.flush;
    this.now = options.now ?? (() => Date.now());
    this.lastFlushAt = this.now();
  }

  private nextWindow(): number {
    return typeof this.windowMsOption === "function" ? this.windowMsOption() : this.windowMsOption;
  }

  feed(segment: string): void {
    if (this.finalized) return;
    this.appendSegment(segment);

    // The active window is evaluated at decision time. For adaptive callers
    // this intentionally means: after each flush/reservation, the next segment
    // burst is governed by the latest quota state (e.g. midUsed).
    if (this.now() - this.lastFlushAt >= this.nextWindow()) {
      this.flushNow();
      return;
    }

    this.resetTimer();
  }

  finalize(): string {
    this.finalized = true;
    this.clearTimer();
    const text = this.render();
    this.runs = [];
    return text;
  }

  private appendSegment(segment: string): void {
    const { prefix, tail } = splitPrefix(segment);
    const last = this.runs[this.runs.length - 1];
    if (last && last.prefix === prefix && last.tail === tail) {
      last.count += 1;
      return;
    }
    this.runs.push({ prefix, tail, count: 1 });
  }

  private flushNow(): void {
    this.clearTimer();
    if (this.runs.length === 0) return;
    const text = this.render();
    this.runs = [];
    this.lastFlushAt = this.now();
    this.flushCallback(text);
  }

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.finalized) return;
      this.flushNow();
    }, this.nextWindow());
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private render(): string {
    return this.runs.map(renderRun).join("\n");
  }
}

function splitPrefix(segment: string): { prefix: string; tail: string } {
  // Prefix = first two whitespace-separated tokens (e.g. "📖 read" or
  // "📖 src/foo.ts" — depends on the upstream format). Multi-codepoint
  // emoji are preserved because we slice at ASCII space boundaries only.
  const first = segment.indexOf(" ");
  if (first === -1) {
    return { prefix: segment, tail: "" };
  }
  const second = segment.indexOf(" ", first + 1);
  if (second === -1) {
    return { prefix: segment, tail: "" };
  }
  return { prefix: segment.slice(0, second), tail: segment.slice(second + 1) };
}

function renderRun(run: FoldedRun): string {
  const head = run.tail.length > 0 ? `${run.prefix} ${run.tail}` : run.prefix;
  return run.count > 1 ? `${head} (×${run.count})` : head;
}
