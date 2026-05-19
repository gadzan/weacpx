/**
 * Markdown-aware chunking for outbound text messages.
 *
 * Goals:
 * - Never split inside a fenced code block (```...```).
 * - Never split inside a pipe-table block (including tables fragmented by
 *   block streaming blank lines).
 * - Keep display math blocks and diagram fences intact where possible.
 * - Otherwise prefer paragraph (\n\n) → line (\n) → space boundaries when a
 *   chunk overshoots maxChars, falling back to a hard cut as last resort.
 *
 * A few helpers are exported because the outbound queue receives model output
 * as multiple small blocks and needs to repair block-streaming artifacts before
 * chunking.
 */

export interface AtomicBlock {
  /** Start offset (inclusive). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  kind: "code-fence" | "table" | "math-block";
}

const TABLE_LINE_RE = /^\s*\|/;
const TABLE_SEPARATOR_RE = /^\s*\|[\s|:-]+\|\s*$/;
const PIPE_TABLE_SEPARATOR_RE = /\|[\s]*:?-{2,}:?[\s]*(?:\|[\s]*:?-{2,}:?[\s]*)+\|/;

export function stripOuterMarkdownFence(text: string): string {
  const hasTable = /^\s*\|[-:| ]+\|/m;
  return text.replace(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/gm, (fullMatch, inner: string) => (
    hasTable.test(inner) ? inner : fullMatch
  ));
}

/** Returns true when the text has an odd number of ``` fence markers (line-prefix). */
export function hasUnclosedFence(text: string): boolean {
  let open = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) open = !open;
  }
  return open;
}

/** Returns true when the text has an unclosed display math ($$) block outside code fences. */
export function hasUnclosedMathBlock(text: string): boolean {
  let inFence = false;
  let mathOpen = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let idx = 0;
    while (idx < line.length - 1) {
      if (line[idx] === "$" && line[idx + 1] === "$") {
        mathOpen = !mathOpen;
        idx += 2;
      } else {
        idx++;
      }
    }
  }
  return mathOpen;
}

/** Collapse accidental blank paragraphs inside display math blocks. */
export function normalizeMathBlocks(text: string): string {
  if (!text.includes("$$")) return text;

  const parts: string[] = [];
  let inFence = false;
  let mathOpen = false;
  let segStart = 0;

  for (let i = 0; i < text.length; i++) {
    if ((i === 0 || text[i - 1] === "\n") && text.startsWith("```", i)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (text[i] === "$" && i + 1 < text.length && text[i + 1] === "$") {
      if (!mathOpen) {
        mathOpen = true;
        parts.push(text.slice(segStart, i + 2));
        segStart = i + 2;
        i++;
      } else {
        parts.push(text.slice(segStart, i).replace(/\n\n+/g, "\n"));
        parts.push("$$");
        segStart = i + 2;
        mathOpen = false;
        i++;
      }
    }
  }

  if (segStart < text.length) {
    const rest = text.slice(segStart);
    parts.push(mathOpen ? rest.replace(/\n\n+/g, "\n") : rest);
  }
  return parts.join("");
}

export function mergeBlockStreamingFences(buffer: string, incoming: string): string {
  const closeRe = /\n```\s*$/;
  const openRe = /^```[^\n]*\n/;
  const normalized = incoming.replace(/\n```\s*```[^\n]*\n/g, "\n");

  if (closeRe.test(buffer) && openRe.test(normalized)) {
    return `${buffer.replace(closeRe, "")}\n${normalized.replace(openRe, "")}`;
  }
  if (hasUnclosedFence(buffer) && openRe.test(normalized)) {
    return `${buffer}\n${normalized.replace(openRe, "")}`;
  }
  return `${buffer}${normalized}`;
}

export function startsWithBlockElement(text: string): boolean {
  const firstLine = (text.trimStart().split("\n")[0] ?? "").trimStart();
  return (
    /^#{1,6}\s/.test(firstLine)
    || firstLine.startsWith("---")
    || firstLine.startsWith("***")
    || firstLine.startsWith("___")
    || firstLine.startsWith("> ")
    || firstLine.startsWith("```")
    || /^[*\-+]\s/.test(firstLine)
    || /^\d+[.)]\s/.test(firstLine)
    || firstLine.startsWith("|")
    || firstLine.startsWith("$$")
  );
}

