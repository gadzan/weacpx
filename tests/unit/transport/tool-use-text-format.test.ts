import { expect, test, describe } from "bun:test";
import {
  createToolUseTextRenderState,
  formatToolUseEventForText,
} from "../../../src/transport/tool-use-text-format";
import {
  createStreamingPromptState,
  parseStreamingChunks,
} from "../../../src/transport/streaming-prompt";
import type { ToolUseEvent } from "../../../src/channels/types";

function makeEvent(overrides: Partial<ToolUseEvent> = {}): ToolUseEvent {
  return {
    toolCallId: "tc-1",
    toolName: "Read File",
    kind: "read",
    status: "success",
    ...overrides,
  };
}

describe("formatToolUseEventForText", () => {
  test("read tool with summary → emoji + name + status + summary", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Read File", kind: "read", summary: "foo.ts", status: "success" }),
      state,
    );
    expect(result).toBe("📖 Read File (success): foo.ts");
  });

  test("execute tool with long summary → truncated when over 60 chars", () => {
    const state = createToolUseTextRenderState();
    const longSummary = "a".repeat(65);
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Bash", kind: "execute", summary: longSummary, status: "running" }),
      state,
    );
    // truncateToolDisplay: slice(0, 57) + "..."
    const expected = `💻 Bash (running): ${"a".repeat(57)}...`;
    expect(result).toBe(expected);
  });

  test("summary equals toolName → no summary suffix", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Search", kind: "search", summary: "Search", status: "success" }),
      state,
    );
    expect(result).toBe("🔍 Search (success)");
  });

  test("no summary at all → no colon suffix", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Edit File", kind: "edit", summary: undefined, status: "running" }),
      state,
    );
    expect(result).toBe("✏️ Edit File (running)");
  });

  test("unknown kind → 🔧 wrench fallback", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Custom Tool", kind: "other", summary: "some/path", status: "success" }),
      state,
    );
    expect(result).toBe("🔧 Custom Tool (success): some/path");
  });

  test("think kind → 🧠 brain emoji", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Think", kind: "think", summary: undefined, status: "running" }),
      state,
    );
    expect(result).toBe("🧠 Think (running)");
  });

  test("same toolCallId twice → second call returns null (dedup)", () => {
    const state = createToolUseTextRenderState();
    const event = makeEvent({ toolCallId: "tc-dup", kind: "read", summary: "bar.ts", status: "running" });
    const first = formatToolUseEventForText(event, state);
    const second = formatToolUseEventForText({ ...event, status: "success" }, state);
    expect(first).toBe("📖 Read File (running): bar.ts");
    expect(second).toBeNull();
  });

  test("empty toolName → null", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "", kind: "read" }),
      state,
    );
    expect(result).toBeNull();
  });

  test("whitespace-only toolName → null", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "   ", kind: "read" }),
      state,
    );
    expect(result).toBeNull();
  });

  test("different toolCallIds with same toolName → both render", () => {
    const state = createToolUseTextRenderState();
    const first = formatToolUseEventForText(
      makeEvent({ toolCallId: "tc-A", toolName: "Read File", summary: "a.ts", status: "success" }),
      state,
    );
    const second = formatToolUseEventForText(
      makeEvent({ toolCallId: "tc-B", toolName: "Read File", summary: "b.ts", status: "success" }),
      state,
    );
    expect(first).toBe("📖 Read File (success): a.ts");
    expect(second).toBe("📖 Read File (success): b.ts");
  });

  test("error status renders correctly", () => {
    const state = createToolUseTextRenderState();
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Bash", kind: "execute", summary: "npm install", status: "error" }),
      state,
    );
    expect(result).toBe("💻 Bash (error): npm install");
  });

  test("state.emittedToolCallIds is updated after render", () => {
    const state = createToolUseTextRenderState();
    expect(state.emittedToolCallIds.size).toBe(0);
    formatToolUseEventForText(makeEvent({ toolCallId: "tc-track" }), state);
    expect(state.emittedToolCallIds.has("tc-track")).toBe(true);
  });

  test("summary exactly at 60 chars → not truncated", () => {
    const state = createToolUseTextRenderState();
    const summary60 = "b".repeat(60);
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Bash", kind: "execute", summary: summary60, status: "success" }),
      state,
    );
    expect(result).toBe(`💻 Bash (success): ${"b".repeat(60)}`);
  });

  test("summary at 61 chars → truncated", () => {
    const state = createToolUseTextRenderState();
    const summary61 = "c".repeat(61);
    const result = formatToolUseEventForText(
      makeEvent({ toolName: "Bash", kind: "execute", summary: summary61, status: "success" }),
      state,
    );
    expect(result).toBe(`💻 Bash (success): ${"c".repeat(57)}...`);
  });

  // --- documented divergence tests ---

  test("documented divergence: helper uses normalized status, parser uses raw acpx status", () => {
    // Drive the same tool_call through the parser in text mode.
    const parserState = createStreamingPromptState(true);
    parseStreamingChunks(parserState, JSON.stringify({
      method: "session/update",
      params: { update: {
        sessionUpdate: "tool_call",
        title: "Read File",
        kind: "read",
        toolCallId: "tc-1",
        rawInput: { path: "foo.ts" },
        status: "completed",
      } },
    }));
    expect(parserState.segments).toHaveLength(1);
    const parserOutput = parserState.segments[0];

    // Drive the equivalent ToolUseEvent through the helper.
    const helperState = createToolUseTextRenderState();
    const helperOutput = formatToolUseEventForText({
      toolCallId: "tc-1",
      toolName: "Read File",
      kind: "read",
      summary: "foo.ts",
      status: "success", // ToolUseEvent's normalized form of "completed"
    }, helperState);

    expect(helperOutput).not.toBeNull();
    // Documented divergence: helper uses normalized status text.
    expect(helperOutput).toContain("(success)");
    // The legacy parser keeps raw acpx status text.
    expect(parserOutput).toContain("(completed)");
  });

  test("documented divergence: helper does not skip generic-pending placeholders", () => {
    // The parser skips a pending tool_call with no useful input (placeholder).
    const parserState = createStreamingPromptState(true);
    parseStreamingChunks(parserState, JSON.stringify({
      method: "session/update",
      params: { update: {
        sessionUpdate: "tool_call",
        title: "Read File",
        kind: "read",
        toolCallId: "tc-pending",
        rawInput: {},
        status: "pending",
      } },
    }));
    // Parser produces no segment — the placeholder-skip heuristic suppressed it.
    expect(parserState.segments).toHaveLength(0);

    // The helper has no access to update.status === "pending", so it cannot skip.
    // A caller would need to pre-filter before invoking the helper.
    const helperState = createToolUseTextRenderState();
    const helperOutput = formatToolUseEventForText({
      toolCallId: "tc-pending",
      toolName: "Read File",
      kind: "read",
      status: "running", // normalized form of "pending"
    }, helperState);
    // Helper does NOT skip — it renders the event.
    expect(helperOutput).not.toBeNull();
    expect(helperOutput).toContain("Read File");
  });
});
