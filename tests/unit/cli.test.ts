import { expect, test } from "bun:test";

import { runCli } from "../../src/cli";

test("dispatches login", async () => {
  const events: string[] = [];

  await expect(
    runCli(["login"], {
      login: async () => {
        events.push("login");
      },
      print: (line) => {
        events.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(events).toEqual(["login"]);
});

test("prints running status", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["status"], {
      controller: {
        getStatus: async () => ({
          state: "running",
          pid: 12345,
          status: {
            pid: 12345,
            started_at: "2026-03-26T00:00:00.000Z",
            heartbeat_at: "2026-03-26T00:01:00.000Z",
            config_path: "/cfg",
            state_path: "/state",
            stdout_log: "/out",
            stderr_log: "/err",
          },
        }),
        start: async () => ({ state: "started", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual([
    "weacpx 正在运行",
    "PID: 12345",
    "Started: 2026-03-26T00:00:00.000Z",
    "Heartbeat: 2026-03-26T00:01:00.000Z",
    "Config: /cfg",
    "State: /state",
    "Stdout: /out",
    "Stderr: /err",
  ]);
});

test("prints already running on repeated start", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["start"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => ({ state: "already-running", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual(["weacpx 已在后台运行", "PID: 12345"]);
});

test("prints stop result", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["stop"], {
      controller: {
        getStatus: async () => ({ state: "stopped" }),
        start: async () => ({ state: "started", pid: 12345 }),
        stop: async () => ({ state: "stopped", detail: "stopped" }),
      },
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(0);

  expect(lines).toEqual(["weacpx 已停止"]);
});

test("prints help for unknown commands", async () => {
  const lines: string[] = [];

  await expect(
    runCli(["nope"], {
      print: (line) => {
        lines.push(line);
      },
    }),
  ).resolves.toBe(1);

  expect(lines).toEqual([
    "用法：",
    "weacpx login",
    "weacpx run",
    "weacpx start",
    "weacpx status",
    "weacpx stop",
  ]);
});
