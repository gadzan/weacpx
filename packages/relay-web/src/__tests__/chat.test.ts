// packages/relay-web/src/__tests__/chat.test.ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { useChatStore } from "../stores/chat";
import PromptInput from "../components/PromptInput.vue";

beforeEach(() => setActivePinia(createPinia()));

test("streaming turn output accumulates then commits on finish", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" } });
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "lo" } });
  expect(store.streaming).toBe("hello");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true } });
  expect(store.streaming).toBe("");
  expect(store.messages.at(-1)).toMatchObject({ direction: "out", text: "hello" });
});

test("events for a different session are ignored", () => {
  const store = useChatStore();
  store.select("i1", "backend");
  store.applyEvent({ kind: "control-event", instanceId: "i1", event: { type: "turn-output", chatKey: "x", sessionAlias: "other", chunk: "nope" } });
  expect(store.streaming).toBe("");
});

test("loadHistory pulls cached messages for the selected session", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    messages: [{ instanceId: "i1", sessionAlias: "backend", direction: "in", text: "hi", createdAt: "t" }],
  }), { status: 200 })));
  const store = useChatStore();
  store.select("i1", "backend");
  await store.loadHistory();
  expect(store.messages.map((m) => m.text)).toEqual(["hi"]);
});

test("PromptInput emits send with trimmed text and clears", async () => {
  const wrapper = mount(PromptInput);
  await wrapper.find("textarea").setValue("  do it  ");
  await wrapper.find("form").trigger("submit.prevent");
  expect(wrapper.emitted("send")?.[0]).toEqual(["do it"]);
  expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
});
