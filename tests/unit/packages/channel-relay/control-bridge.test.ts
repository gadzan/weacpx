import { expect, test } from "bun:test";

import { MSG, RELAY_PROTOCOL_VERSION, type RelayEnvelope } from "../../../../packages/relay-protocol/src/index";
import {
  createControlBridge,
  scheduledTaskToDto,
  subscribeControlEvents,
} from "../../../../packages/channel-relay/src/control-bridge";

const req = (type: string, payload: unknown): RelayEnvelope => ({
  protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "r-1", type, payload,
});

function makeFakeControl() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => { (calls[name] ??= []).push(args); };
  const listeners: Array<(event: unknown) => void> = [];
  const control = {
    listSessions: () => [{ alias: "a", agent: "claude", workspace: "/ws", transportSession: "t", running: false }],
    createSession: async (alias: string, agent: string, workspace: string) => {
      record("createSession", { alias, agent, workspace });
      return { alias, agent, workspace, transportSession: "t", running: false };
    },
    removeSession: async (alias: string) => { record("removeSession", alias); return { wasActive: false }; },
    listAgents: () => [{ name: "codex", driver: "codex" }, { name: "claude", driver: "claude" }],
    listWorkspaces: () => [{ name: "home", cwd: "/home", description: "h" }],
    createWorkspace: async (name: string, cwd: string, description?: string) => {
      record("createWorkspace", { name, cwd, description });
      return { name, cwd, ...(description ? { description } : {}) };
    },
    prompt: async (input: unknown) => { record("prompt", input); return { ok: true, text: "done" }; },
    cancelTurn: (chatKey: string, alias: string) => { record("cancelTurn", { chatKey, alias }); return true; },
    executeCommand: async (input: unknown) => { record("executeCommand", input); return "output"; },
    listScheduledTasks: (chatKey: string) => [{
      id: "ab12", chat_key: chatKey, session_alias: "a",
      execute_at: "2026-06-14T10:00:00.000Z", message: "m", status: "pending", created_at: "2026-06-13T10:00:00.000Z",
    }],
    createScheduledTask: async (input: { chatKey: string; executeAt: Date }) => {
      record("createScheduledTask", input);
      return {
        id: "cd34", chat_key: input.chatKey, session_alias: "a",
        execute_at: input.executeAt.toISOString(), message: "m", status: "pending", created_at: "2026-06-13T10:00:00.000Z",
      };
    },
    cancelScheduledTask: async () => true,
    listOrchestrationTasks: async () => [{
      taskId: "t1", status: "running", targetAgent: "claude", workspace: "/ws",
      task: "do", summary: "s", createdAt: "x", updatedAt: "y",
      sourceHandle: "h", sourceKind: "human", coordinatorSession: "c", resultText: "",
    }],
    getOrchestrationTask: async () => null,
    cancelOrchestrationTask: async () => ({
      taskId: "t1", status: "cancelled", targetAgent: "claude", workspace: "/ws",
      task: "do", summary: "s", createdAt: "x", updatedAt: "y",
      sourceHandle: "h", sourceKind: "human", coordinatorSession: "c", resultText: "",
    }),
    events: { subscribe: (listener: (event: unknown) => void) => { listeners.push(listener); return () => {}; } },
  };
  return { control, calls, emit: (event: unknown) => listeners.forEach((l) => l(event)) };
}

async function dispatch(bridge: ReturnType<typeof createControlBridge>, envelope: RelayEnvelope): Promise<unknown> {
  return await new Promise((resolve) => bridge(envelope, resolve));
}

test("sessions.list / prompt / command.execute dispatch and shape results", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.sessionsList, {}))).toEqual({
    sessions: [{ alias: "a", agent: "claude", workspace: "/ws", transportSession: "t", running: false }],
  });
  const promptResult = await dispatch(bridge, req(MSG.prompt, {
    chatKey: "relay:acct", sessionAlias: "a", text: "hi", senderId: "acct", isOwner: true,
  }));
  expect(promptResult).toEqual({ ok: true, text: "done" });
  expect(calls.prompt?.[0]).toEqual({ chatKey: "relay:acct", sessionAlias: "a", text: "hi", senderId: "acct", isOwner: true });
  expect(await dispatch(bridge, req(MSG.commandExecute, { chatKey: "k", text: "/status", senderId: "acct" }))).toEqual({ output: "output" });
});

