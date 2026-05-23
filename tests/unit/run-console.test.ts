import { expect, test } from "bun:test";

import { createNoopAppLogger } from "../../src/logging/app-logger";
import { runConsole } from "../../src/run-console";

function createScheduledRuntime() {
  return {
    service: {} as never,
    scheduler: {
      start: async () => {},
      stop: () => {},
    } as never,
  };
}

function createRuntime() {
  return {
    agent: {} as never,
    router: {} as never,
    sessions: {} as never,
    stateStore: {} as never,
    configStore: {} as never,
    scheduled: createScheduledRuntime(),
    logger: createNoopAppLogger(),
    quota: {} as never,
    orchestration: {
      server: { start: async () => {}, stop: async () => {} },
      service: {
        purgeExpiredResetCoordinators: async () => {},
        reconcileParallelSlots: async () => {},
      },
      endpoint: {} as never,
    },
    dispose: async () => {},
  };
}

test("runs afterBuild before beforeReady and channel startup", async () => {
  const events: string[] = [];
  const runtime = createRuntime();

  await runConsole({ configPath: "/cfg", statePath: "/state" }, {
    buildApp: async () => { events.push("build"); return runtime; },
    afterBuild: async () => { events.push("afterBuild"); },
    beforeReady: async () => { events.push("beforeReady"); },
    channels: {
      startAll: async () => { events.push("startAll"); },
    },
    addProcessListener: () => {},
    removeProcessListener: () => {},
  });

  expect(events).toEqual(["build", "afterBuild", "beforeReady", "startAll"]);
});

test("runs the foreground service with daemon lifecycle hooks", async () => {
  const events: string[] = [];
  let heartbeatTick: (() => void | Promise<void>) | null = null;
  const intervalDelays: number[] = [];
  const clearedTimers: unknown[] = [];
  let purgeCalls = 0;
  let purgeInput: unknown = null;

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
        scheduled: createScheduledRuntime(),
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
          service: {
            purgeExpiredResetCoordinators: async (input) => {
              purgeCalls += 1;
              purgeInput = input;
            },
            reconcileParallelSlots: async () => {},
          },
        },
        dispose: async () => {
          events.push("dispose");
        },
      }),
      channels: {
        startAll: async () => {
          events.push("channel:start");
          await heartbeatTick?.();
        },
      },
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
      setInterval: (fn, delay) => {
        intervalDelays.push(delay);
        if (delay === 5_000) {
          heartbeatTick = fn;
        }
        return `timer-${delay}`;
      },
      clearInterval: (timer) => {
        clearedTimers.push(timer);
      },
    },
  );

  expect(events).toEqual([
    "daemon:start:/cfg:/state",
    "orchestration:start",
    "channel:start",
    "daemon:heartbeat",
    "orchestration:stop",
    "dispose",
    "daemon:stop",
  ]);
  expect(intervalDelays).toEqual([5_000, 86_400_000]);
  expect(clearedTimers).toEqual(["timer-5000", "timer-86400000"]);
  expect(purgeCalls).toBe(1);
  expect(purgeInput).toEqual({ cutoffDays: 7, trigger: "startup" });
});

test("best-effort channel startup keeps running when all channels fail until shutdown", async () => {
  const events: string[] = [];
  const logErrors: Array<{ event: string; message: string; context: unknown }> = [];
  const signalHandlers = new Map<string, () => void>();
  let settled = false;

  const runPromise = runConsole(
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
        scheduled: createScheduledRuntime(),
        logger: {
          ...createNoopAppLogger(),
          error: async (event, message, context) => {
            logErrors.push({ event, message, context });
          },
        },
        orchestration: {
          server: {
            start: async () => {
              events.push("orchestration:start");
            },
            stop: async () => {
              events.push("orchestration:stop");
            },
          },
          service: {
            purgeExpiredResetCoordinators: async () => {},
            reconcileParallelSlots: async () => {},
          },
        },
        dispose: async () => {
          events.push("dispose");
        },
      }),
      channels: {
        startAll: async () => {
          events.push("channel:start");
          throw new Error("all channels failed to start");
        },
      },
      channelStartupPolicy: "best-effort",
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
      addProcessListener: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      removeProcessListener: (signal, handler) => {
        if (signalHandlers.get(signal) === handler) {
          signalHandlers.delete(signal);
        }
      },
    },
  ).finally(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  expect(events).toEqual(["daemon:start", "orchestration:start", "channel:start"]);
  expect(logErrors).toEqual([
    {
      event: "daemon.channels.start_failed",
      message: "all channels failed to start; daemon remains alive for orchestration IPC",
      context: { error: "all channels failed to start" },
    },
  ]);

  signalHandlers.get("SIGTERM")?.();
  await runPromise;

  expect(events).toEqual(["daemon:start", "orchestration:start", "channel:start", "orchestration:stop", "dispose", "daemon:stop"]);
  expect(signalHandlers.size).toBe(0);
});

