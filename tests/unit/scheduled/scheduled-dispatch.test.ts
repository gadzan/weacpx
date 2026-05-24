import { expect, test } from "bun:test";

import { buildScheduledDispatchTask } from "../../../src/scheduled/scheduled-dispatch";
import type { ScheduledChannelMessageInput } from "../../../src/channels/types";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";
import type { ResolvedSession } from "../../../src/transport/types";

function resolved(alias: string, agent: string, workspace: string, transportSession: string): ResolvedSession {
  return { alias, agent, agentCommand: agent, workspace, transportSession, cwd: "/tmp/backend" };
}

const tempTask: ScheduledTaskRecord = {
  id: "k8f2",
  chat_key: "weixin:user-1",
  session_alias: "origin",
  session_mode: "temp",
  agent: "codex",
  workspace: "backend",
  execute_at: "2026-05-24T10:00:00.000Z",
  message: "检查 CI",
  status: "triggering",
  created_at: "2026-05-24T09:00:00.000Z",
};

const boundTask: ScheduledTaskRecord = {
  id: "p91a",
  chat_key: "weixin:user-1",
  session_alias: "backend:codex",
  session_mode: "bound",
  execute_at: "2026-05-24T10:00:00.000Z",
  message: "看 PR",
  status: "triggering",
  created_at: "2026-05-24T09:00:00.000Z",
};

test("temp task resolves a transient session, sends a descriptor, and tears it down", async () => {
  const sent: ScheduledChannelMessageInput[] = [];
  const removed: ResolvedSession[] = [];
  const dispatch = buildScheduledDispatchTask({
    getSession: async () => null,
    resolveSession: (alias, agent, workspace, transportSession) => resolved(alias, agent, workspace, transportSession),
    sendScheduledMessage: async (input) => { sent.push(input); },
    removeSession: async (session) => { removed.push(session); },
  });

  await dispatch(tempTask, new AbortController().signal);

  expect(sent).toHaveLength(1);
  expect(sent[0]!.sessionAlias).toBe("origin");
  expect(sent[0]!.sessionDescriptor).toEqual({
    alias: "later-k8f2",
    agent: "codex",
    workspace: "backend",
    transportSession: "backend:later-k8f2",
  });
  expect(sent[0]!.noticeText).toContain("临时会话（backend · codex）");
  expect(removed).toHaveLength(1);
  expect(removed[0]!.transportSession).toBe("backend:later-k8f2");
});

test("bound task uses the persisted session and never tears it down", async () => {
  const sent: ScheduledChannelMessageInput[] = [];
  const removed: ResolvedSession[] = [];
  const dispatch = buildScheduledDispatchTask({
    getSession: async (alias) => (alias === "backend:codex" ? resolved("backend:codex", "codex", "backend", "backend:backend:codex") : null),
    resolveSession: () => { throw new Error("bound dispatch must not resolve a transient session"); },
    sendScheduledMessage: async (input) => { sent.push(input); },
    removeSession: async (session) => { removed.push(session); },
  });

  await dispatch(boundTask, new AbortController().signal);

  expect(sent).toHaveLength(1);
  expect(sent[0]!.sessionAlias).toBe("backend:codex");
  expect(sent[0]!.sessionDescriptor).toBeUndefined();
  expect(removed).toHaveLength(0);
});

test("legacy task without session_mode dispatches as bound", async () => {
  const sent: ScheduledChannelMessageInput[] = [];
  const legacy: ScheduledTaskRecord = { ...boundTask, id: "old1" };
  delete (legacy as { session_mode?: string }).session_mode;
  const dispatch = buildScheduledDispatchTask({
    getSession: async () => resolved("backend:codex", "codex", "backend", "backend:backend:codex"),
    resolveSession: () => { throw new Error("legacy dispatch must not resolve a transient session"); },
    sendScheduledMessage: async (input) => { sent.push(input); },
    removeSession: async () => {},
  });

  await dispatch(legacy, new AbortController().signal);
  expect(sent[0]!.sessionDescriptor).toBeUndefined();
});

test("a failing teardown is swallowed and does not reject the dispatch", async () => {
  const dispatch = buildScheduledDispatchTask({
    getSession: async () => null,
    resolveSession: (alias, agent, workspace, transportSession) => resolved(alias, agent, workspace, transportSession),
    sendScheduledMessage: async () => {},
    removeSession: async () => { throw new Error("close failed"); },
    logger: { info: async () => {}, error: async () => {}, debug: async () => {} } as never,
  });

  await expect(dispatch(tempTask, new AbortController().signal)).resolves.toBeUndefined();
});
