import { expect, test } from "bun:test";

import {
  CARD_BODY_MAX_CHARS,
  STREAMING_ELEMENT_ID,
  buildCard,
  buildCardMessageContent,
  formatElapsedMs,
  truncateForCardBody,
} from "../../../../packages/channel-feishu/src/card/card-builder";

test("buildCard 'thinking' returns streaming-mode card with empty body and processing footer", () => {
  const card = buildCard({ state: "thinking", text: "" }) as {
    schema: string;
    config: { streaming_mode: boolean; summary: { content: string } };
    body: { elements: Array<{ tag: string; element_id?: string; content: string }> };
  };
  expect(card.schema).toBe("2.0");
  expect(card.config.streaming_mode).toBe(true);
  expect(card.config.summary.content).toBe("Processing...");
  expect(card.body.elements[0]).toMatchObject({
    tag: "markdown",
    element_id: STREAMING_ELEMENT_ID,
    content: "",
  });
  expect(card.body.elements[1].content).toContain("处理中");
});

test("buildCard 'streaming' renders text body without footer", () => {
  const card = buildCard({ state: "streaming", text: "hello world" }) as {
    body: { elements: Array<{ content: string; element_id?: string }> };
    config: { streaming_mode: boolean };
  };
  expect(card.config.streaming_mode).toBe(true);
  expect(card.body.elements).toHaveLength(1);
  expect(card.body.elements[0].content).toBe("hello world");
});

test("buildCard 'complete' disables streaming_mode and shows final summary", () => {
  const card = buildCard({ state: "complete", text: "final answer" }) as {
    body: { elements: Array<{ content: string }> };
    config: { streaming_mode: boolean; summary: { content: string } };
  };
  expect(card.config.streaming_mode).toBe(false);
  expect(card.config.summary.content).toBe("Done");
  expect(card.body.elements).toHaveLength(1);
  expect(card.body.elements[0].content).toBe("final answer");
});

test("buildCard 'aborted' shows stopped footer", () => {
  const card = buildCard({ state: "aborted", text: "partial output" }) as {
    body: { elements: Array<{ content: string }> };
    config: { streaming_mode: boolean };
  };
  expect(card.config.streaming_mode).toBe(false);
  expect(card.body.elements[0].content).toBe("partial output");
  expect(card.body.elements[1].content).toContain("已停止");
});

test("buildCard 'error' shows error footer", () => {
  const card = buildCard({ state: "error", text: "stack trace" }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(card.body.elements[1].content).toContain("出错");
});

test("truncateForCardBody clips at the limit and appends marker", () => {
  const long = "a".repeat(CARD_BODY_MAX_CHARS + 100);
  const out = truncateForCardBody(long);
  expect(out.length).toBeLessThanOrEqual(CARD_BODY_MAX_CHARS);
  expect(out.endsWith("(truncated)")).toBe(true);
});

test("truncateForCardBody is a no-op for short text", () => {
  expect(truncateForCardBody("short")).toBe("short");
});

test("buildCard truncates oversized body", () => {
  const long = "x".repeat(CARD_BODY_MAX_CHARS + 500);
  const card = buildCard({ state: "streaming", text: long }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(card.body.elements[0].content.length).toBeLessThanOrEqual(CARD_BODY_MAX_CHARS);
  expect(card.body.elements[0].content.endsWith("(truncated)")).toBe(true);
});

test("buildCardMessageContent wraps card_id in interactive payload", () => {
  expect(buildCardMessageContent("card_abc")).toBe(JSON.stringify({ type: "card", data: { card_id: "card_abc" } }));
});

test("formatElapsedMs formats sub-second / second / minute / mixed", () => {
  expect(formatElapsedMs(0)).toBe("0ms");
  expect(formatElapsedMs(450)).toBe("450ms");
  expect(formatElapsedMs(3400)).toBe("3.4s");
  expect(formatElapsedMs(59_500)).toBe("59.5s");
  expect(formatElapsedMs(60_000)).toBe("1m");
  expect(formatElapsedMs(83_000)).toBe("1m 23s");
});

test("buildCard 'complete' with elapsedMs renders footer", () => {
  const card = buildCard({ state: "complete", text: "ok", elapsedMs: 3400 }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(card.body.elements).toHaveLength(2);
  expect(card.body.elements[1].content).toContain("已完成");
  expect(card.body.elements[1].content).toContain("3.4s");
});

test("buildCard 'complete' without elapsedMs omits the footer", () => {
  const card = buildCard({ state: "complete", text: "ok" }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(card.body.elements).toHaveLength(1);
});

test("buildCard 'aborted' / 'error' embed elapsed when provided", () => {
  const aborted = buildCard({ state: "aborted", text: "...", elapsedMs: 1200 }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(aborted.body.elements[1].content).toContain("已停止");
  expect(aborted.body.elements[1].content).toContain("1.2s");

  const err = buildCard({ state: "error", text: "...", elapsedMs: 800 }) as {
    body: { elements: Array<{ content: string }> };
  };
  expect(err.body.elements[1].content).toContain("出错");
  expect(err.body.elements[1].content).toContain("800ms");
});
