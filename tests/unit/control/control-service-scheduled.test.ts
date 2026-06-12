import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const record: ScheduledTaskRecord = {
  id: "ab12",
  chat_key: "relay:acct-1",
  session_alias: "backend",
  execute_at: "2026-06-14T10:00:00.000Z",
  message: "check CI",
  status: "pending",
  created_at: "2026-06-13T10:00:00.000Z",
};

function makeControl() {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const calls: Record<string, unknown[]> = { create: [], cancel: [] };
  const control = new ControlService({
    agent: { chat: async () => ({ text: "" }) },
    sessions: {} as never,
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: {
      listPending: (chatKey: string) => (chatKey === "relay:acct-1" ? [record] : []),
      createTask: async (input: unknown) => {
        calls.create.push(input);
        return record;
      },
      cancelPending: async (id: string, _chatKey: string) => {
        calls.cancel.push(id);
        return id === "ab12";
      },
    },
    orchestration: {} as never,
    events,
  } as never);
  return { control, seen, calls };
}

test("listScheduledTasks scopes to the chat key", () => {
  const { control } = makeControl();
  expect(control.listScheduledTasks("relay:acct-1")).toEqual([record]);
  expect(control.listScheduledTasks("relay:other")).toEqual([]);
});

test("createScheduledTask delegates and emits scheduled-changed", async () => {
  const { control, seen, calls } = makeControl();
  const task = await control.createScheduledTask({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    executeAt: new Date("2026-06-14T10:00:00.000Z"),
    message: "check CI",
  });
  expect(task.id).toBe("ab12");
  expect(calls.create).toHaveLength(1);
  expect(seen).toContainEqual({ type: "scheduled-changed", chatKey: "relay:acct-1" });
});

test("cancelScheduledTask emits only when something was cancelled", async () => {
  const { control, seen } = makeControl();
  expect(await control.cancelScheduledTask("zz99", "relay:acct-1")).toBe(false);
  expect(seen).toHaveLength(0);
  expect(await control.cancelScheduledTask("ab12", "relay:acct-1")).toBe(true);
  expect(seen).toContainEqual({ type: "scheduled-changed", chatKey: "relay:acct-1" });
});
