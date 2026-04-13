import { expect, test } from "bun:test";

import { createConversationExecutor } from "../../../src/weixin/messaging/conversation-executor";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("normal turns for the same conversation stay serialized", async () => {
  const executor = createConversationExecutor();
  const releaseFirst = createDeferred();
  const firstStarted = createDeferred();
  const events: string[] = [];

  const first = executor.run("conv-1", "normal", async () => {
    events.push("first-start");
    firstStarted.resolve();
    await releaseFirst.promise;
    events.push("first-end");
  });

  await firstStarted.promise;

  const second = executor.run("conv-1", "normal", async () => {
    events.push("second-start");
    events.push("second-end");
  });

  await Promise.resolve();
  expect(events).toEqual(["first-start"]);

  releaseFirst.resolve();
  await Promise.all([first, second]);

  expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
});

test("different conversations can progress independently", async () => {
  const executor = createConversationExecutor();
  const releaseFirst = createDeferred();
  const firstStarted = createDeferred();
  const otherDone = createDeferred();
  const events: string[] = [];

  const first = executor.run("conv-1", "normal", async () => {
    events.push("conv-1-start");
    firstStarted.resolve();
    await releaseFirst.promise;
    events.push("conv-1-end");
  });

  await firstStarted.promise;

  const second = executor.run("conv-2", "normal", async () => {
    events.push("conv-2-start");
    events.push("conv-2-end");
    otherDone.resolve();
  });

  await otherDone.promise;
  expect(events).toEqual(["conv-1-start", "conv-2-start", "conv-2-end"]);

  releaseFirst.resolve();
  await Promise.all([first, second]);

  expect(events).toEqual(["conv-1-start", "conv-2-start", "conv-2-end", "conv-1-end"]);
});

test("a control turn can run while a normal turn for the same conversation is still awaiting completion", async () => {
  const executor = createConversationExecutor();
  const releaseNormal = createDeferred();
  const normalStarted = createDeferred();
  const controlDone = createDeferred();
  const events: string[] = [];

  const normal = executor.run("conv-1", "normal", async () => {
    events.push("normal-start");
    normalStarted.resolve();
    await releaseNormal.promise;
    events.push("normal-end");
  });

  await normalStarted.promise;

  const control = executor.run("conv-1", "control", async () => {
    events.push("control-start");
    events.push("control-end");
    controlDone.resolve();
  });

  await controlDone.promise;
  expect(events).toEqual(["normal-start", "control-start", "control-end"]);

  releaseNormal.resolve();
  await Promise.all([normal, control]);

  expect(events).toEqual(["normal-start", "control-start", "control-end", "normal-end"]);
});
