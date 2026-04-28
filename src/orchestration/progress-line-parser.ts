const PROGRESS_PREFIX = "[PROGRESS]";

export class ProgressLineBuffer {
  feed(segment: string): string[] {
    const summaries: string[] = [];
    for (const line of segment.split("\n")) {
      if (line.startsWith(PROGRESS_PREFIX)) {
        const summary = line.slice(PROGRESS_PREFIX.length).trim();
        if (summary.length > 0) {
          summaries.push(summary);
        }
      }
    }
    return summaries;
  }
}

export function stripProgressLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith(PROGRESS_PREFIX))
    .join("\n")
    .trim();
}
