const PROGRESS_PREFIX = "[PROGRESS]";
export const MAX_PROGRESS_SUMMARY_LENGTH = 500;
const MAX_PENDING_LINE_LENGTH = 4096;

export interface ProgressLineFeedOptions {
  /**
   * True when the caller is passing a complete semantic text segment rather
   * than arbitrary stream bytes. This lets progress paragraphs without a
   * trailing newline surface immediately while keeping the default raw-stream
   * parser conservative about partial chunks.
   */
  segmentComplete?: boolean;
}

export class ProgressLineBuffer {
  private pending = "";

  feed(segment: string, options: ProgressLineFeedOptions = {}): string[] {
    const hadPending = this.pending.length > 0;
    this.pending += segment;
    const summaries: string[] = [];
    let newlineIndex = this.pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.pending.slice(0, newlineIndex).replace(/\r$/, "");
      this.pending = this.pending.slice(newlineIndex + 1);
      this.extractLine(line, summaries);
      newlineIndex = this.pending.indexOf("\n");
    }
    if (options.segmentComplete === true && !hadPending && this.pending.startsWith(PROGRESS_PREFIX)) {
      this.extractLine(this.pending.replace(/\r$/, ""), summaries);
      this.pending = "";
      return summaries;
    }
    this.trimPendingIfHopeless();
    return summaries;
  }

  flush(): string[] {
    const summaries: string[] = [];
    if (this.pending.length > 0) {
      this.extractLine(this.pending.replace(/\r$/, ""), summaries);
      this.pending = "";
    }
    return summaries;
  }

  private extractLine(line: string, summaries: string[]): void {
    if (line.startsWith(PROGRESS_PREFIX)) {
      const summary = sanitizeProgressSummary(line.slice(PROGRESS_PREFIX.length));
      if (summary.length > 0) {
        summaries.push(summary);
      }
    }
  }

  private trimPendingIfHopeless(): void {
    if (this.pending.length === 0) return;
    if (PROGRESS_PREFIX.startsWith(this.pending) || this.pending.startsWith(PROGRESS_PREFIX)) {
      if (this.pending.length > MAX_PENDING_LINE_LENGTH) {
        this.pending = "";
      }
      return;
    }
    this.pending = "";
  }
}

export function sanitizeProgressSummary(summary: string): string {
  const cleaned = summary
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (cleaned.length <= MAX_PROGRESS_SUMMARY_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_PROGRESS_SUMMARY_LENGTH - 3)}...`;
}

export function stripProgressLines(text: string): string {
  return text
    .split(/\r\n|\n|\r/)
    .filter((line) => {
      const normalized = normalizeProgressLinePrefix(line);
      return !normalized.startsWith(PROGRESS_PREFIX) && !(line.length > 0 && normalized.length === 0);
    })
    .join("\n")
    .trim();
}

function normalizeProgressLinePrefix(line: string): string {
  return line.replace(/^(?:\r+|\u001B\[[0-?]*[ -/]*[@-~])+/, "");
}
