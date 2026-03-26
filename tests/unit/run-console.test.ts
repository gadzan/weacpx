import { expect, test } from "bun:test";

import { runConsole } from "../../src/run-console";

test("runs the foreground service with daemon lifecycle hooks", async () => {
  const events: string[] = [];
  let heartbeatTick: (() => void | Promise<void>) | null = null;
  let clearedTimer: unknown = null;

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
        dispose: async () => {
          events.push("dispose");
        },
      }),
      loadWeixinSdk: async () => ({
        start: async () => {
          events.push("sdk:start");
          await heartbeatTick?.();
        },
      }),
      daemonRuntime: {
        start: async ({ configPath, statePath }) => {
          events.push(`daemon:start:${configPath}:${statePath}`);
        },
        heartbeat: async () => {
          events.push("daemon:heartbeat");
        },
        stop: async () => {
          events.push("daemon:stop");
        },
      },
      heartbeatIntervalMs: 5_000,
      setInterval: (fn) => {
        heartbeatTick = fn;
        return "timer-id";
      },
      clearInterval: (timer) => {
        clearedTimer = timer;
      },
    },
  );

  expect(events).toEqual([
    "daemon:start:/cfg:/state",
    "sdk:start",
    "daemon:heartbeat",
    "dispose",
    "daemon:stop",
  ]);
  expect(clearedTimer).toBe("timer-id");
});

test("still stops daemon runtime when startup fails", async () => {
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
          dispose: async () => {
            events.push("dispose");
          },
        }),
        loadWeixinSdk: async () => ({
          start: async () => {
            throw new Error("boom");
          },
        }),
        daemonRuntime: {
          start: async () => {
            events.push("daemon:start");
          },
          heartbeat: async () => {
            events.push("daemon:heartbeat");
          },
          stop: async () => {
            events.push("daemon:stop");
          },
        },
      },
    ),
  ).rejects.toThrow("boom");

  expect(events).toEqual(["daemon:start", "dispose", "daemon:stop"]);
});
