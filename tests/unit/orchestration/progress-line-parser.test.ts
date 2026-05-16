import { expect, test } from "bun:test";
import {
  MAX_PROGRESS_SUMMARY_LENGTH,
  ProgressLineBuffer,
  sanitizeProgressSummary,
  stripProgressLines,
} from "../../../src/orchestration/progress-line-parser";

test("extracts progress summaries from a trimmed paragraph segment", () => {
  const buffer = new ProgressLineBuffer();
  const result = buffer.feed("[PROGRESS] analyzing types\nSome other output\n[PROGRESS] found 2 issues\n");
  expect(result).toEqual(["analyzing types", "found 2 issues"]);
});

test("flushes progress when the final segment has no trailing newline", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("[PROGRESS] step 1 done")).toEqual([]);
  expect(buffer.flush()).toEqual(["step 1 done"]);
});

test("ignores non-progress segments regardless of newline shape", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("regular output")).toEqual([]);
  expect(buffer.feed("more\n[NOTPROGRESS] nope\nmore text")).toEqual([]);
});

test("buffers progress lines across chunk boundaries", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("preamble")).toEqual([]);
  expect(buffer.feed("\n[PRO")).toEqual([]);
  expect(buffer.feed("GRESS] second")).toEqual([]);
  expect(buffer.feed(" segment\n")).toEqual(["second segment"]);
});

test("extracts progress lines after ordinary output in the same chunk", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("ordinary output\n[PROGRESS] step after output\n")).toEqual(["step after output"]);
});

test("drops progress markers with empty summaries", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("[PROGRESS]   \n")).toEqual([]);
});

test("sanitizes and caps progress summaries", () => {
  expect(sanitizeProgressSummary(" \u0000reading\u0007 files ")).toBe("reading files");
  const long = "x".repeat(MAX_PROGRESS_SUMMARY_LENGTH + 10);
  expect(sanitizeProgressSummary(long)).toHaveLength(MAX_PROGRESS_SUMMARY_LENGTH);
  expect(sanitizeProgressSummary(long).endsWith("...")).toBe(true);
});

test("strips progress lines from final text", () => {
  const text = "[PROGRESS] analyzing types\n[PROGRESS] found 2 issues\nHere is my review:\nAll looks good.";
  expect(stripProgressLines(text)).toBe("Here is my review:\nAll looks good.");
});

test("strips CRLF and carriage-return progress lines from final text", () => {
  const text = "[PROGRESS] analyzing\r\n\r[PROGRESS] updating\r\nDone.";
  expect(stripProgressLines(text)).toBe("Done.");
});

test("strips ANSI-prefixed progress lines from final text", () => {
  const text = "\u001B[2K[PROGRESS] redrawing\nDone.";
  expect(stripProgressLines(text)).toBe("Done.");
});

test("drops long non-progress pending chunks without newline", () => {
  const buffer = new ProgressLineBuffer();
  expect(buffer.feed("x".repeat(5000))).toEqual([]);
  expect(buffer.flush()).toEqual([]);
  expect(buffer.feed("[PRO")).toEqual([]);
  expect(buffer.feed("GRESS] recovered\n")).toEqual(["recovered"]);
});

test("returns empty string when all lines are progress", () => {
  expect(stripProgressLines("[PROGRESS] step 1\n[PROGRESS] step 2\n")).toBe("");
});

test("handles text without progress lines", () => {
  expect(stripProgressLines("normal output")).toBe("normal output");
});
