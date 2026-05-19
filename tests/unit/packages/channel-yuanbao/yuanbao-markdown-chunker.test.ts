import { expect, test } from "bun:test";

import {
  chunkMarkdownAware,
  extractAtomicBlocks,
  endsWithTableRow,
  hasUnclosedFence,
  hasUnclosedMathBlock,
  inferBlockSeparator,
  sanitizePipeTables,
  stripOuterMarkdownFence,
} from "../../../../packages/channel-yuanbao/src/markdown-chunker";

test("hasUnclosedFence returns true when fence markers are imbalanced", () => {
  expect(hasUnclosedFence("```ts\nconst x = 1;\n")).toBe(true);
  expect(hasUnclosedFence("```ts\nconst x = 1;\n```")).toBe(false);
  expect(hasUnclosedFence("no fences here")).toBe(false);
});

test("hasUnclosedFence handles leading whitespace before fence", () => {
  expect(hasUnclosedFence("  ```\nfoo\n  ```")).toBe(false);
});

test("extractAtomicBlocks finds fenced code blocks", () => {
  const text = "before\n```ts\nconst x = 1;\nconst y = 2;\n```\nafter";
  const blocks = extractAtomicBlocks(text);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.kind).toBe("code-fence");
  expect(text.slice(blocks[0]!.start, blocks[0]!.end)).toContain("const x = 1;");
  expect(text.slice(blocks[0]!.start, blocks[0]!.end)).toContain("```");
});

test("extractAtomicBlocks finds contiguous table runs", () => {
  const text = "intro\n| a | b |\n|---|---|\n| 1 | 2 |\nend";
  const blocks = extractAtomicBlocks(text);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.kind).toBe("table");
  expect(text.slice(blocks[0]!.start, blocks[0]!.end)).toContain("| a | b |");
  expect(text.slice(blocks[0]!.start, blocks[0]!.end)).toContain("| 1 | 2 |");
});

test("chunkMarkdownAware returns single chunk when below maxChars", () => {
  expect(chunkMarkdownAware("short", 100)).toEqual(["short"]);
});

test("chunkMarkdownAware prefers paragraph break over hard cut", () => {
  const text = "paragraph one is here.\n\nparagraph two continues with more text after it.";
  const chunks = chunkMarkdownAware(text, 30);
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  expect(chunks[0]!.endsWith("\n\n")).toBe(true);
});

test("chunkMarkdownAware does not split inside a fenced code block", () => {
  const code = "function f() {\n  return 42;\n}";
  const text = `intro paragraph here.\n\n\`\`\`ts\n${code}\n\`\`\`\ntrailing`;
  const chunks = chunkMarkdownAware(text, 30);
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  for (const c of chunks) {
    if (c.includes("```")) {
      const openCount = (c.match(/```/g) || []).length;
      expect(openCount % 2).toBe(0);
    }
  }
});

test("chunkMarkdownAware does not split inside a table", () => {
  const table = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |";
  const text = `intro text that makes the chunker want to split early.\n${table}\ntrailing`;
  const chunks = chunkMarkdownAware(text, 40);
  for (const c of chunks) {
    const inTable = c.includes("|");
    if (inTable) {
      const tableLines = c.split("\n").filter((l) => l.trim().startsWith("|"));
      const otherLines = c.split("\n").filter((l) => !l.trim().startsWith("|") && l.trim() !== "");
      if (tableLines.length === 1 && otherLines.length > 0) {
        throw new Error("chunk contains a single isolated table row");
      }
    }
  }
});

test("chunkMarkdownAware may produce an oversize chunk when one atomic block exceeds maxChars", () => {
  const huge = "```\n" + "x".repeat(500) + "\n```";
  const chunks = chunkMarkdownAware(huge, 50);
  expect(chunks).toEqual([huge]);
});

test("chunkMarkdownAware prefers space over splitting mid-word", () => {
  const chunks = chunkMarkdownAware("abc def ghi jkl", 7);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.join("")).toBe("abc def ghi jkl");
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(7);
  }
});

test("chunkMarkdownAware hard-cuts when no whitespace is present in the window", () => {
  const chunks = chunkMarkdownAware("abcdefghij", 4);
  expect(chunks).toEqual(["abcd", "efgh", "ij"]);
});

test("endsWithTableRow detects buffered partial table flush", () => {
  expect(endsWithTableRow("| a | b |")).toBe(true);
  expect(endsWithTableRow("paragraph")).toBe(false);
  expect(endsWithTableRow("| a | b |\n\n")).toBe(true);
});

test("sanitizePipeTables heals blank-line fragmented pipe tables", () => {
  const fragmented = [
    "| 模型 |",
    "",
    " 得分 |",
    "|---|---|",
    "| A |",
    "",
    " 95 |",
  ].join("\n");
  const healed = sanitizePipeTables(fragmented);
  expect(healed).toContain("| 模型 | 得分 |");
  expect(healed).toContain("| A | 95 |");
});

test("inferBlockSeparator restores markdown block boundaries", () => {
  expect(inferBlockSeparator("heading", "```ts\nx\n```")).toBe("\n\n");
  expect(inferBlockSeparator("| a | b |", "|---|---|")).toBe("\n");
  expect(inferBlockSeparator("| a", " | b |")).toBe("");
});

test("stripOuterMarkdownFence unwraps fenced markdown tables", () => {
  const wrapped = "```markdown\n| a | b |\n|---|---|\n| 1 | 2 |\n```";
  expect(stripOuterMarkdownFence(wrapped)).toBe("| a | b |\n|---|---|\n| 1 | 2 |");
});

test("hasUnclosedMathBlock ignores code fences", () => {
  expect(hasUnclosedMathBlock("$$\nx=1")).toBe(true);
  expect(hasUnclosedMathBlock("$$\nx=1\n$$")).toBe(false);
  expect(hasUnclosedMathBlock("```\n$$\n```")).toBe(false);
});