test("require-one channel startup still rejects when all channels fail", async () => {
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
          scheduled: createScheduledRuntime(),
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
            service: {
              purgeExpiredResetCoordinators: async () => {},
              reconcileParallelSlots: async () => {},
            },
          },
          dispose: async () => {
            events.push("dispose");
          },
        }),
        channels: {
          startAll: async () => {
            events.push("channel:start");
            throw new Error("all channels failed to start");
          },
        },
        channelStartupPolicy: "require-one",
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
  ).rejects.toThrow("all channels failed to start");

  expect(events).toEqual(["daemon:start", "orchestration:start", "channel:start", "orchestration:stop", "dispose", "daemon:stop"]);
});

test("propagates scheduler startup failures after channels start", async () => {
  const events: string[] = [];

  await expect(
    runConsole(
      {
        configPath: "/cfg",
        statePath: "/state",
      },
      {
        buildApp: async () => ({
          ...createRuntime(),
          scheduled: {
            service: {} as never,
            scheduler: {
              start: async () => {
                events.push("scheduled:start");
                throw new Error("scheduler failed");
              },
              stop: () => {},
            } as never,
          },
          dispose: async () => {
            events.push("dispose");
          },
        }),
        channels: {
          startAll: async () => {
            events.push("channel:start");
          },
        },
        channelStartupPolicy: "best-effort",
      },
    ),
  ).rejects.toThrow("scheduler failed");

  expect(events).toEqual(["channel:start", "scheduled:start", "dispose"]);
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
          scheduled: createScheduledRuntime(),
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
            service: {
              purgeExpiredResetCoordinators: async () => {},
              reconcileParallelSlots: async () => {},
            },
          },
          dispose: async () => {
            events.push("dispose");
          },
        }),
        channels: {
          startAll: async () => {
            throw new Error("sdk load failed");
          },
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
        scheduled: createScheduledRuntime(),
        logger: createNoopAppLogger(),
        orchestration: {
          server: {
            start: async () => {},
            stop: async () => {},
          },
          service: {
            purgeExpiredResetCoordinators: async () => {},
            reconcileParallelSlots: async () => {},
          },
        },
        dispose: async () => {},
      }),
      channels: {
        startAll: async () => {
          await heartbeatTick?.();
        },
      },
      daemonRuntime: {
        start: async () => {},
        heartbeat: async () => {
          throw new Error("heartbeat failed");
        },
        stop: async () => {},
      },
      setInterval: (fn, delay) => {
        if (delay === 30_000) {
          heartbeatTick = fn;
        }
        return `timer-${delay}`;
      },
      clearInterval: () => {},
    },
  );
});

test("does not register gc interval in foreground mode", async () => {
  const intervalDelays: number[] = [];

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
        scheduled: createScheduledRuntime(),
        logger: createNoopAppLogger(),
        orchestration: {
          server: {
            start: async () => {},
            stop: async () => {},
          },
          service: {
            purgeExpiredResetCoordinators: async () => {},
            reconcileParallelSlots: async () => {},
          },
        },
        dispose: async () => {},
      }),
      channels: {
        startAll: async () => {},
      },
      setInterval: (_fn, delay) => {
        intervalDelays.push(delay);
        return `timer-${delay}`;
      },
      clearInterval: () => {},
    },
  );

  expect(intervalDelays).toEqual([]);
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
          scheduled: createScheduledRuntime(),
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
            service: {
              purgeExpiredResetCoordinators: async () => {},
              reconcileParallelSlots: async () => {},
            },
          },
          dispose: async () => {
            events.push("dispose");
            throw new Error("dispose failed");
          },
        }),
        channels: {
          startAll: async () => {
            events.push("channel:start");
          },
        },
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

  expect(events).toEqual(["daemon:start", "orchestration:start", "channel:start", "orchestration:stop", "dispose", "daemon:stop"]);
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
        scheduled: createScheduledRuntime(),
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
          service: {
            purgeExpiredResetCoordinators: async () => {},
            reconcileParallelSlots: async () => {},
          },
        },
        dispose: async () => {
          events.push("dispose");
        },
      }),
      channels: {
        startAll: async (input) => {
          events.push("channel:start");
          await new Promise<void>((resolve) => {
            input.abortSignal.addEventListener(
              "abort",
              () => {
                events.push("channel:abort");
                resolve();
              },
              { once: true },
            );
            signalHandlers.get("SIGINT")?.();
          });
        },
      },
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

  expect(events).toEqual(["daemon:start", "orchestration:start", "channel:start", "channel:abort", "orchestration:stop", "dispose", "daemon:stop"]);
  expect(signalHandlers.size).toBe(0);
});
