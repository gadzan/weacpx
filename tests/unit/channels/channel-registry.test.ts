import { beforeAll, expect, test } from "bun:test";

import { MessageChannelRegistry } from "../../../src/channels/channel-registry";
import { registerKnownChannelId } from "../../../src/channels/channel-scope";
import type { MessageChannelRuntime } from "../../../src/channels/types";

beforeAll(() => {
  registerKnownChannelId("feishu");
});

function fakeChannel(id: string, events: string[]): MessageChannelRuntime {
  return {
    id,
    isLoggedIn: () => true,
    login: async () => id,
    logout: () => {
      events.push(`${id}:logout`);
    },
    start: async () => {
      events.push(`${id}:start`);
    },
    notifyTaskCompletion: async (task) => {
      events.push(`${id}:complete:${task.chatKey}`);
    },
    notifyTaskProgress: async (task, text) => {
      events.push(`${id}:progress:${task.chatKey}:${text}`);
    },
    sendCoordinatorMessage: async (input) => {
      events.push(`${id}:coordinator:${input.chatKey}:${input.text}`);
    },
  };
}

const startInput = {
  agent: {} as never,
  abortSignal: new AbortController().signal,
  quota: {} as never,
  logger: { info: async () => {}, error: async () => {}, debug: async () => {}, cleanup: async () => {}, flush: async () => {} } as never,
};

test("startAll starts all channels concurrently", async () => {
  const events: string[] = [];
  let resolveA: () => void;
  const blocked = new Promise<void>((r) => { resolveA = r; });

  const channelA: MessageChannelRuntime = {
    id: "a",
    isLoggedIn: () => true,
    login: async () => "a",
    logout: () => {},
    start: async () => {
      events.push("a:start");
      await blocked;
    },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };
  const channelB: MessageChannelRuntime = {
    id: "b",
    isLoggedIn: () => true,
    login: async () => "b",
    logout: () => {},
    start: async () => {
      events.push("b:start");
    },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };

  const registry = new MessageChannelRegistry([channelA, channelB]);
  const allStarted = registry.startAll(startInput);

  // Give event loop a tick so channel B's start() can run.
  await new Promise((r) => setTimeout(r, 10));

  // channel B should have started even though channel A is still pending.
  expect(events).toContain("b:start");

  resolveA!();
  await allStarted;
  expect(events).toContain("a:start");
});

test("startAll logs partial failure and resolves when some channels succeed", async () => {
  const events: string[] = [];
  const logErrors: string[] = [];
  const logger = {
    info: async () => {},
    error: async (_event: string, msg: string) => { logErrors.push(msg); },
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  };
  const channelOk: MessageChannelRuntime = {
    id: "ok",
    isLoggedIn: () => true,
    login: async () => "ok",
    logout: () => {},
    start: async () => { events.push("ok:start"); },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };
  const channelBad: MessageChannelRuntime = {
    id: "bad",
    isLoggedIn: () => true,
    login: async () => "bad",
    logout: () => {},
    start: async () => { throw new Error("boom"); },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };

  const registry = new MessageChannelRegistry([channelOk, channelBad]);
  // Partial failure: should NOT throw (some channels still up).
  await registry.startAll({ ...startInput, logger });

  expect(events).toContain("ok:start");
  expect(logErrors.length).toBeGreaterThan(0);
  expect(logErrors.some((m) => m.includes("bad") && m.includes("boom"))).toBe(true);
});

test("startAll rejects when ALL channels fail", async () => {
  const logErrors: string[] = [];
  const logger = {
    info: async () => {},
    error: async (_event: string, msg: string) => { logErrors.push(msg); },
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  };
  const channelA: MessageChannelRuntime = {
    id: "a",
    isLoggedIn: () => true,
    login: async () => "a",
    logout: () => {},
    start: async () => { throw new Error("fail-a"); },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };
  const channelB: MessageChannelRuntime = {
    id: "b",
    isLoggedIn: () => true,
    login: async () => "b",
    logout: () => {},
    start: async () => { throw new Error("fail-b"); },
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };

  const registry = new MessageChannelRegistry([channelA, channelB]);
  await expect(registry.startAll({ ...startInput, logger })).rejects.toThrow("all channels failed to start");
  expect(logErrors.length).toBeGreaterThanOrEqual(2);
});

test("starts and stops all channels", async () => {
  const events: string[] = [];
  const registry = new MessageChannelRegistry([fakeChannel("weixin", events), fakeChannel("feishu", events)]);

  await registry.startAll(startInput);
  registry.stopAll();

  expect(events).toEqual(["weixin:start", "feishu:start", "weixin:logout", "feishu:logout"]);
});

test("routes legacy chat keys to weixin and prefixed keys to matching channel", async () => {
  const events: string[] = [];
  const registry = new MessageChannelRegistry([fakeChannel("weixin", events), fakeChannel("feishu", events)]);

  await registry.sendCoordinatorMessage({ coordinatorSession: "c", chatKey: "wxid_alice", text: "hello" });
  await registry.sendCoordinatorMessage({ coordinatorSession: "c", chatKey: "feishu:default:oc_chat", text: "hi" });

  expect(events).toEqual([
    "weixin:coordinator:wxid_alice:hello",
    "feishu:coordinator:feishu:default:oc_chat:hi",
  ]);
});

test("throws clear error when no channel owns a chat key", async () => {
  const registry = new MessageChannelRegistry([fakeChannel("feishu", [])]);

  await expect(
    registry.sendCoordinatorMessage({ coordinatorSession: "c", chatKey: "dingtalk:default:conv", text: "hello" }),
  ).rejects.toThrow("no message channel registered for chatKey: dingtalk:default:conv");
});

test("resolves the native session list format declared by the owning channel", () => {
  const events: string[] = [];
  const weixin = { ...fakeChannel("weixin", events), nativeSessionListFormat: "cards" as const };
  const feishu = fakeChannel("feishu", events); // declares nothing
  const registry = new MessageChannelRegistry([weixin, feishu]);

  expect(registry.nativeSessionListFormat("weixin:default:wxid_alice")).toBe("cards");
  expect(registry.nativeSessionListFormat("feishu:default:oc_chat")).toBe("table");
});

test("defaults native session list format to table when no channel owns the chat key", () => {
  const registry = new MessageChannelRegistry([fakeChannel("feishu", [])]);

  expect(registry.nativeSessionListFormat("weixin:default:wxid_alice")).toBe("table");
});
