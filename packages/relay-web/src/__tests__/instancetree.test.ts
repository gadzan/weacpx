import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import InstanceTree from "../components/InstanceTree.vue";
import { useInstancesStore } from "../stores/instances";

describe("InstanceTree session management", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("creates a session via the inline form", async () => {
    const store = useInstancesStore();
    store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }] as never;
    const create = vi.spyOn(store, "createSession").mockResolvedValue();
    const w = mount(InstanceTree);
    await w.find('[data-test="new-session"]').trigger("click");
    await w.find('[data-test="new-session-alias"]').setValue("backend");
    await w.find('[data-test="new-session-agent"]').setValue("claude");
    await w.find('[data-test="new-session-workspace"]').setValue("/ws");
    await w.find('[data-test="new-session-submit"]').trigger("submit");
    expect(create).toHaveBeenCalledWith("i1", "backend", "claude", "/ws");
  });

  it("deletes a session", async () => {
    const store = useInstancesStore();
    store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [{ alias: "backend", agent: "claude", workspace: "/ws", transportSession: "t", running: false }] }] as never;
    const remove = vi.spyOn(store, "removeSession").mockResolvedValue();
    const w = mount(InstanceTree);
    await w.find('[data-test="delete-session"]').trigger("click");
    expect(remove).toHaveBeenCalledWith("i1", "backend");
  });
});
