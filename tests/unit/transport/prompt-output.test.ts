import { expect, test } from "bun:test";

import { getPromptText } from "../../../src/transport/prompt-output";

test("keeps the last extracted reply when prompt exits non-zero without a structured error", () => {
  expect(
    getPromptText({
      code: 1,
      stdout: [
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "abc",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "先做检查。" },
            },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "abc",
            update: {
              sessionUpdate: "tool_call",
              title: "Read file",
            },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "abc",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "让我更新任务状态并继续执行测试验证。" },
            },
          },
        }),
      ].join("\n"),
      stderr: "",
    }),
  ).toBe("让我更新任务状态并继续执行测试验证。");
});
