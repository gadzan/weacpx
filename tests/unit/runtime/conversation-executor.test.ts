import { expect, test } from "bun:test";
import { createConversationExecutor } from "../../../src/runtime/conversation-executor";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

test("same chat + same sessionKey serializes (second waits for first)", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { order.push("start1"); await g1.promise; order.push("end1"); }, "s1");
  const p2 = exec.run("chat", "normal", async () => { order.push("start2"); }, "s1");
  await Promise.resolve();
  expect(order).toEqual(["start1"]);
  g1.resolve();
  await Promise.all([p1, p2]);
  expect(order).toEqual(["start1", "end1", "start2"]);
});

test("same chat + different sessionKey runs in parallel", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { order.push("start1"); await g1.promise; order.push("end1"); }, "s1");
  const p2 = exec.run("chat", "normal", async () => { order.push("start2"); }, "s2");
  await Promise.resolve();
  expect(order).toContain("start2");
  g1.resolve();
  await Promise.all([p1, p2]);
});

test("control lane runs immediately regardless of a blocked normal lane", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  const g1 = deferred();
  const p1 = exec.run("chat", "normal", async () => { await g1.promise; }, "s1");
  const pc = exec.run("chat", "control", async () => { order.push("control"); });
  await pc;
  expect(order).toEqual(["control"]);
  g1.resolve();
  await p1;
});

test("normal task without sessionKey still works (default lane)", async () => {
  const exec = createConversationExecutor();
  const order: string[] = [];
  await exec.run("chat", "normal", async () => { order.push("a"); });
  expect(order).toEqual(["a"]);
});
