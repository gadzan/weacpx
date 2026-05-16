const PROGRESS_PREFIX = "[PROGRESS]";
export const MAX_PROGRESS_SUMMARY_LENGTH = 500;
const MAX_PENDING_LINE_LENGTH = 4096;

export class ProgressLineBuffer {
  private pending = "";

  feed(segment: string): string[] {
    this.pending += segment;
    if (!PROGRESS_PREFIX.startsWith(this.pending) && !this.pending.startsWith(PROGRESS_PREFIX)) {
      const lastNewlineIndex = Math.max(this.pending.lastIndexOf("\n"), this.pending.lastIndexOf("\r"));
      this.pending = lastNewlineIndex >= 0 ? this.pending.slice(lastNewlineIndex + 1) : "";
    } else if (this.pending.length > MAX_PENDING_LINE_LENGTH) {
      this.pending = "";
    }
    const summaries: string[] = [];
    let newlineIndex = this.pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.pending.slice(0, newlineIndex).replace(/\r$/, "");
      this.pending = this.pending.slice(newlineIndex + 1);
      this.extractLine(line, summaries);
      newlineIndex = this.pending.indexOf("\n");
    }
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
    .split("\n")
    .filter((line) => !normalizeProgressLinePrefix(line).startsWith(PROGRESS_PREFIX))
    .join("\n")
    .trim();
}

function normalizeProgressLinePrefix(line: string): string {
  return line
    .replace(/^\r+/, "")
    .replace(/^\u001B\[[0-9;]*[A-Za-z]/, "");
}
