import { describe, expect, it } from "bun:test";

import { AsyncMutex } from "../../../src/orchestration/async-mutex";

describe("AsyncMutex", () => {
  it("serializes overlapping critical sections in FIFO order", async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];
    const defer = <T>(label: string, value: T, delay: number) =>
      new Promise<T>((resolve) => {
        setTimeout(() => {
          events.push(label);
          resolve(value);
        }, delay);
      });

    const a = mutex.run(() => defer("a", 1, 30));
    const b = mutex.run(() => defer("b", 2, 5));
    const c = mutex.run(() => defer("c", 3, 5));

    expect(await Promise.all([a, b, c])).toEqual([1, 2, 3]);
    expect(events).toEqual(["a", "b", "c"]);
  });

  it("releases the lock when the critical section throws", async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await mutex.run(async () => 42)).toBe(42);
  });
});
