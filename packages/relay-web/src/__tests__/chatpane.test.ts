import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class extends Error { constructor(public code: string, public status: number) { super(code); } },
  api: { get: vi.fn(), rpc: vi.fn() },
}));

import ChatPane from "../components/ChatPane.vue";
import { useChatStore } from "../stores/chat";

beforeEach(() => setActivePinia(createPinia()));

it("shows a working HUD while a live turn is active", async () => {
  const chat = useChatStore();
  chat.select("i1", "backend");
  chat.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-started", chatKey: "c", sessionAlias: "backend" } } as never);
  const w = mount(ChatPane);
  await w.vm.$nextTick();
  expect(w.find('[data-test="turn-hud"]').exists()).toBe(true);
  expect(w.find('[data-test="turn-hud"]').text()).toContain("Working");
});

it("hides the HUD when no turn is active", () => {
  const chat = useChatStore();
  chat.select("i1", "backend");
  const w = mount(ChatPane);
  expect(w.find('[data-test="turn-hud"]').exists()).toBe(false);
});
