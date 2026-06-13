import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import NewSessionDialog from "../components/NewSessionDialog.vue";
import { useInstancesStore } from "../stores/instances";

function seedStore() {
  const store = useInstancesStore();
  store.instances = [{
    id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [],
    agents: [{ name: "codex", driver: "codex" }, { name: "claude", driver: "claude" }],
    workspaces: [{ name: "home", cwd: "/Users/me" }],
  }] as never;
  vi.spyOn(store, "loadFormOptions").mockResolvedValue();
  return store;
}

function mountDialog() {
  return mount(NewSessionDialog, { props: { instanceId: "i1", instanceName: "pc" } });
}

describe("NewSessionDialog", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("populates agent and workspace dropdowns with a +New workspace option", async () => {
    seedStore();
    const w = mountDialog();
    await flushPromises();
    const agentOpts = w.find('[data-test="ns-agent"]').findAll("option").map((o) => o.text());
    expect(agentOpts).toEqual(["codex · codex", "claude · claude"]);
    const wsOpts = w.find('[data-test="ns-workspace"]').findAll("option").map((o) => o.text());
    expect(wsOpts).toEqual(["home — /Users/me", "+ New workspace…"]);
  });

  it("creates a session against an existing workspace", async () => {
    const store = seedStore();
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue();
    const w = mountDialog();
    await flushPromises();
    await w.find('[data-test="ns-alias"]').setValue("backend");
    await w.find('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(createSession).toHaveBeenCalledWith("i1", "backend", "codex", "home");
    expect(w.emitted("created")?.[0]).toEqual(["backend"]);
    expect(w.emitted("close")).toBeTruthy();
  });

  it("creates a new workspace by path, then the session in it", async () => {
    const store = seedStore();
    const createWorkspace = vi.spyOn(store, "createWorkspace").mockResolvedValue({ name: "api", cwd: "/srv/api" });
    const createSession = vi.spyOn(store, "createSession").mockResolvedValue();
    const w = mountDialog();
    await flushPromises();
    await w.find('[data-test="ns-alias"]').setValue("svc");
    await w.find('[data-test="ns-workspace"]').setValue("__new__");
    expect(w.find('[data-test="ns-new-ws"]').exists()).toBe(true);
    await w.find('[data-test="ns-ws-name"]').setValue("api");
    await w.find('[data-test="ns-ws-path"]').setValue("/srv/api");
    await w.find('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(createWorkspace).toHaveBeenCalledWith("i1", "api", "/srv/api", undefined);
    expect(createSession).toHaveBeenCalledWith("i1", "svc", "codex", "api");
  });

  it("shows an error and stays open when creation fails", async () => {
    const store = seedStore();
    vi.spyOn(store, "createSession").mockRejectedValue(new Error("workspace not registered: home"));
    const w = mountDialog();
    await flushPromises();
    await w.find('[data-test="ns-alias"]').setValue("backend");
    await w.find('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ns-error"]').text()).toContain("workspace not registered");
    expect(w.emitted("close")).toBeFalsy();
  });

  it("disables Create until alias is filled", async () => {
    seedStore();
    const w = mountDialog();
    await flushPromises();
    expect(w.find('[data-test="ns-create"]').attributes("disabled")).toBeDefined();
    await w.find('[data-test="ns-alias"]').setValue("x");
    expect(w.find('[data-test="ns-create"]').attributes("disabled")).toBeUndefined();
  });
});
