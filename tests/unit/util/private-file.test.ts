import { expect, test } from "bun:test";

import { __privateFileForTests } from "../../../src/util/private-file";

test("windows atomic write retries transient EPERM long enough before failing", async () => {
  let attempts = 0;
  const delays: number[] = [];

  let caught: unknown = undefined;
  try {
    await __privateFileForTests.retryTransientWriteErrors(
      async () => {
        attempts += 1;
        const err = new Error("locked") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      },
      {
        platform: "win32",
        delay: async (ms) => {
          delays.push(ms);
        },
      },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(attempts).toBeGreaterThanOrEqual(20);
  expect(Math.max(...delays)).toBeLessThanOrEqual(500);
});

test("windows atomic write retries transient EPERM until success", async () => {
  let attempts = 0;

  await __privateFileForTests.retryTransientWriteErrors(
    async () => {
      attempts += 1;
      if (attempts < 10) {
        const err = new Error("locked") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
    },
    {
      platform: "win32",
      delay: async () => {},
    },
  );

  expect(attempts).toBe(10);
});

test("non-windows platforms do not retry", async () => {
  let attempts = 0;

  let caught: unknown = undefined;
  try {
    await __privateFileForTests.retryTransientWriteErrors(
      async () => {
        attempts += 1;
        const err = new Error("locked") as NodeJS.ErrnoException;
        err.code = "EBUSY";
        throw err;
      },
      {
        platform: "linux",
        delay: async () => {},
      },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(attempts).toBe(1);
});
