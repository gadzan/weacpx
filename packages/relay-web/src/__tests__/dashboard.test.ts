// packages/relay-web/src/__tests__/dashboard.test.ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Stub the WS client so jsdom needs no real socket.
const disconnect = vi.fn();
vi.mock("../api/events", () => ({ connectEvents: () => disconnect }));

import DashboardView from "../views/DashboardView.vue";
import { useInstancesStore } from "../stores/instances";
import { useChatStore } from "../stores/chat";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ instances: [] }), { status: 200 })));
});

test("dashboard renders three columns and loads instances on mount", async () => {
  const store = useInstancesStore();
  const spy = vi.spyOn(store, "loadInstances");
  const wrapper = mount(DashboardView, { global: { stubs: { ChatPane: true, InstanceTree: true } } });
  await flushPromises();
  expect(spy).toHaveBeenCalled();
  expect(wrapper.findAll('[data-test="column"]').length).toBe(3);
});

test("selecting a session routes it into the chat store", async () => {
  const chat = useChatStore();
  const wrapper = mount(DashboardView, { global: { stubs: { ChatPane: true } } });
  await flushPromises();
  wrapper.findComponent({ name: "InstanceTree" }).vm.$emit("select", "i1", "backend");
  expect(chat.instanceId).toBe("i1");
  expect(chat.sessionAlias).toBe("backend");
});
