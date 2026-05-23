import { expect, test } from "bun:test";

import { ScheduledTaskService } from "../../../src/scheduled/scheduled-service";
import { createEmptyState, type AppState } from "../../../src/state/types";

class MemoryStore {
  saves = 0;
  async save(_state: AppState): Promise<void> { this.saves += 1; }
}

test("creates task with collision-checked lowercase id", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.abcd = {
    id: "abcd",
    chat_key: "weixin:user-1",
    session_alias: "alias",
    execute_at: "2026-05-23T10:00:00.000Z",
    message: "old",
    status: "pending",
    created_at: "2026-05-23T09:00:00.000Z",
  };
  const store = new MemoryStore();
  const service = new ScheduledTaskService(state, store, {
    now: () => new Date("2026-05-23T09:00:00.000Z"),
    generateId: (() => {
      const ids = ["abcd", "ef12"];
      return () => ids.shift() ?? "zz99";
    })(),
  });

  const task = await service.createTask({
    chatKey: "weixin:user-1",
    sessionAlias: "internal-alias",
    executeAt: new Date("2026-05-23T10:00:00.000Z"),
    message: "检查 CI",
    accountId: "wx-1",
    replyContextToken: "ctx-1",
  });

  expect(task.id).toBe("ef12");
  expect(state.scheduled_tasks.ef12?.session_alias).toBe("internal-alias");
  expect(store.saves).toBe(1);
});

test("lists pending tasks ordered by execute_at and cancels by #id case-insensitively", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.bbbb = {
    id: "bbbb", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T12:00:00.000Z", message: "later", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  state.scheduled_tasks.aaaa = {
    id: "aaaa", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T10:00:00.000Z", message: "soon", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  const store = new MemoryStore();
  const service = new ScheduledTaskService(state, store);

  expect(service.listPending().map((task) => task.id)).toEqual(["aaaa", "bbbb"]);
  expect(await service.cancelPending("#AAAA")).toBe(true);
  expect(state.scheduled_tasks.aaaa?.status).toBe("cancelled");
});

test("claims due tasks and marks old pending tasks missed", async () => {
  const state = createEmptyState();
  state.scheduled_tasks.due1 = {
    id: "due1", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T09:59:00.000Z", message: "due", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  state.scheduled_tasks.future = {
    id: "future", chat_key: "c", session_alias: "s", execute_at: "2026-05-23T10:01:00.000Z", message: "future", status: "pending", created_at: "2026-05-23T09:00:00.000Z",
  };
  const service = new ScheduledTaskService(state, new MemoryStore(), { now: () => new Date("2026-05-23T10:00:00.000Z") });

  expect((await service.claimDueTasks()).map((task) => task.id)).toEqual(["due1"]);
  expect(state.scheduled_tasks.due1?.status).toBe("triggering");
  expect(state.scheduled_tasks.future?.status).toBe("pending");

  await service.markStartupMissed();
  expect(state.scheduled_tasks.due1?.status).toBe("triggering");
});
