import { expect, test } from "bun:test";

import { getPromptText } from "../../../src/transport/prompt-output";

function messageChunk(text: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function toolCall(title: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: { sessionUpdate: "tool_call", title },
    },
  });
}

test("concatenates agent message chunks split by an interleaved tool call", () => {
  // Regression: a tool call mid-answer used to fragment the reply so only the
  // trailing fragment survived (delegated-worker resultText corruption).
  expect(
    getPromptText({
      code: 0,
      stdout: [
        messageChunk("I am opencode. Working directory: /repo.\nFiles: "),
        toolCall("List directory"),
        messageChunk("`AGENTS.md`, `README.md`, `package.json`."),
      ].join("\n"),
      stderr: "",
    }),
  ).toBe(
    "I am opencode. Working directory: /repo.\nFiles: `AGENTS.md`, `README.md`, `package.json`.",
  );
});

test("a non-JSON line in the stream does not truncate the agent message", () => {
  expect(
    getPromptText({
      code: 0,
      stdout: [
        messageChunk("Part one. "),
        "warning: some non-json log noise",
        messageChunk("Part two."),
      ].join("\n"),
      stderr: "",
    }),
  ).toBe("Part one. Part two.");
});

test("extracts the full agent reply when prompt exits non-zero without a structured error", () => {
  expect(
    getPromptText({
      code: 1,
      stdout: [
        messageChunk("先做检查。"),
        toolCall("Read file"),
        messageChunk("让我更新任务状态并继续执行测试验证。"),
      ].join("\n"),
      stderr: "",
    }),
  ).toBe("先做检查。让我更新任务状态并继续执行测试验证。");
});
