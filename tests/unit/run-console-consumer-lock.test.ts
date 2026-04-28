import { expect, test } from "bun:test";

import { createNoopAppLogger } from "../../src/logging/app-logger";
import { runConsole } from "../../src/run-console";
import { ActiveWeixinConsumerLockError } from "../../src/weixin/monitor/consumer-lock";

test("acquires and releases the weixin consumer lock around sdk.start", async () => {
  const events: string[] = [];

  await runConsole(
    {
      configPath: "/cfg",
      statePath: "/state",
    },
    {
      buildApp: async () => ({
        agent: {} as never,
        router: {} as never,
        sessions: {} as never,
        stateStore: {} as never,
        configStore: {} as never,
        logger: createNoopAppLogger(),
        dispose: async () => {
          events.push("dispose");
        },
      }),
      loadWeixinSdk: async () => ({
        isLoggedIn: () => true,
        start: async () => {
          events.push("sdk:start");
        },
      }),
      consumerLock: {
        acquire: async (meta) => {
          events.push(`lock:acquire:${meta.mode}`);
        },
        release: async () => {
          events.push("lock:release");
        },
      },
    },
  );

  expect(events).toEqual(["lock:acquire:foreground", "sdk:start", "dispose", "lock:release"]);
});

test("releases the weixin consumer lock when sdk.start fails", async () => {
  const events: string[] = [];

  await expect(
    runConsole(
      {
        configPath: "/cfg",
        statePath: "/state",
      },
      {
        buildApp: async () => ({
          agent: {} as never,
          router: {} as never,
          sessions: {} as never,
          stateStore: {} as never,
          configStore: {} as never,
          logger: createNoopAppLogger(),
          dispose: async () => {
            events.push("dispose");
          },
        }),
        loadWeixinSdk: async () => ({
          isLoggedIn: () => true,
          start: async () => {
            throw new Error("boom");
          },
        }),
        consumerLock: {
          acquire: async () => {
            events.push("lock:acquire");
          },
          release: async () => {
            events.push("lock:release");
          },
        },
      },
    ),
  ).rejects.toThrow("boom");

  expect(events).toEqual(["lock:acquire", "dispose", "lock:release"]);
});

test("does not release the lock if acquisition fails before startup", async () => {
  const events: string[] = [];

  await expect(
    runConsole(
      {
        configPath: "/cfg",
        statePath: "/state",
      },
      {
        buildApp: async () => ({
          agent: {} as never,
          router: {} as never,
          sessions: {} as never,
          stateStore: {} as never,
          configStore: {} as never,
          logger: createNoopAppLogger(),
          dispose: async () => {
            events.push("dispose");
          },
        }),
        loadWeixinSdk: async () => ({
          isLoggedIn: () => true,
          start: async () => {
            events.push("sdk:start");
          },
        }),
        consumerLock: {
          acquire: async () => {
            throw new Error("already running");
          },
          release: async () => {
            events.push("lock:release");
          },
        },
      },
    ),
  ).rejects.toThrow("already running");

  expect(events).toEqual(["dispose"]);
});

test("logs active lock holder diagnostics when another consumer already owns the lock", async () => {
  const logs: string[] = [];

  await expect(
    runConsole(
      {
        configPath: "/cfg",
        statePath: "/state",
      },
      {
        buildApp: async () => ({
          agent: {} as never,
          router: {} as never,
          sessions: {} as never,
          stateStore: {} as never,
          configStore: {} as never,
          logger: {
            debug: async () => {},
            info: async (event, _message, context) => {
              logs.push(`info:${event}:${JSON.stringify(context)}`);
            },
            error: async (event, _message, context) => {
              logs.push(`error:${event}:${JSON.stringify(context)}`);
            },
            cleanup: async () => {},
            flush: async () => {},
          },
          dispose: async () => {},
        }),
        loadWeixinSdk: async () => ({
          isLoggedIn: () => true,
          start: async () => {},
        }),
        consumerLock: {
          acquire: async () => {
            throw new ActiveWeixinConsumerLockError("/runtime/weixin-consumer.lock.json", {
              pid: 123,
              mode: "daemon",
              startedAt: "2026-04-06T00:00:00.000Z",
              configPath: "/cfg-old",
              statePath: "/state-old",
            });
          },
          release: async () => {},
        },
      },
    ),
  ).rejects.toThrow("weacpx Weixin consumer is already running.");

  expect(logs.some((line) => line.includes("info:weixin.consumer_lock.acquire_attempt"))).toBe(true);
  expect(logs.some((line) => line.includes("error:weixin.consumer_lock.acquire_failed"))).toBe(true);
  expect(logs.some((line) => line.includes("\"activePid\":123"))).toBe(true);
  expect(logs.some((line) => line.includes("\"conflictType\":\"active_lock_holder\""))).toBe(true);
});
