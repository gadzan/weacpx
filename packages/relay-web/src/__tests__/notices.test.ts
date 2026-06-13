import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { useNoticesStore } from "../stores/notices";
import NoticeToast from "../components/NoticeToast.vue";

describe("notices store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("appends notice events and caps the list at 20", () => {
    const store = useNoticesStore();
    for (let i = 0; i < 25; i++) {
      store.applyEvent({ kind: "notice", instanceId: "inst", notice: { kind: "task-completion", text: `done ${i}` } });
    }
    expect(store.items).toHaveLength(20);
    expect(store.items[0].text).toBe("done 24");
  });

  it("ignores non-notice events", () => {
    const store = useNoticesStore();
    store.applyEvent({ kind: "instance-status", instanceId: "inst", online: true });
    expect(store.items).toHaveLength(0);
  });

  it("dismiss removes a notice by id", () => {
    const store = useNoticesStore();
    store.applyEvent({ kind: "notice", instanceId: "inst", notice: { kind: "task-progress", text: "x" } });
    const id = store.items[0].id;
    store.dismiss(id);
    expect(store.items).toHaveLength(0);
  });

  it("renders notices and dismisses on click", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useNoticesStore();
    store.applyEvent({ kind: "notice", instanceId: "inst", notice: { kind: "task-completion", text: "all done" } });
    const w = mount(NoticeToast, { global: { plugins: [pinia] } });
    expect(w.text()).toContain("all done");
    await w.find('[data-test="notice"] button').trigger("click");
    expect(store.items).toHaveLength(0);
  });
});
