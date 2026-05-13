import { expect, test } from "bun:test";
import {
  createStreamingPromptState,
  parseStreamingChunks,
} from "../../../src/transport/streaming-prompt";
import type { ToolUseEvent } from "../../../src/channels/types";

test("when onToolEvent is provided, tool_call events do NOT enter state.segments", () => {
  const events: ToolUseEvent[] = [];
  const state = createStreamingPromptState(true, (e) => events.push(e));
  parseStreamingChunks(
    state,
    JSON.stringify({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "read",
          title: "Read File",
          rawInput: { path: "foo.ts" },
          status: "pending",
        },
      },
    }),
  );
  parseStreamingChunks(
    state,
    JSON.stringify({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          kind: "read",
          title: "Read File",
          rawInput: { path: "foo.ts" },
          status: "completed",
        },
      },
    }),
  );
  expect(state.segments).toEqual([]);
  expect(events).toEqual([
    {
      toolCallId: "t1",
      toolName: "Read File",
      kind: "read",
      summary: "foo.ts",
      status: "running",
    },
    {
      toolCallId: "t1",
      toolName: "Read File",
      kind: "read",
      summary: "foo.ts",
      status: "success",
    },
  ]);
});

test("when onToolEvent is undefined, tool_call still folds into text segments (backward compat)", () => {
  const state = createStreamingPromptState(true);
  parseStreamingChunks(
    state,
    JSON.stringify({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "read",
          title: "Read File",
          rawInput: { path: "foo.ts" },
          status: "completed",
        },
      },
    }),
  );
  expect(state.segments.length).toBe(1);
  expect(state.segments[0]).toContain("Read File");
});
