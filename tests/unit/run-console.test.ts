import { expect, test } from "bun:test";

import { createNoopAppLogger } from "../../src/logging/app-logger";
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
        logger: createNoopAppLogger(),
        orchestration: {
          server: {
            start: async () => {
              events.push("orchestration:start");
            },
            stop: async () => {
              events.push("orchestration:stop");
            },
          },
        },
        dispose: async () => {
          events.push("dispose");
        },
      }),
      loadWeixinSdk: async () => ({
        isLoggedIn: () => true,
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
    "orchestration:start",
    "sdk:start",
    "daemon:heartbeat",
    "orchestration:stop",
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
          logger: createNoopAppLogger(),
          orchestration: {
            server: {
              start: async () => {
                events.push("orchestration:start");
              },
              stop: async () => {
                events.push("orchestration:stop");
              },
            },
          },
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

  expect(events).toEqual(["daemon:start", "orchestration:start", "orchestration:stop", "dispose", "daemon:stop"]);
});

test("disposes runtime when loading the sdk fails before startup", async () => {
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
          orchestration: {
            server: {
              start: async () => {
                events.push("orchestration:start");
              },
              stop: async () => {
                events.push("orchestration:stop");
              },
            },
          },
          dispose: async () => {
            events.push("dispose");
          },
        }),
        loadWeixinSdk: async () => {
          throw new Error("sdk load failed");
        },
      },
    ),
  ).rejects.toThrow("sdk load failed");

  expect(events).toEqual(["dispose"]);
});

test("swallows heartbeat failures inside the timer callback", async () => {
  let heartbeatTick: (() => void | Promise<void>) | null = null;

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
        orchestration: {
          server: {
            start: async () => {},
            stop: async () => {},
          },
        },
        dispose: async () => {},
      }),
      loadWeixinSdk: async () => ({
        isLoggedIn: () => true,
        start: async () => {
          await heartbeatTick?.();
        },
      }),
      daemonRuntime: {
        start: async () => {},
        heartbeat: async () => {
          throw new Error("heartbeat failed");
        },
        stop: async () => {},
      },
      setInterval: (fn) => {
        heartbeatTick = fn;
        return "timer-id";
      },
      clearInterval: () => {},
    },
  );
});

test("still stops daemon runtime when dispose fails", async () => {
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
          orchestration: {
            server: {
              start: async () => {
                events.push("orchestration:start");
              },
              stop: async () => {
                events.push("orchestration:stop");
              },
            },
          },
          dispose: async () => {
            events.push("dispose");
            throw new Error("dispose failed");
          },
        }),
        loadWeixinSdk: async () => ({
          isLoggedIn: () => true,
          start: async () => {
            events.push("sdk:start");
          },
        }),
        daemonRuntime: {
          start: async () => {
            events.push("daemon:start");
          },
          heartbeat: async () => {},
          stop: async () => {
            events.push("daemon:stop");
          },
        },
      },
    ),
  ).rejects.toThrow("dispose failed");

  expect(events).toEqual(["daemon:start", "orchestration:start", "sdk:start", "orchestration:stop", "dispose", "daemon:stop"]);
});

test("handles SIGINT by aborting the sdk start and running cleanup", async () => {
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();

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
        orchestration: {
          server: {
            start: async () => {
              events.push("orchestration:start");
            },
            stop: async () => {
              events.push("orchestration:stop");
            },
          },
        },
        dispose: async () => {
          events.push("dispose");
        },
      }),
      loadWeixinSdk: async () => ({
        isLoggedIn: () => true,
        start: async (_agent, options) => {
          events.push("sdk:start");
          await new Promise<void>((resolve) => {
            options?.abortSignal?.addEventListener(
              "abort",
              () => {
                events.push("sdk:abort");
                resolve();
              },
              { once: true },
            );
            signalHandlers.get("SIGINT")?.();
          });
        },
      }),
      daemonRuntime: {
        start: async () => {
          events.push("daemon:start");
        },
        heartbeat: async () => {},
        stop: async () => {
          events.push("daemon:stop");
        },
      },
      addProcessListener: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      removeProcessListener: (signal, handler) => {
        if (signalHandlers.get(signal) === handler) {
          signalHandlers.delete(signal);
        }
      },
    },
  );

  expect(events).toEqual(["daemon:start", "orchestration:start", "sdk:start", "sdk:abort", "orchestration:stop", "dispose", "daemon:stop"]);
  expect(signalHandlers.size).toBe(0);
});
