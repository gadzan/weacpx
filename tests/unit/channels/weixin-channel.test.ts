import { expect, test } from "bun:test";
import { createMessageChannel } from "../../../src/channels/create-channel.js";

test("createMessageChannel('weixin') returns a channel with id 'weixin'", () => {
  const channel = createMessageChannel("weixin");
  expect(channel.id).toBe("weixin");
  expect(typeof channel.isLoggedIn).toBe("function");
  expect(typeof channel.login).toBe("function");
  expect(typeof channel.logout).toBe("function");
  expect(typeof channel.start).toBe("function");
  expect(typeof channel.notifyTaskCompletion).toBe("function");
  expect(typeof channel.notifyTaskProgress).toBe("function");
  expect(typeof channel.sendCoordinatorMessage).toBe("function");
});

test("createMessageChannel throws for unsupported type", () => {
  expect(() => createMessageChannel("unknown")).toThrow("unsupported channel type: unknown");
});

test("notifyTaskCompletion throws before start is called", async () => {
  const channel = createMessageChannel("weixin");
  await expect(
    channel.notifyTaskCompletion({
      taskId: "t1",
      sourceHandle: "s1",
      sourceKind: "worker",
      coordinatorSession: "c1",
      workerSession: "w1",
      workspace: "ws",
      targetAgent: "agent",
      task: "do something",
      status: "completed",
      summary: "",
      resultText: "done",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    }),
  ).rejects.toThrow("WeixinChannel.start() must be called before orchestration delivery");
});

test("notifyTaskProgress throws before start is called", async () => {
  const channel = createMessageChannel("weixin");
  await expect(
    channel.notifyTaskProgress(
      {
        taskId: "t1",
        sourceHandle: "s1",
        sourceKind: "worker",
        coordinatorSession: "c1",
        workerSession: "w1",
        workspace: "ws",
        targetAgent: "agent",
        task: "do something",
        status: "running",
        summary: "",
        resultText: "",
        createdAt: "2026-05-03T00:00:00.000Z",
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
      "progress text",
    ),
  ).rejects.toThrow("WeixinChannel.start() must be called before orchestration delivery");
});

test("sendCoordinatorMessage throws before start is called", async () => {
  const channel = createMessageChannel("weixin");
  await expect(
    channel.sendCoordinatorMessage({
      coordinatorSession: "c1",
      chatKey: "wx:user",
      text: "hello",
    }),
  ).rejects.toThrow("WeixinChannel.start() must be called before orchestration delivery");
});

test("createConsumerLock returns a lock with acquire and release methods", () => {
  const channel = createMessageChannel("weixin");
  const lock = channel.createConsumerLock!();
  expect(typeof lock.acquire).toBe("function");
  expect(typeof lock.release).toBe("function");
});
