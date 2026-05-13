import { expect, test } from "bun:test";
import {
  __resetShutdownHooksForTests,
  fireShutdownHooksForTests,
  registerShutdownHook,
} from "../../../../packages/channel-feishu/src/card/shutdown-hooks";

test("registerShutdownHook runs every registered handler on shutdown", async () => {
  __resetShutdownHooksForTests();
  const calls: string[] = [];
  registerShutdownHook("a", async () => { calls.push("a"); });
  registerShutdownHook("b", async () => { calls.push("b"); });
  await fireShutdownHooksForTests();
  expect(calls.sort()).toEqual(["a", "b"]);
});

test("dispose function removes the hook", async () => {
  __resetShutdownHooksForTests();
  const calls: string[] = [];
  const dispose = registerShutdownHook("c", async () => { calls.push("c"); });
  dispose();
  await fireShutdownHooksForTests();
  expect(calls).toEqual([]);
});

test("a slow handler does not block other handlers past the timeout", async () => {
  __resetShutdownHooksForTests();
  const calls: string[] = [];
  registerShutdownHook("slow", () => new Promise(() => { /* never resolves */ }));
  registerShutdownHook("fast", async () => { calls.push("fast"); });
  await fireShutdownHooksForTests({ perHandlerTimeoutMs: 50 });
  expect(calls).toEqual(["fast"]);
});

test("handler error is swallowed, other handlers still run", async () => {
  __resetShutdownHooksForTests();
  const calls: string[] = [];
  registerShutdownHook("boom", async () => { throw new Error("nope"); });
  registerShutdownHook("ok", async () => { calls.push("ok"); });
  await fireShutdownHooksForTests();
  expect(calls).toEqual(["ok"]);
});

test("firing twice is a no-op (idempotent)", async () => {
  __resetShutdownHooksForTests();
  const calls: string[] = [];
  registerShutdownHook("once", async () => { calls.push("hit"); });
  await fireShutdownHooksForTests();
  await fireShutdownHooksForTests();
  expect(calls).toEqual(["hit"]);
});
