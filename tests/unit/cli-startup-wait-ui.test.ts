import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { createStartupWaitUi, renderStartupWaitLine } from "../../src/cli/startup-wait-ui";

test("startup wait loading copy stays terse before twenty seconds", () => {
  const line = renderStartupWaitLine({
    elapsedMs: 19_000,
    timeoutMs: 300_000,
    frame: "⠋",
  });

  expect(line).toContain("正在创建初始会话");
  expect(line).toContain("19s / 300s");
  expect(line).toContain("按 Ctrl+B 跳过等待");
  expect(line).not.toContain("准备依赖和运行环境");
});

test("startup wait loading copy explains environment preparation after twenty seconds", () => {
  const line = renderStartupWaitLine({
    elapsedMs: 20_000,
    timeoutMs: 300_000,
    frame: "⠙",
  });

  expect(line).toContain("正在创建初始会话");
  expect(line).toContain("首次启动可能需要准备依赖和运行环境");
  expect(line).toContain("20s / 300s");
  expect(line).toContain("按 Ctrl+B 跳过等待");
});

test("interactive startup wait UI renders progress and treats Ctrl+B as skip", async () => {
  const stdin = new EventEmitter() as NodeJS.ReadStream;
  const rawMode: boolean[] = [];
  const writes: string[] = [];
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: (enabled: boolean) => {
      rawMode.push(enabled);
      return stdin;
    },
    resume: () => stdin,
    pause: () => stdin,
  });
  const stdout = {
    isTTY: true,
    write: (text: string) => {
      writes.push(text);
      return true;
    },
  } as NodeJS.WriteStream;

  const ui = createStartupWaitUi({
    isInteractive: () => true,
    stdin,
    stdout,
  });

  expect(ui.wait).toBeDefined();
  await ui.wait?.onPoll?.({ elapsedMs: 1_000, timeoutMs: 300_000, pid: 12345 });
  expect(writes.join("")).toContain("正在创建初始会话");
  expect(ui.wait?.shouldStopWaiting?.()).toBe(false);

  stdin.emit("data", Buffer.from([2]));

  expect(ui.wait?.shouldStopWaiting?.()).toBe(true);
  ui.stop();
  expect(rawMode).toEqual([true, false]);
});

test("interactive startup wait UI preserves Ctrl+C interrupt behavior in raw mode", () => {
  const stdin = new EventEmitter() as NodeJS.ReadStream;
  const rawMode: boolean[] = [];
  const writes: string[] = [];
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: (enabled: boolean) => {
      rawMode.push(enabled);
      return stdin;
    },
    resume: () => stdin,
    pause: () => stdin,
  });
  const stdout = {
    isTTY: true,
    write: (text: string) => {
      writes.push(text);
      return true;
    },
  } as NodeJS.WriteStream;
  let rawModeStateAtInterrupt: boolean[] = [];
  let writesAtInterrupt: string[] = [];

  const ui = createStartupWaitUi({
    isInteractive: () => true,
    stdin,
    stdout,
    onInterrupt: () => {
      rawModeStateAtInterrupt = [...rawMode];
      writesAtInterrupt = [...writes];
    },
  });
  stdin.emit("data", Buffer.from([3]));
  ui.stop();

  expect(rawModeStateAtInterrupt).toEqual([true, false]);
  expect(writesAtInterrupt.at(-1)).toBe("\r\u001b[2K");
});
