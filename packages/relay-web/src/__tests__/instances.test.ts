import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
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
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }];
  store.applyEvent({ kind: "instance-status", instanceId: "i1", online: false });
  expect(store.instances[0]?.online).toBe(false);
});

test("loadSessions caches sessions under the instance", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    result: { sessions: [{ alias: "backend", agent: "claude", workspace: "/w", transportSession: "t", running: false }] },
  }), { status: 200 })));
  const store = useInstancesStore();
  store.instances = [{ id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] }];
  await store.loadSessions("i1");
  expect(store.instances[0]?.sessions.map((s) => s.alias)).toEqual(["backend"]);
});

import { mount } from "@vue/test-utils";
import InstanceTree from "../components/InstanceTree.vue";

test("InstanceTree renders an online dot per instance", () => {
  setActivePinia(createPinia());
  const store = useInstancesStore();
  store.instances = [
    { id: "i1", name: "pc", online: true, lastSeenAt: null, sessions: [] },
    { id: "i2", name: "srv", online: false, lastSeenAt: null, sessions: [] },
  ];
  const wrapper = mount(InstanceTree);
  const dots = wrapper.findAll('[data-test="online-dot"]');
  expect(dots.length).toBe(2);
  expect(dots[0]!.classes()).toContain("bg-green-500");
  expect(dots[1]!.classes()).toContain("bg-slate-300");
});