test("scheduled list/create map records to camelCase DTOs; executeAt parsed to Date", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.scheduledList, { chatKey: "relay:acct" }))).toEqual({
    tasks: [{ id: "ab12", sessionAlias: "a", executeAt: "2026-06-14T10:00:00.000Z", message: "m", status: "pending", createdAt: "2026-06-13T10:00:00.000Z" }],
  });
  await dispatch(bridge, req(MSG.scheduledCreate, {
    chatKey: "relay:acct", sessionAlias: "a", executeAt: "2026-06-14T10:00:00.000Z", message: "m",
  }));
  const createInput = calls.createScheduledTask?.[0] as { executeAt: Date };
  expect(createInput.executeAt instanceof Date).toBe(true);
});

test("returns bad-request for an invalid executeAt on scheduled.create", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.scheduledCreate, {
    chatKey: "relay:acct", sessionAlias: "a", executeAt: "not-a-date", message: "m",
  }))).toEqual({ error: { code: "bad-request", message: "executeAt is not a valid ISO timestamp" } });
  expect(calls.createScheduledTask).toBeUndefined(); // never forwarded to the control service
});

test("agents.list / workspaces.list / workspaces.create dispatch and shape results", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.agentsList, {}))).toEqual({
    agents: [{ name: "codex", driver: "codex" }, { name: "claude", driver: "claude" }],
  });
  expect(await dispatch(bridge, req(MSG.workspacesList, {}))).toEqual({
    workspaces: [{ name: "home", cwd: "/home", description: "h" }],
  });
  expect(await dispatch(bridge, req(MSG.workspacesCreate, { name: "backend", cwd: "/srv/backend", description: "api" }))).toEqual({
    workspace: { name: "backend", cwd: "/srv/backend", description: "api" },
  });
  expect(calls.createWorkspace?.[0]).toEqual({ name: "backend", cwd: "/srv/backend", description: "api" });
});

test("workspaces.create rejects missing name or cwd with bad-request", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.workspacesCreate, { name: "  ", cwd: "/x" }))).toEqual({
    error: { code: "bad-request", message: "workspace name and cwd are required" },
  });
  expect(await dispatch(bridge, req(MSG.workspacesCreate, { name: "x", cwd: "" }))).toEqual({
    error: { code: "bad-request", message: "workspace name and cwd are required" },
  });
  expect(calls.createWorkspace).toBeUndefined();
});

test("unknown type and thrown errors become error payloads", async () => {
  const { control } = makeFakeControl();
  const broken = { ...control, listSessions: () => { throw new Error("boom"); } };
  const bridge = createControlBridge(broken as never);
  expect(await dispatch(bridge, req("control.nope", {}))).toEqual({ error: { code: "unknown-type", message: "unsupported rpc type: control.nope" } });
  expect(await dispatch(bridge, req(MSG.sessionsList, {}))).toEqual({ error: { code: "internal", message: "boom" } });
});

test("subscribeControlEvents forwards events and unsubscribes", () => {
  const { control, emit } = makeFakeControl();
  const sent: Array<{ type: string; payload: unknown }> = [];
  subscribeControlEvents(control as never, (type, payload) => sent.push({ type, payload }));
  emit({ type: "sessions-changed" });
  expect(sent).toEqual([{ type: MSG.instanceEvent, payload: { event: { type: "sessions-changed" } } }]);
});

test("scheduledTaskToDto maps snake_case record", () => {
  expect(scheduledTaskToDto({
    id: "i", chat_key: "k", session_alias: "s", execute_at: "e", message: "m", status: "pending", created_at: "c",
  } as never)).toEqual({ id: "i", sessionAlias: "s", executeAt: "e", message: "m", status: "pending", createdAt: "c" });
});
