import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useInstancesStore } from "../stores/instances";

beforeEach(() => setActivePinia(createPinia()));

test("loadInstances populates the list with online flags", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    instances: [{ id: "i1", name: "pc", online: true, lastSeenAt: null }],
  }), { status: 200 })));
  const store = useInstancesStore();
  await store.loadInstances();
  expect(store.instances[0]).toMatchObject({ id: "i1", name: "pc", online: true });
});

test("applyEvent instance-status toggles online without refetch", () => {
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [], agents: [], workspaces: [] }];
  store.applyEvent({ kind: "instance-status", instanceId: "i1", online: false });
  expect(store.instances[0]?.online).toBe(false);
});

test("loadSessions caches sessions under the instance", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    result: { sessions: [{ alias: "backend", agent: "claude", workspace: "/w", transportSession: "t", running: false }] },
  }), { status: 200 })));
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [], agents: [], workspaces: [] }];
  await store.loadSessions("i1");
  expect(store.instances[0]?.sessions.map((s) => s.alias)).toEqual(["backend"]);
});

describe("createSession timeout handling", () => {
  beforeEach(() => setActivePinia(createPinia()));

  function seed() {
    const store = useInstancesStore();
    store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [], agents: [], workspaces: [] }];
    return store;
  }

  test("resolves {pending:false} on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : String(input);
      // First call: control.sessions.create. Second: control.sessions.list reload.
      const body = url.includes("/rpc") ? { result: { sessions: [] } } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const store = seed();
    await expect(store.createSession("i1", "backend", "codex", "home")).resolves.toEqual({ pending: false });
    vi.unstubAllGlobals();
  });

  test("resolves {pending:true} when the create RPC times out (504)", async () => {
    const store = seed();
    const { api } = await import("../api/client");
    const { ApiError } = await import("../api/client");
    vi.spyOn(api, "rpc").mockRejectedValueOnce(new ApiError("timeout", 504));
    await expect(store.createSession("i1", "backend", "codex", "home")).resolves.toEqual({ pending: true });
    vi.restoreAllMocks();
  });

  test("rejects when the create RPC fails with a non-timeout ApiError", async () => {
    const store = seed();
    const { api } = await import("../api/client");
    const { ApiError } = await import("../api/client");
    vi.spyOn(api, "rpc").mockRejectedValueOnce(new ApiError("instance-offline", 503));
    await expect(store.createSession("i1", "backend", "codex", "home")).rejects.toBeInstanceOf(ApiError);
    vi.restoreAllMocks();
  });

  test("rejects on an instance-side {error} payload (unwrap path)", async () => {
    const store = seed();
    const { api } = await import("../api/client");
    vi.spyOn(api, "rpc").mockResolvedValueOnce({ error: { code: "bad", message: "workspace not registered" } });
    await expect(store.createSession("i1", "backend", "codex", "home")).rejects.toThrow("workspace not registered");
    vi.restoreAllMocks();
  });
});

import { mount } from "@vue/test-utils";
import InstanceTree from "../components/InstanceTree.vue";

test("InstanceTree renders an online dot per instance", () => {
  setActivePinia(createPinia());
  const store = useInstancesStore();
  store.instances = [
    { id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [], agents: [], workspaces: [] },
    { id: "i2", name: "srv", online: false, lastSeenAt: null, sessions: [], agents: [], workspaces: [] },
  ];
  const wrapper = mount(InstanceTree);
  const dots = wrapper.findAll('[data-test="online-dot"]');
  expect(dots.length).toBe(2);
  expect(dots[0]!.classes()).toContain("bg-green-500");
  expect(dots[1]!.classes()).toContain("bg-slate-300");
});
