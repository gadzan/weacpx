import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../stores/connection";

describe("connection store", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("defaults to disconnected then reflects status", () => {
    const s = useConnectionStore();
    expect(s.online).toBe(false);
    s.setOnline(true);
    expect(s.online).toBe(true);
    s.setOnline(false);
    expect(s.online).toBe(false);
  });
});
