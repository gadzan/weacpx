import { expect, test } from "bun:test";
import { ProgressLineBuffer, stripProgressLines } from "../../../src/orchestration/progress-line-parser";

test("extracts progress summaries from a trimmed paragraph segment", () => {
  const buffer = new ProgressLineBuffer();
  const result = buffer.feed("[PROGRESS] analyzing types\nSome other output\n[PROGRESS] found 2 issues");
  expect(result).toEqual(["analyzing types", "found 2 issues"]);
});

test("extracts progress when the segment is a single standalone line", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("[PROGRESS] step 1 done")).toEqual(["step 1 done"]);
});

test("ignores non-progress segments regardless of newline shape", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("regular output")).toEqual([]);
  expect(buffer.feed("more\n[NOTPROGRESS] nope\nmore text")).toEqual([]);
});

test("treats each segment independently without cross-segment stitching", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("preamble")).toEqual([]);
  expect(buffer.feed("[PROGRESS] second segment")).toEqual(["second segment"]);
});

test("drops progress markers with empty summaries", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("[PROGRESS]   ")).toEqual([]);
});

test("strips progress lines from final text", () => {
  const text = "[PROGRESS] analyzing types\n[PROGRESS] found 2 issues\nHere is my review:\nAll looks good.";
  expect(stripProgressLines(text)).toBe("Here is my review:\nAll looks good.");
});

test("returns empty string when all lines are progress", () => {
  expect(stripProgressLines("[PROGRESS] step 1\n[PROGRESS] step 2\n")).toBe("");
});

test("handles text without progress lines", () => {
  expect(stripProgressLines("normal output")).toBe("normal output");
});
