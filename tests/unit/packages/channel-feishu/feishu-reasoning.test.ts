import { expect, test } from "bun:test";

import { splitReasoningText, stripReasoningTags } from "../../../../packages/channel-feishu/src/card/reasoning";

test("splitReasoningText extracts <think> content + cleans answer", () => {
  const { reasoningText, answerText } = splitReasoningText("<think>weighing options</think>The answer is 42.");
  expect(reasoningText).toBe("weighing options");
  expect(answerText).toBe("The answer is 42.");
});

test("splitReasoningText handles <thinking> alias", () => {
  const { reasoningText, answerText } = splitReasoningText("<thinking>step a\nstep b</thinking>final");
  expect(reasoningText).toBe("step a\nstep b");
  expect(answerText).toBe("final");
});

test("splitReasoningText handles unclosed tag (still streaming)", () => {
  const { reasoningText, answerText } = splitReasoningText("<think>halfway through");
  expect(reasoningText).toBe("halfway through");
  expect(answerText).toBeUndefined();
});

test("splitReasoningText reads 'Reasoning:\\n_…_' prefix format", () => {
  const { reasoningText, answerText } = splitReasoningText("Reasoning:\n_first thought_\n_second thought_");
  expect(reasoningText).toBe("first thought\nsecond thought");
  expect(answerText).toBeUndefined();
});

test("splitReasoningText returns only answer for plain text", () => {
  const { reasoningText, answerText } = splitReasoningText("just an answer");
  expect(reasoningText).toBeUndefined();
  expect(answerText).toBe("just an answer");
});

test("splitReasoningText returns empty for empty input", () => {
  expect(splitReasoningText("")).toEqual({});
  expect(splitReasoningText(undefined)).toEqual({});
});

test("stripReasoningTags removes orphan close tags too", () => {
  expect(stripReasoningTags("hello</think>world")).toBe("helloworld");
  expect(stripReasoningTags("<think>x</think>final")).toBe("final");
});
