import { expect, test } from "bun:test";

import {
  cancelScheduledTaskFromRoute,
  listScheduledTasksFromRoute,
} from "../../../src/scheduled/scheduled-route-manage";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const now = new Date("2026-05-25T00:00:00.000Z");

function pending(id: string, chatKey: string, executeAt: string): ScheduledTaskRecord {
  return {
    id,
    chat_key: chatKey,
    session_alias: "main",
    execute_at: executeAt,
    message: `msg-${id}`,
    status: "pending",
    created_at: now.toISOString(),
  };
}

function directRoute(state: AppState): void {
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:user",
    sessionAlias: "main",
    chatType: "direct",
    updatedAt: now.toISOString(),
  };
}

function groupRoute(state: AppState, isOwner?: boolean): void {
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:group",
    sessionAlias: "main",
    chatType: "group",
    ...(isOwner !== undefined ? { isOwner } : {}),
    updatedAt: now.toISOString(),
  };
}

test("listScheduledTasksFromRoute scopes the list to the route's chatKey", async () => {
  const state = createEmptyState();
  directRoute(state);
  const own = [pending("a1b2", "wx:user", "2026-05-25T03:00:00.000Z")];
  const seenChatKeys: string[] = [];

  const result = await listScheduledTasksFromRoute(
    { coordinatorSession: "backend:main" },
    {
      state,
      scheduled: {
        listPending: (chatKey) => {
          seenChatKeys.push(chatKey);
          return own;
        },
      },
    },
  );

  // The service is queried with the route's own chatKey — never globally.
  expect(seenChatKeys).toEqual(["wx:user"]);
  expect(result).toEqual(own);
});

test("listScheduledTasksFromRoute allows group owners", async () => {
  const state = createEmptyState();
  groupRoute(state, true);
  const all = [pending("a1b2", "wx:group", "2026-05-25T03:00:00.000Z")];
  const seenChatKeys: string[] = [];

  const result = await listScheduledTasksFromRoute(
    { coordinatorSession: "backend:main" },
    {
      state,
      scheduled: {
        listPending: (chatKey) => {
          seenChatKeys.push(chatKey);
          return all;
        },
      },
    },
  );

  expect(seenChatKeys).toEqual(["wx:group"]);
  expect(result).toEqual(all);
});

test("listScheduledTasksFromRoute rejects non-owner group routes", async () => {
  const state = createEmptyState();
  groupRoute(state, false);

  await expect(
    listScheduledTasksFromRoute(
      { coordinatorSession: "backend:main" },
      { state, scheduled: { listPending: () => [] } },
    ),
  ).rejects.toThrow("scheduled_list is owner-only in group chats");
});

test("rejects group routes with an absent isOwner field for both resolvers", async () => {
  const state = createEmptyState();
  groupRoute(state); // no isOwner key at all

  await expect(
    listScheduledTasksFromRoute(
      { coordinatorSession: "backend:main" },
      { state, scheduled: { listPending: () => [] } },
    ),
  ).rejects.toThrow("scheduled_list is owner-only in group chats");

  await expect(
    cancelScheduledTaskFromRoute(
      { coordinatorSession: "backend:main", id: "k8f2" },
      { state, scheduled: { cancelPending: async () => true } },
    ),
  ).rejects.toThrow("scheduled_cancel is owner-only in group chats");
});

test("listScheduledTasksFromRoute rejects routes missing chat metadata", async () => {
  const state = createEmptyState();
  state.orchestration.coordinatorRoutes["backend:main"] = {
    coordinatorSession: "backend:main",
    chatKey: "wx:legacy",
    sessionAlias: "main",
    updatedAt: now.toISOString(),
  };

  await expect(
    listScheduledTasksFromRoute(
      { coordinatorSession: "backend:main" },
      { state, scheduled: { listPending: () => [] } },
    ),
  ).rejects.toThrow("scheduled_list requires current chat route metadata");
});

test("listScheduledTasksFromRoute rejects when no route is recorded", async () => {
  const state = createEmptyState();

  await expect(
    listScheduledTasksFromRoute(
      { coordinatorSession: "backend:main" },
      { state, scheduled: { listPending: () => [] } },
    ),
  ).rejects.toThrow('no chat route is recorded for coordinator session "backend:main"');
});

test("rejects an empty coordinatorSession", async () => {
  const state = createEmptyState();
  await expect(
    listScheduledTasksFromRoute(
      { coordinatorSession: "   " },
      { state, scheduled: { listPending: () => [] } },
    ),
  ).rejects.toThrow("coordinatorSession must be a non-empty string");
});

test("cancelScheduledTaskFromRoute cancels by id scoped to the route's chatKey and returns the normalized id", async () => {
  const state = createEmptyState();
  directRoute(state);
  const seen: Array<{ id: string; chatKey: string }> = [];

  const result = await cancelScheduledTaskFromRoute(
    { coordinatorSession: "backend:main", id: "#K8F2" },
    {
      state,
      scheduled: {
        cancelPending: async (id, chatKey) => {
          seen.push({ id, chatKey });
          return true;
        },
      },
    },
  );

  // The raw id is passed through to cancelPending (which normalizes internally)
  // together with the route's own chatKey; the returned id is normalized for display.
  expect(seen).toEqual([{ id: "#K8F2", chatKey: "wx:user" }]);
  expect(result).toEqual({ id: "k8f2", cancelled: true });
});

test("cancelScheduledTaskFromRoute returns cancelled:false for an unknown id", async () => {
  const state = createEmptyState();
  directRoute(state);

  const result = await cancelScheduledTaskFromRoute(
    { coordinatorSession: "backend:main", id: "zzzz" },
    { state, scheduled: { cancelPending: async () => false } },
  );

  expect(result).toEqual({ id: "zzzz", cancelled: false });
});

test("cancelScheduledTaskFromRoute rejects non-owner group routes without cancelling", async () => {
  const state = createEmptyState();
  groupRoute(state, false);
  let called = false;

  await expect(
    cancelScheduledTaskFromRoute(
      { coordinatorSession: "backend:main", id: "k8f2" },
      {
        state,
        scheduled: {
          cancelPending: async () => {
            called = true;
            return true;
          },
        },
      },
    ),
  ).rejects.toThrow("scheduled_cancel is owner-only in group chats");

  expect(called).toBe(false);
});
