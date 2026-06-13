// packages/relay-web/src/__tests__/auth.test.ts
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAuthStore } from "../stores/auth";

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

test("login stores the account on success", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ username: "admin", role: "admin" }), { status: 200 })));
  const auth = useAuthStore();
  await auth.login("admin", "pw");
  expect(auth.account).toEqual({ username: "admin", role: "admin" });
  expect(auth.error).toBe("");
});

test("login surfaces an error and leaves account null on 401", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid-credentials" }), { status: 401 })));
  const auth = useAuthStore();
  await auth.login("admin", "bad");
  expect(auth.account).toBeNull();
  expect(auth.error).toBe("invalid-credentials");
});

test("fetchMe populates account when a session exists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ username: "u", role: "member" }), { status: 200 })));
  const auth = useAuthStore();
  expect(await auth.fetchMe()).toBe(true);
  expect(auth.account?.username).toBe("u");
});
