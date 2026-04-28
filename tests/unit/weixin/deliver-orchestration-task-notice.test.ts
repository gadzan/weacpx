import { expect, mock, test } from "bun:test";

import { deliverOrchestrationTaskNotice } from "../../../src/weixin/messaging/deliver-orchestration-task-notice";

function createLogger() {
  return {
    debug: mock(async () => {}),
    info: mock(async () => {}),
    error: mock(async () => {}),
    cleanup: mock(async () => {}),
  };
}

test("falls back to another account using that account's context token and persists deliveryAccountId", async () => {
  const logger = createLogger();
  const markDelivered = mock(async () => {});
  const markFailed = mock(async () => {});
  const sendNotice = mock(async (_task, deps) => {
    if (deps.token === "token-origin") {
      throw new Error("origin send failed");
    }
  });

  await deliverOrchestrationTaskNotice(
    {
      taskId: "task-1",
      status: "completed",
      workerSession: "worker-1",
      resultText: "ok",
      summary: "",
      chatKey: "wx:user",
      replyContextToken: "ctx-origin",
      accountId: "acc-origin",
    } as never,
    {
      listAccountIds: () => ["acc-origin", "acc-fallback"],
      resolveAccount: (accountId) => ({
        accountId,
        baseUrl: "https://example.com",
        token: accountId === "acc-origin" ? "token-origin" : "token-fallback",
      }),
      getContextToken: (accountId) => (accountId === "acc-fallback" ? "ctx-fallback" : undefined),
      markDelivered,
      markFailed,
      sendNotice,
      logger: logger as never,
    },
  );

  expect(sendNotice.mock.calls).toHaveLength(2);
  expect(sendNotice.mock.calls[0]?.[1]).toMatchObject({ token: "token-origin", contextToken: "ctx-origin" });
  expect(sendNotice.mock.calls[1]?.[1]).toMatchObject({ token: "token-fallback", contextToken: "ctx-fallback" });
  expect(markDelivered).toHaveBeenCalledWith("task-1", "acc-fallback");
  expect(markFailed).not.toHaveBeenCalled();
  expect(logger.info).toHaveBeenCalled();
});

test("prefers an existing deliveryAccountId on later sends", async () => {
  const logger = createLogger();
  const markDelivered = mock(async () => {});
  const markFailed = mock(async () => {});
  const sendNotice = mock(async (_task, deps) => {
    if (deps.token === "token-origin") {
      throw new Error("origin send failed");
    }
  });

  await deliverOrchestrationTaskNotice(
    {
      taskId: "task-1",
      status: "completed",
      workerSession: "worker-1",
      resultText: "ok",
      summary: "",
      chatKey: "wx:user",
      replyContextToken: "ctx-origin",
      accountId: "acc-origin",
      deliveryAccountId: "acc-fallback",
    } as never,
    {
      listAccountIds: () => ["acc-origin", "acc-fallback"],
      resolveAccount: (accountId) => ({
        accountId,
        baseUrl: "https://example.com",
        token: accountId === "acc-origin" ? "token-origin" : "token-fallback",
      }),
      getContextToken: (accountId) => (accountId === "acc-fallback" ? "ctx-fallback" : undefined),
      markDelivered,
      markFailed,
      sendNotice,
      logger: logger as never,
    },
  );

  expect(sendNotice.mock.calls).toHaveLength(1);
  expect(sendNotice.mock.calls[0]?.[1]).toMatchObject({ token: "token-fallback", contextToken: "ctx-fallback" });
  expect(markDelivered).toHaveBeenCalledWith("task-1", "acc-fallback");
  expect(markFailed).not.toHaveBeenCalled();
  expect(logger.info).not.toHaveBeenCalled();
});

test("task notice reserves the final slot and sends when budget is available", async () => {
  // v1.3: reserveFinal is now budgeted (4 final slots). When the budget has
  // capacity (returns true) the notice goes out as before. The next test
  // covers the exhausted path.
  const logger = createLogger();
  const markDelivered = mock(async () => {});
  const markFailed = mock(async () => {});
  const sendNotice = mock(async () => {});
  const reserveFinal = mock((_chatKey: string) => true);

  await deliverOrchestrationTaskNotice(
    {
      taskId: "task-defer",
      status: "completed",
      workerSession: "worker-1",
      resultText: "ok",
      summary: "",
      chatKey: "wx:user",
      replyContextToken: "ctx-origin",
      accountId: "acc-origin",
    } as never,
    {
      listAccountIds: () => ["acc-origin"],
      resolveAccount: (accountId) => ({
        accountId,
        baseUrl: "https://example.com",
        token: "token-origin",
      }),
      getContextToken: () => "ctx-origin",
      markDelivered,
      markFailed,
      sendNotice,
      reserveFinal,
      logger: logger as never,
    },
  );

  expect(reserveFinal).toHaveBeenCalledWith("wx:user");
  expect(sendNotice).toHaveBeenCalledTimes(1);
  expect(markDelivered).toHaveBeenCalledWith("task-defer", "acc-origin");
  expect(markFailed).not.toHaveBeenCalled();
});

test("marks notice delivery failed after all candidate accounts fail", async () => {
  const logger = createLogger();
  const markDelivered = mock(async () => {});
  const markFailed = mock(async () => {});

  await expect(
    deliverOrchestrationTaskNotice(
      {
        taskId: "task-1",
        status: "completed",
        workerSession: "worker-1",
        resultText: "ok",
        summary: "",
        chatKey: "wx:user",
        replyContextToken: "ctx-origin",
        accountId: "acc-origin",
      } as never,
      {
        listAccountIds: () => ["acc-origin", "acc-fallback"],
        resolveAccount: (accountId) => ({
          accountId,
          baseUrl: "https://example.com",
          token: accountId === "acc-origin" ? "token-origin" : "token-fallback",
        }),
        getContextToken: (accountId) => (accountId === "acc-origin" ? "ctx-origin" : "ctx-fallback"),
        markDelivered,
        markFailed,
        sendNotice: mock(async () => {
          throw new Error("send failed");
        }),
        logger: logger as never,
      },
    ),
  ).rejects.toThrow("send failed");

  expect(markDelivered).not.toHaveBeenCalled();
  expect(markFailed).toHaveBeenCalledWith("task-1", "send failed");
});
