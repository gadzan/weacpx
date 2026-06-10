import { expect, test } from "bun:test";

import { createEmptyState } from "../../../src/state/types";
import { parseState, type StateLoadDroppedRecord } from "../../../src/state/state-store";

test("empty state includes scheduled_tasks", () => {
  expect(createEmptyState().scheduled_tasks).toEqual({});
});

test("parseState accepts scheduled task records", () => {
  const state = parseState({
    sessions: {},
    chat_contexts: {},
    orchestration: undefined,
    scheduled_tasks: {
      k8f2: {
        id: "k8f2",
        chat_key: "weixin:user-1",
        session_alias: "weixin:user-1:backend-codex",
        execute_at: "2026-05-23T13:30:00.000Z",
        message: "检查 CI",
        status: "pending",
        created_at: "2026-05-23T10:00:00.000Z",
        account_id: "wx-1",
        reply_context_token: "ctx-1",
      },
    },
  }, "state.json");

  expect(state.scheduled_tasks.k8f2?.status).toBe("pending");
});

test("parseState skips malformed scheduled task records and reports them", () => {
  const dropped: StateLoadDroppedRecord[] = [];
  const state = parseState({
    sessions: {},
    chat_contexts: {},
    orchestration: undefined,
    scheduled_tasks: {
      bad: {
        id: "bad",
        chat_key: "weixin:user-1",
        session_alias: "alias",
        execute_at: "2026-05-23T13:30:00.000Z",
        message: "检查 CI",
        status: "unknown",
        created_at: "2026-05-23T10:00:00.000Z",
      },
    },
  }, "state.json", dropped);

  expect(state.scheduled_tasks).toEqual({});
  expect(dropped).toEqual([
    { section: "scheduled_tasks", key: "bad", reason: "malformed scheduled task record" },
  ]);
});
