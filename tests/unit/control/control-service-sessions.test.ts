import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

function makeDeps() {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const session = {
    alias: "backend",
    agent: "claude",
    workspace: "/ws/backend",
    transportSession: "xacpx-backend",
  };
  const deps = {
    agent: { chat: async () => ({ text: "" }) },
    sessions: {
      listAllResolvedSessions: () => [session],
      createSession: async (alias: string, agent: string, workspace: string) => ({
        ...session,
        alias,
        agent,
        workspace,
      }),
      removeSession: async (_alias: string) => ({ wasActive: true }),
      useSession: async () => ({ alias: "backend", agent: "claude", workspace: "/ws/backend" }),
    },
    activeTurns: { isActiveAnywhere: (alias: string) => alias === "backend" },
    scheduled: {
      listPending: () => [],
      createTask: async () => {
        throw new Error("unused");
      },
      cancelPending: async () => false,
    },
    orchestration: {
      listTasks: async () => [],
      getTask: async () => null,
      requestTaskCancellation: async () => {
        throw new Error("unused");
      },
    },
    events,
  };
  return { deps, seen };
}

test("listSessions maps resolved sessions with running flag", () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);

  expect(control.listSessions()).toEqual([
    {
      alias: "backend",
      agent: "claude",
      workspace: "/ws/backend",
      transportSession: "xacpx-backend",
      running: true,
    },
  ]);
});

test("createSession delegates and emits sessions-changed", async () => {
  const { deps, seen } = makeDeps();
  const control = new ControlService(deps as never);

  const created = await control.createSession("docs", "codex", "/ws/docs");
  expect(created.alias).toBe("docs");
  expect(seen).toContainEqual({ type: "sessions-changed" });
});

test("removeSession delegates and emits sessions-changed", async () => {
  const { deps, seen } = makeDeps();
  const control = new ControlService(deps as never);

  const result = await control.removeSession("backend");
  expect(result.wasActive).toBe(true);
  expect(seen).toContainEqual({ type: "sessions-changed" });
});
