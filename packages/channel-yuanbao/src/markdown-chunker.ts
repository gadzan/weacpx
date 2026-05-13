/**
 * Markdown-aware chunking for outbound text messages.
 *
 * Goals:
 * - Never split inside a fenced code block (```...```).
 * - Never split inside a pipe-table block (consecutive `| ... |` lines, with or
 *   without a separator row).
 * - Otherwise prefer paragraph (\n\n) → line (\n) → space boundaries when a
 *   chunk overshoots maxChars, falling back to a hard cut as last resort.
 *
 * What we deliberately do NOT do (kept as future work):
 * - Math block ($$ ... $$) protection
 * - Diagram fences (mermaid/plantuml) as atomic blocks
 * - Pipe-table repair for blank-line-fragmented tables
 */

export interface AtomicBlock {
  /** Start offset (inclusive). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  kind: "code-fence" | "table";
}

const TABLE_LINE_RE = /^\s*\|/;
const TABLE_SEPARATOR_RE = /^\s*\|[\s|:-]+\|\s*$/;

/** Returns true when the text has an odd number of ``` fence markers (line-prefix). */
export function hasUnclosedFence(text: string): boolean {
  let open = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) open = !open;
  }
  return open;
}

/**
 * Extract atomic regions that must not be split: complete fenced code blocks
 * and contiguous table-line runs. Returns blocks sorted by start offset.
 */
export function extractAtomicBlocks(text: string): AtomicBlock[] {
  const blocks: AtomicBlock[] = [];
  const lines = text.split("\n");
  let offset = 0;

  let inFence = false;
  let fenceStart = 0;
  let tableStart = -1;
  let tableEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineEnd = offset + line.length + (i < lines.length - 1 ? 1 : 0);
    const startsFence = line.trimStart().startsWith("```");

    if (inFence) {
      if (startsFence) {
        blocks.push({ start: fenceStart, end: lineEnd, kind: "code-fence" });
        inFence = false;
      }
      offset = lineEnd;
      continue;
    }

    if (startsFence) {
      flushTable();
      inFence = true;
      fenceStart = offset;
      offset = lineEnd;
      continue;
    }

    if (TABLE_LINE_RE.test(line)) {
      if (tableStart === -1) tableStart = offset;
      tableEnd = lineEnd;
    } else {
      flushTable();
    }

    offset = lineEnd;
  }
  flushTable();

  return blocks;

  function flushTable(): void {
    if (tableStart !== -1 && tableEnd !== -1) {
      blocks.push({ start: tableStart, end: tableEnd, kind: "table" });
    }
    tableStart = -1;
    tableEnd = -1;
  }
}

/**
 * Split `text` into chunks no larger than `maxChars` while preserving atomic
 * blocks. May produce a chunk larger than maxChars only when a single atomic
 * block is itself larger — callers that need a hard cap should handle that
 * case explicitly (e.g. by treating `overflowPolicy: "stop"` as an error).
 */
export function chunkMarkdownAware(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const atomic = extractAtomicBlocks(text);
  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    const remaining = text.length - pos;
    if (remaining <= maxChars) {
      chunks.push(text.slice(pos));
      break;
    }
    const target = pos + maxChars;
    const cut = pickCut(text, atomic, pos, target);
    chunks.push(text.slice(pos, cut));
    pos = cut;
  }

  return chunks.filter((c) => c.length > 0);
}

function pickCut(text: string, atomic: AtomicBlock[], windowStart: number, target: number): number {
  const overlap = atomic.find((b) => b.start < target && target < b.end);
  if (overlap) {
    if (overlap.start > windowStart) return overlap.start;
    return overlap.end;
  }
  const search = text.slice(windowStart, target);

  const paragraph = search.lastIndexOf("\n\n");
  if (paragraph > 0) return windowStart + paragraph + 2;

  const line = search.lastIndexOf("\n");
  if (line > 0) return windowStart + line + 1;

  const space = search.lastIndexOf(" ");
  if (space > 0) return windowStart + space + 1;

  return target;
}

/**
 * Re-export for callers that want the contiguous-table heuristic without the
 * atomic-block machinery (e.g. queue session deciding whether to defer a flush).
 */
export function endsWithTableRow(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  const lastLine = trimmed.split("\n").at(-1) ?? "";
  return TABLE_LINE_RE.test(lastLine) && lastLine.trimEnd().endsWith("|");
}

export const __testing__ = {
  TABLE_SEPARATOR_RE,
};
