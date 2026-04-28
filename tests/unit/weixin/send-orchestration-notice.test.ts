import { expect, mock, test } from "bun:test";

import { sendOrchestrationTaskNotice } from "../../../src/weixin/messaging/send-orchestration-notice";

test("sends a completion notice for a completed task with reply context", async () => {
  const sendMessage = mock(async () => ({ messageId: "msg-1" }));

  await sendOrchestrationTaskNotice(
    {
      taskId: "task-1",
      status: "completed",
      workerSession: "backend:claude:backend:main",
      resultText: "ok",
      summary: "",
      chatKey: "wx:user",
      replyContextToken: "ctx-123",
    } as never,
    {
      baseUrl: "https://example.com",
      token: "test-token",
      contextToken: "ctx-123",
      sendMessage,
    },
  );

  expect(sendMessage).toHaveBeenCalledWith({
    to: "wx:user",
    text: expect.stringContaining("结果：ok"),
    opts: expect.objectContaining({ contextToken: "ctx-123" }),
  });
});

test("does not send a notice when chat reply context is missing", async () => {
  const sendMessage = mock(async () => ({ messageId: "msg-1" }));

  await sendOrchestrationTaskNotice(
    {
      taskId: "task-1",
      status: "completed",
      workerSession: "backend:claude:backend:main",
      resultText: "ok",
      summary: "",
    } as never,
    {
      baseUrl: "https://example.com",
      token: "test-token",
      contextToken: "ctx-123",
      sendMessage,
    },
  );

  expect(sendMessage).not.toHaveBeenCalled();
});

test("sends a failure notice for failed tasks", async () => {
  const sendMessage = mock(async () => ({ messageId: "msg-1" }));

  await sendOrchestrationTaskNotice(
    {
      taskId: "task-1",
      status: "failed",
      workerSession: "backend:claude:backend:main",
      resultText: "",
      summary: "transport failed",
      chatKey: "wx:user",
      replyContextToken: "ctx-123",
    } as never,
    {
      baseUrl: "https://example.com",
      token: "test-token",
      contextToken: "ctx-123",
      sendMessage,
    },
  );

  expect(sendMessage.mock.calls[0]?.[0].text).toContain("执行失败");
  expect(sendMessage.mock.calls[0]?.[0].text).toContain("transport failed");
});
