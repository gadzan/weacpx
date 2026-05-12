import { expect, test } from "bun:test";

import { FlushController } from "../../../../packages/channel-feishu/src/card/flush-controller";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("FlushController runs first request immediately when never flushed", async () => {
  const controller = new FlushController({ minIntervalMs: 50 });
  const calls: number[] = [];
  controller.requestFlush(async () => {
    calls.push(1);
  });
  await controller.waitIdle();
  expect(calls).toEqual([1]);
});

test("FlushController coalesces rapid requests during in-flight work", async () => {
  const controller = new FlushController({ minIntervalMs: 30 });
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let runCount = 0;
  const latestArgs: number[] = [];
  const makeWork = (arg: number) => async (): Promise<void> => {
    runCount += 1;
    latestArgs.push(arg);
    if (runCount === 1) await gate;
  };

  controller.requestFlush(makeWork(1));
  controller.requestFlush(makeWork(2));
  controller.requestFlush(makeWork(3));
  controller.requestFlush(makeWork(4));

  await sleep(5);
  release();
  await sleep(60);
  await controller.waitIdle();

  // First flush ran with arg 1 (started before gate released).
  // Remaining 3 requests coalesced into ONE deferred flush carrying arg 4 (the latest).
  expect(runCount).toBe(2);
  expect(latestArgs).toEqual([1, 4]);
});

test("FlushController defers a request that arrives within the min interval", async () => {
  const controller = new FlushController({ minIntervalMs: 40 });
  const calls: number[] = [];

  controller.requestFlush(async () => {
    calls.push(1);
  });
  await controller.waitIdle();

  controller.requestFlush(async () => {
    calls.push(2);
  });
  // Should NOT have run yet — within min interval.
  expect(calls).toEqual([1]);

  await sleep(60);
  await controller.waitIdle();
  expect(calls).toEqual([1, 2]);
});

test("forceFlush runs immediately even within min interval", async () => {
  const controller = new FlushController({ minIntervalMs: 1000 });
  const calls: number[] = [];

  await controller.forceFlush(async () => {
    calls.push(1);
  });
  await controller.forceFlush(async () => {
    calls.push(2);
  });

  expect(calls).toEqual([1, 2]);
});

test("forceFlush waits for in-flight work to complete and supersedes deferred", async () => {
  const controller = new FlushController({ minIntervalMs: 30 });
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const order: string[] = [];

  controller.requestFlush(async () => {
    order.push("in-flight start");
    await gate;
    order.push("in-flight end");
  });
  controller.requestFlush(async () => {
    order.push("deferred (should be cancelled)");
  });

  const forced = controller.forceFlush(async () => {
    order.push("forced");
  });

  await sleep(2);
  release();
  await forced;
  await controller.waitIdle();

  expect(order).toEqual(["in-flight start", "in-flight end", "forced"]);
});

test("FlushController swallows work rejections without breaking the chain", async () => {
  const controller = new FlushController({ minIntervalMs: 10 });
  const calls: string[] = [];

  controller.requestFlush(async () => {
    calls.push("boom");
    throw new Error("boom");
  });

  await sleep(30);
  controller.requestFlush(async () => {
    calls.push("after-boom");
  });

  await sleep(30);
  await controller.waitIdle();
  expect(calls).toEqual(["boom", "after-boom"]);
});
