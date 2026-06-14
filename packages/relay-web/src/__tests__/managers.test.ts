import { beforeEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import WorkspacesManager from "../components/WorkspacesManager.vue";
import AgentsManager from "../components/AgentsManager.vue";
import { useInstancesStore } from "../stores/instances";

beforeEach(() => setActivePinia(createPinia()));

function seed(store: ReturnType<typeof useInstancesStore>) {
  store.instances = [{
    id: "i1", name: "n", online: true, sessions: [],
    agents: [{ name: "codex", driver: "codex" }],
    workspaces: [{ name: "backend", cwd: "/b", description: "" }],
    agentCatalog: [
      { driver: "codex", configured: true, installed: "builtin" },
      { driver: "gemini", configured: false, installed: "yes" },
    ],
  }] as never;
}

test("WorkspacesManager creates a workspace", async () => {
  const store = useInstancesStore(); seed(store);
  const createWorkspace = vi.spyOn(store, "createWorkspace").mockResolvedValue(undefined as never);
  const w = mount(WorkspacesManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="wm-name"]').setValue("frontend");
  await w.get('[data-test="wm-path"]').setValue("/f");
  await w.get('[data-test="wm-create"]').trigger("click");
  expect(createWorkspace).toHaveBeenCalledWith("i1", "frontend", "/f", undefined);
});

test("WorkspacesManager surfaces a remove-in-use error", async () => {
  const store = useInstancesStore(); seed(store);
  vi.spyOn(store, "removeWorkspace").mockRejectedValue(new Error("workspace \"backend\" is in use by an existing session"));
  const w = mount(WorkspacesManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="wm-remove-backend"]').trigger("click");
  await new Promise((r) => setTimeout(r));
  expect(w.get('[data-test="wm-error"]').text()).toMatch(/in use/);
});

test("AgentsManager adds an agent from the catalog driver picker", async () => {
  const store = useInstancesStore(); seed(store);
  const createAgent = vi.spyOn(store, "createAgent").mockResolvedValue(undefined as never);
  const w = mount(AgentsManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="am-driver"]').setValue("gemini");
  await w.get('[data-test="am-add"]').trigger("click");
  expect(createAgent).toHaveBeenCalledWith("i1", "gemini", "gemini");
});

test("AgentsManager removes a configured agent", async () => {
  const store = useInstancesStore(); seed(store);
  const removeAgent = vi.spyOn(store, "removeAgent").mockResolvedValue(undefined as never);
  const w = mount(AgentsManager, { props: { instanceId: "i1" } });
  await w.get('[data-test="am-remove-codex"]').trigger("click");
  expect(removeAgent).toHaveBeenCalledWith("i1", "codex");
});
