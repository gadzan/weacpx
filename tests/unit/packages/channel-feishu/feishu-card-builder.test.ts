import { expect, test } from "bun:test";

import {
  CARD_BODY_MAX_CHARS,
  REASONING_ELEMENT_ID,
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

test("buildCard streaming state with elapsedMs renders a ticking footer", () => {
  const card = buildCard({ state: "streaming", text: "abc", elapsedMs: 4_000 });
  const elements = (card.body as { elements: Array<{ content?: string; tag: string }> }).elements;
  const footer = elements[elements.length - 1];
  expect(footer.tag).toBe("markdown");
  expect(footer.content).toContain("处理中");
  expect(footer.content).toContain("4.0s");
});

test("buildCard thinking state with elapsedMs renders elapsed too", () => {
  const card = buildCard({ state: "thinking", text: "", elapsedMs: 1_500 });
  const elements = (card.body as { elements: Array<{ content?: string; tag: string }> }).elements;
  const footer = elements[elements.length - 1];
  expect(footer.content).toContain("1.5s");
});

test("buildCard streaming with no elapsedMs renders no footer (or omits time)", () => {
  const card = buildCard({ state: "streaming", text: "abc" });
  const elements = (card.body as { elements: Array<{ tag: string; element_id?: string; content?: string }> }).elements;
  // The streaming_content element is always present; footer is the only
  // optional trailing markdown. Either there is no footer at all, or it has
  // no time suffix.
  const last = elements[elements.length - 1];
  if (last.element_id !== "streaming_content") {
    expect(last.content ?? "").not.toMatch(/\d+(?:\.\d+)?(?:ms|s|m)/);
  }
});

test("buildCard with toolSteps renders a collapsible panel above the body", () => {
  const card = buildCard({
    state: "streaming",
    text: "hello",
    elapsedMs: 1_000,
    toolSteps: [
      { toolCallId: "t1", toolName: "Read File", kind: "read", summary: "foo.ts", status: "success", startedAt: 0, durationMs: 30 },
      { toolCallId: "t2", toolName: "Bash", kind: "execute", summary: "npm test", status: "running", startedAt: 100 },
    ],
  });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  expect(elements[0].tag).toBe("collapsible_panel");
  expect(String(JSON.stringify(elements[0]))).toContain("Read File");
  expect(String(JSON.stringify(elements[0]))).toContain("foo.ts");
  expect(String(JSON.stringify(elements[0]))).toContain("Bash");
  expect(String(JSON.stringify(elements[0]))).toContain("npm test");
  expect((elements[1] as { tag: string }).tag).toBe("hr");
  expect((elements[2] as { element_id?: string }).element_id).toBe("streaming_content");
});

test("buildCard with no toolSteps omits the panel entirely", () => {
  const card = buildCard({ state: "streaming", text: "hello", elapsedMs: 1_000 });
  const elements = (card.body as { elements: Array<{ tag: string }> }).elements;
  expect(elements.find((el) => el.tag === "collapsible_panel")).toBeUndefined();
});

test("buildCard caps visible tool panel rows while preserving total count", () => {
  const card = buildCard({
    state: "streaming",
    text: "hello",
    elapsedMs: 1_000,
    toolSteps: Array.from({ length: 55 }, (_, i) => ({
      toolCallId: `t${i}`,
      toolName: `Tool ${i}`,
      kind: "other" as const,
      status: "success" as const,
      startedAt: 0,
    })),
  });
  const panel = ((card.body as { elements: Array<Record<string, unknown>> }).elements[0]);
  const serialized = JSON.stringify(panel);
  expect(serialized).toContain("工具调用 (55)");
  expect(serialized).toContain("Tool 49");
  expect(serialized).not.toContain("Tool 50");
  expect(serialized).toContain("还有 5 个工具调用未显示");
});

test("buildCard renders reasoningText as an always-collapsed collapsible_panel", () => {
  const card = buildCard({ state: "streaming", text: "the answer", reasoningText: "step one\nstep two" });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  const panel = elements.find((el) => el.tag === "collapsible_panel");
  expect(panel).toBeDefined();
  expect(panel!.expanded).toBe(false);
  const json = JSON.stringify(panel);
  expect(json).toContain("思考过程");
  expect(json).toContain("step one");
  expect(json).toContain("step two");
  // Inner markdown element keeps the reasoning element id.
  const inner = (panel!.elements as Array<Record<string, unknown>>)[0];
  expect(inner.element_id).toBe(REASONING_ELEMENT_ID);
});

test("buildCard reasoning header shows elapsed when reasoningElapsedMs is provided", () => {
  const card = buildCard({
    state: "streaming",
    text: "the answer",
    reasoningText: "thinking",
    reasoningElapsedMs: 8_400,
  });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  const panel = elements.find((el) => el.tag === "collapsible_panel")!;
  const headerJson = JSON.stringify(panel.header);
  expect(headerJson).toContain("已思考");
  expect(headerJson).toContain("8.4s");
});

test("buildCard reasoning header omits elapsed when reasoningElapsedMs is absent", () => {
  const card = buildCard({ state: "streaming", text: "the answer", reasoningText: "thinking" });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  const panel = elements.find((el) => el.tag === "collapsible_panel")!;
  const headerJson = JSON.stringify(panel.header);
  expect(headerJson).toContain("思考过程");
  expect(headerJson).not.toContain("已思考");
});

test("buildCard reasoning header omits elapsed when reasoningElapsedMs is zero", () => {
  const card = buildCard({
    state: "streaming",
    text: "the answer",
    reasoningText: "thinking",
    reasoningElapsedMs: 0,
  });
  const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
  const panel = elements.find((el) => el.tag === "collapsible_panel")!;
  const headerJson = JSON.stringify(panel.header);
  expect(headerJson).toContain("思考过程");
  expect(headerJson).not.toContain("已思考");
});
