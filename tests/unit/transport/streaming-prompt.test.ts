import { expect, test } from "bun:test";
import {
  createStreamingPromptState,
  parseStreamingChunks,
  parseStreamingDataChunk,
} from "../../../src/transport/streaming-prompt";

function makeChunkLine(text: string): string {
  return JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

test("parseStreamingChunks accumulates text and detects paragraph boundary", () => {
  const state = createStreamingPromptState();

  parseStreamingChunks(state, makeChunkLine("Hello"));
  parseStreamingChunks(state, makeChunkLine(" World\n\n"));
  parseStreamingChunks(state, makeChunkLine("New paragraph"));

  expect(state.segments).toEqual(["Hello World"]);
  expect(state.buffer).toBe("New paragraph");
  expect(state.hasAgentMessage).toBe(true);
});

test("parseStreamingChunks handles multiple paragraph boundaries", () => {
  const state = createStreamingPromptState();

  parseStreamingChunks(state, makeChunkLine("Para 1\n\nPara 2\n\nPara 3"));

  expect(state.segments).toEqual(["Para 1", "Para 2"]);
  expect(state.buffer).toBe("Para 3");
});

test("parseStreamingChunks ignores non-chunk JSON lines", () => {
  const state = createStreamingPromptState();

  parseStreamingChunks(state, '{"method":"session/update","params":{"update":{"sessionUpdate":"status","content":{"type":"text","text":"thinking"}}}}');
  parseStreamingChunks(state, makeChunkLine("actual content"));

  expect(state.segments).toEqual([]);
  expect(state.buffer).toBe("actual content");
});

test("parseStreamingChunks ignores non-JSON lines", () => {
  const state = createStreamingPromptState();

  parseStreamingChunks(state, "not json at all");
  parseStreamingChunks(state, makeChunkLine("real content"));

  expect(state.segments).toEqual([]);
  expect(state.buffer).toBe("real content");
});

test("finalize returns remaining buffer", () => {
  const state = createStreamingPromptState();
  parseStreamingChunks(state, makeChunkLine("remaining text"));
  const result = state.finalize();
  expect(result).toBe("remaining text");
});

test("finalize returns empty string when buffer is empty", () => {
  const state = createStreamingPromptState();
  const result = state.finalize();
  expect(result).toBe("");
});

test("parseStreamingDataChunk preserves partial JSON lines across stdout chunks", () => {
  const state = createStreamingPromptState();
  const line = makeChunkLine("split json still works");
  const splitAt = Math.floor(line.length / 2);

  parseStreamingDataChunk(state, line.slice(0, splitAt));
  expect(state.buffer).toBe("");
  expect(state.segments).toEqual([]);

  parseStreamingDataChunk(state, `${line.slice(splitAt)}\n`);

  expect(state.buffer).toBe("split json still works");
  expect(state.segments).toEqual([]);
  expect(state.hasAgentMessage).toBe(true);
});

test("finalize parses a complete pending JSON line when the stream ends without a trailing newline", () => {
  const state = createStreamingPromptState();

  parseStreamingDataChunk(state, makeChunkLine("eof without newline"));

  const result = state.finalize();

  expect(result).toBe("eof without newline");
  expect(state.pendingLine).toBe("");
  expect(state.hasAgentMessage).toBe(true);
});
