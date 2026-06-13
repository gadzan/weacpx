import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../api/client", () => ({
  api: { rpc: vi.fn() },
  ApiError: class extends Error {},
}));

import { api } from "../api/client";
import { useTasksStore } from "../stores/tasks";

const rpc = api.rpc as unknown as ReturnType<typeof vi.fn>;

describe("tasks store", () => {
  beforeEach(() => { setActivePinia(createPinia()); rpc.mockReset(); });

  it("loadScheduled stores only the current session's tasks", async () => {
    rpc.mockResolvedValueOnce({ tasks: [
      { id: "1", sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "a", status: "pending", createdAt: "x" },
      { id: "2", sessionAlias: "frontend", executeAt: "2030-01-01T00:00:00Z", message: "b", status: "pending", createdAt: "x" },
    ]});
    const store = useTasksStore();
    await store.loadScheduled("inst", "backend");
    expect(rpc).toHaveBeenCalledWith("inst", "control.scheduled.list");
    expect(store.scheduled.map((t) => t.id)).toEqual(["1"]);
  });

  it("loadOrchestration stores all instance tasks", async () => {
    rpc.mockResolvedValueOnce({ tasks: [{ taskId: "t1", status: "running", targetAgent: "claude", workspace: "/w", task: "x", summary: "", createdAt: "x", updatedAt: "x" }] });
    const store = useTasksStore();
    await store.loadOrchestration("inst");
    expect(rpc).toHaveBeenCalledWith("inst", "control.orchestration.list");
    expect(store.orchestration).toHaveLength(1);
  });

  it("createScheduled posts then reloads", async () => {
    rpc.mockResolvedValueOnce({});
    rpc.mockResolvedValueOnce({ tasks: [] });
    const store = useTasksStore();
    await store.createScheduled("inst", "backend", "2030-01-01T00:00:00Z", "do it");
    expect(rpc).toHaveBeenNthCalledWith(1, "inst", "control.scheduled.create", { sessionAlias: "backend", executeAt: "2030-01-01T00:00:00Z", message: "do it" });
    expect(rpc).toHaveBeenNthCalledWith(2, "inst", "control.scheduled.list");
  });

  it("cancelScheduled posts then reloads", async () => {
    rpc.mockResolvedValueOnce({ cancelled: true });
    rpc.mockResolvedValueOnce({ tasks: [] });
    const store = useTasksStore();
    store.scope = { instanceId: "inst", sessionAlias: "backend" };
    await store.cancelScheduled("9");
    expect(rpc).toHaveBeenNthCalledWith(1, "inst", "control.scheduled.cancel", { id: "9" });
  });

  it("applyEvent reloads scheduled for the scoped instance on scheduled-changed", async () => {
    rpc.mockResolvedValue({ tasks: [] });
    const store = useTasksStore();
    store.scope = { instanceId: "inst", sessionAlias: "backend" };
    store.applyEvent({ kind: "control-event", instanceId: "inst", event: { type: "scheduled-changed", chatKey: "relay:a" } });
    expect(rpc).toHaveBeenCalledWith("inst", "control.scheduled.list");
  });
});