export function inferBlockSeparator(buffer: string, incoming: string): string {
  if (hasUnclosedFence(buffer) || hasUnclosedMathBlock(buffer) || buffer.endsWith("\n\n")) return "";

  const lastLine = (buffer.trimEnd().split("\n").at(-1) ?? "").trim();
  const firstLine = (incoming.trimStart().split("\n")[0] ?? "").trimStart();

  if (lastLine.startsWith("|") && !lastLine.endsWith("|")) return "";
  if (lastLine.startsWith("|") && !firstLine.startsWith("|") && firstLine.endsWith("|")) return " ";
  if (lastLine.startsWith("|") && firstLine.startsWith("|")) return "\n";
  if (startsWithBlockElement(incoming)) return "\n\n";
  return "";
}

interface PipeTableRegion {
  startLine: number;
  endLine: number;
}

function findPipeTableRegions(lines: string[]): PipeTableRegion[] {
  const regions: PipeTableRegion[] = [];
  let groupStart = -1;
  let lastPipeLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const hasPipe = line.includes("|");
    const isBlank = line.trim() === "";

    if (hasPipe) {
      if (groupStart < 0) groupStart = i;
      lastPipeLine = i;
    } else if (!isBlank && groupStart >= 0) {
      regions.push({ startLine: groupStart, endLine: lastPipeLine });
      groupStart = -1;
      lastPipeLine = -1;
    }
  }

  if (groupStart >= 0) regions.push({ startLine: groupStart, endLine: lastPipeLine });
  return regions;
}

function healPipeTableRegion(regionLines: string[]): string | null {
  if (!regionLines.some((line) => line.trim() === "")) return null;

  const flat = regionLines.join("").replace(/\n/g, "");
  if (!PIPE_TABLE_SEPARATOR_RE.test(flat)) return null;

  const nonBlank = regionLines.filter((line) => line.trim() !== "");
  const result: string[] = [];
  let acc = "";

  for (const line of nonBlank) {
    if (!acc) {
      acc = line;
    } else if (acc.trimEnd().endsWith("|") && line.trimStart().startsWith("|")) {
      result.push(acc);
      acc = line;
    } else {
      acc += line;
    }
  }
  if (acc) result.push(acc);
  return result.join("\n");
}

export function sanitizePipeTables(text: string): string {
  if (!text || !text.includes("|") || !text.includes("\n")) return text;
  if ((text.match(/\|/g) || []).length < 3) return text;

  const lines = text.split("\n");
  const regions = findPipeTableRegions(lines);
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i]!;
    const healed = healPipeTableRegion(lines.slice(region.startLine, region.endLine + 1));
    if (healed !== null) {
      lines.splice(region.startLine, region.endLine - region.startLine + 1, ...healed.split("\n"));
    }
  }
  return lines.join("\n");
}

/**
 * Extract atomic regions that must not be split: complete fenced code blocks
 * display math blocks, and contiguous table-line runs. Returns blocks sorted by
 * start offset.
 */
export function extractAtomicBlocks(text: string): AtomicBlock[] {
  const blocks: AtomicBlock[] = [];
  const lines = text.split("\n");
  let offset = 0;

  let inFence = false;
  let fenceStart = 0;
  let inMath = false;
  let mathStart = 0;
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

    if (line.trimStart().startsWith("$$")) {
      flushTable();
      if (inMath) {
        blocks.push({ start: mathStart, end: lineEnd, kind: "math-block" });
        inMath = false;
      } else {
        inMath = true;
        mathStart = offset;
      }
      offset = lineEnd;
      continue;
    }

    if (inMath) {
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

  const normalized = normalizeMathBlocks(sanitizePipeTables(text));
  const atomic = extractAtomicBlocks(normalized);
  const chunks: string[] = [];
  let pos = 0;

  while (pos < normalized.length) {
    const remaining = normalized.length - pos;
    if (remaining <= maxChars) {
      chunks.push(normalized.slice(pos));
      break;
    }
    const target = pos + maxChars;
    const cut = pickCut(normalized, atomic, pos, target);
    chunks.push(normalized.slice(pos, cut));
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

export function isTableInProgress(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  const lastLine = trimmed.split("\n").at(-1) ?? "";
  return TABLE_LINE_RE.test(lastLine);
}

export const __testing__ = {
  TABLE_SEPARATOR_RE,
  PIPE_TABLE_SEPARATOR_RE,
};
