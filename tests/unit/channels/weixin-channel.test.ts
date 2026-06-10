import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("stop() is non-destructive: keeps account credentials; logout() still clears them", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "xacpx-weixin-stop-"));
  const prevStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  try {
    const { saveWeixinAccount, registerWeixinAccountId, listWeixinAccountIds } = await import(
      "../../../src/weixin/auth/accounts.js"
    );
    saveWeixinAccount("acct-1", { token: "tok-1", baseUrl: "https://example.com" });
    registerWeixinAccountId("acct-1");
    expect(listWeixinAccountIds()).toEqual(["acct-1"]);
    const accountFile = path.join(stateDir, "openclaw-weixin", "accounts", "acct-1.json");
    expect(fs.existsSync(accountFile)).toBe(true);

    const channel = createMessageChannel("weixin");
    expect(typeof channel.stop).toBe("function");

    // Graceful shutdown path: must not delete credentials from disk.
    await channel.stop!();
    expect(fs.existsSync(accountFile)).toBe(true);
    expect(listWeixinAccountIds()).toEqual(["acct-1"]);

    // Explicit logout (xacpx logout) remains the destructive surface.
    channel.logout();
    expect(fs.existsSync(accountFile)).toBe(false);
    expect(listWeixinAccountIds()).toEqual([]);
  } finally {
    if (prevStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = prevStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("createConsumerLock returns a lock with acquire and release methods", () => {
  const channel = createMessageChannel("weixin");
  const lock = channel.createConsumerLock!();
  expect(typeof lock.acquire).toBe("function");
  expect(typeof lock.release).toBe("function");
});
