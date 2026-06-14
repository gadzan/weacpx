import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import NewSessionDialog from "../components/NewSessionDialog.vue";
import { useInstancesStore } from "../stores/instances";

interface DialogOptions {
  agents?: Array<{ name: string; driver: string }>;
  workspaces?: Array<{ name: string; cwd: string; description?: string }>;
  agentCatalog?: Array<{ driver: string; configured: boolean; installed: "builtin" | "yes" | "unknown" }>;
  sessions?: Array<{ alias: string }>;
}

function mountDialog(opts: DialogOptions = {}) {
  const store = useInstancesStore();
  store.instances = [{
    id: "i1", name: "pc", online: true, lastSeenAt: null,
    sessions: opts.sessions ?? [],
    agents: opts.agents ?? [{ name: "codex", driver: "codex" }],
    workspaces: opts.workspaces ?? [{ name: "home", cwd: "/Users/me" }],
    agentCatalog: opts.agentCatalog ?? [{ driver: "codex", configured: true, installed: "builtin" }],
  }] as never;
  vi.spyOn(store, "loadFormOptions").mockResolvedValue();
  vi.spyOn(store, "createAgent").mockResolvedValue(undefined as never);
  vi.spyOn(store, "createWorkspace").mockResolvedValue({ name: "ws", cwd: "/ws" } as never);
  vi.spyOn(store, "createSession").mockResolvedValue({ pending: false });
  const wrapper = mount(NewSessionDialog, { props: { instanceId: "i1", instanceName: "pc" } });
  return { wrapper, store };
}

describe("NewSessionDialog", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("blank alias is auto-generated from workspace + agent and de-duped", async () => {
    const { wrapper, store } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [{ name: "backend", cwd: "/b" }],
      agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
      sessions: [{ alias: "backend-codex" }],
    });
    await flushPromises();
    await wrapper.get('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(store.createSession).toHaveBeenCalledWith("i1", "backend-codex-2", "codex", "backend");
  });

  it("selecting an un-configured driver auto-creates the agent before the session", async () => {
    const { wrapper, store } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [{ name: "backend", cwd: "/b" }],
      agentCatalog: [
        { driver: "codex", configured: true, installed: "builtin" },
        { driver: "gemini", configured: false, installed: "yes" },
      ],
      sessions: [],
    });
    await flushPromises();
    await wrapper.get('[data-test="ns-agent"]').setValue("gemini");
    await wrapper.get('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(store.createAgent).toHaveBeenCalledWith("i1", "gemini", "gemini");
    expect(store.createSession).toHaveBeenCalledWith("i1", "backend-gemini", "gemini", "backend");
  });

  it("New-path workspace mode auto-creates a workspace from the path basename", async () => {
    const { wrapper, store } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [],
      agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
      sessions: [],
    });
    await flushPromises();
    await wrapper.get('[data-test="ns-ws-mode-path"]').trigger("click");
    await wrapper.get('[data-test="ns-ws-path"]').setValue("/tmp/demo-project");
    await wrapper.get('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(store.createWorkspace).toHaveBeenCalledWith("i1", "demo-project", "/tmp/demo-project");
    expect(store.createSession).toHaveBeenCalledWith("i1", "demo-project-codex", "codex", "demo-project");
  });

  it("an un-installed (unknown) driver is shown but disabled in the select", async () => {
    const { wrapper } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [{ name: "backend", cwd: "/b" }],
      agentCatalog: [
        { driver: "codex", configured: true, installed: "builtin" },
        { driver: "qwen", configured: false, installed: "unknown" },
      ],
      sessions: [],
    });
    await flushPromises();
    const opt = wrapper.find('option[value="qwen"]');
    expect(opt.exists()).toBe(true);
    expect(opt.attributes("disabled")).toBeDefined();
  });

  it("New-path mode with an all-symbols path shows an error and does not create a session", async () => {
    const { wrapper, store } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [],
      agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
      sessions: [],
    });
    await flushPromises();
    await wrapper.get('[data-test="ns-ws-mode-path"]').trigger("click");
    await wrapper.get('[data-test="ns-ws-path"]').setValue("@@@");
    await wrapper.get('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="ns-error"]').exists()).toBe(true);
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("shows a non-error pending notice on a create timeout and defers emit until acknowledged", async () => {
    const { wrapper, store } = mountDialog({
      agents: [{ name: "codex", driver: "codex" }],
      workspaces: [{ name: "backend", cwd: "/b" }],
      agentCatalog: [{ driver: "codex", configured: true, installed: "builtin" }],
      sessions: [],
    });
    vi.mocked(store.createSession).mockResolvedValue({ pending: true });
    await flushPromises();
    await wrapper.get('[data-test="ns-alias"]').setValue("backend");
    await wrapper.get('[data-test="ns-create"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="ns-pending"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ns-error"]').exists()).toBe(false);
    expect(wrapper.emitted("created")).toBeFalsy();
    expect(wrapper.emitted("close")).toBeFalsy();
    await wrapper.get('[data-test="ns-pending-close"]').trigger("click");
    expect(wrapper.emitted("created")?.[0]).toEqual(["backend"]);
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
