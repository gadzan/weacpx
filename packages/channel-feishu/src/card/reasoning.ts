/**
 * Reasoning text splitting for `<think>...</think>` / `<thinking>...</thinking>` /
 * `<thought>...</thought>` blocks and the `Reasoning:\n_…_` prefix format.
 *
 * Mirrors openclaw-lark's `splitReasoningText` / `stripReasoningTags` so cards
 * can render a separate reasoning area above the answer body.
 */

const REASONING_PREFIX = "Reasoning:\n";

export interface ReasoningSplit {
  reasoningText?: string;
  answerText?: string;
}

export function splitReasoningText(text?: string): ReasoningSplit {
  if (typeof text !== "string" || !text.trim()) return {};

  const trimmed = text.trim();

  if (trimmed.startsWith(REASONING_PREFIX) && trimmed.length > REASONING_PREFIX.length) {
    return { reasoningText: cleanReasoningPrefix(trimmed) };
  }

  const taggedReasoning = extractThinkingContent(text);
  const strippedAnswer = stripReasoningTags(text);
  if (!taggedReasoning && strippedAnswer === text) {
    return { answerText: text };
  }
  return {
    ...(taggedReasoning ? { reasoningText: taggedReasoning } : {}),
    ...(strippedAnswer ? { answerText: strippedAnswer } : {}),
  };
}

function extractThinkingContent(text: string): string {
  if (!text) return "";
  const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  let result = "";
  let lastIndex = 0;
  let inThinking = false;
  for (const match of text.matchAll(scanRe)) {
    const idx = match.index ?? 0;
    if (inThinking) {
      result += text.slice(lastIndex, idx);
    }
    inThinking = match[1] !== "/";
    lastIndex = idx + match[0].length;
  }
  if (inThinking) {
    result += text.slice(lastIndex);
  }
  return result.trim();
}

export function stripReasoningTags(text: string): string {
  let result = text.replace(
    /<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi,
    "",
  );
  result = result.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*$/gi, "");
  result = result.replace(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, "");
  return result.trim();
}

function cleanReasoningPrefix(text: string): string {
  let cleaned = text.replace(/^Reasoning:\s*/i, "");
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/^_(.+)_$/, "$1"))
    .join("\n");
  return cleaned.trim();
}
