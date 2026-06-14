import { expect, test } from "bun:test";

import { MSG } from "../../../../packages/relay-protocol/src/index";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";
import { MessageStore } from "../../../../packages/relay/src/stores/messages";
import { createApp } from "../../../../packages/relay/src/http/app";

async function makeApp() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const admin = accounts.createAccount("admin", "admin-pw", "admin");
  const rpcCalls: Array<{ instanceId: string; type: string; payload: unknown }> = [];
  const gateway = {
    isOnline: (id: string) => id !== "offline-id",
    sendRequest: async (instanceId: string, type: string, payload: unknown) => {
      rpcCalls.push({ instanceId, type, payload });
      return { sessions: [] };
    },
  };
  const messages = new MessageStore(db);
  const app = createApp({ accounts, instances, gateway, messages });
  const login = async (username: string, password: string) => {
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  return { app, accounts, instances, admin, gateway, rpcCalls, messages, login };
}

test("login sets HttpOnly cookie; bad password 401; rate limit kicks in", async () => {
  const { app, login } = await makeApp();
  const { res, cookie } = await login("admin", "admin-pw");
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  const me = await app.request("/api/me", { headers: { cookie } });
  expect(((await me.json()) as { username: string }).username).toBe("admin");
  expect((await app.request("/api/me")).status).toBe(401);
  expect((await login("admin", "nope")).res.status).toBe(401);
  for (let i = 0; i < 12; i++) await login("admin", "nope");
  expect((await login("admin", "nope")).res.status).toBe(429);
});

test("invite -> register -> member login; invites are admin-only", async () => {
  const { app, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const inviteRes = await app.request("/api/invites", { method: "POST", headers: { cookie, "content-type": "application/json" } });
  expect(inviteRes.status).toBe(200);
  const { invite } = (await inviteRes.json()) as { invite: string };
  const registerRes = await app.request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite, username: "alice", password: "alice-pw" }),
  });
  expect(registerRes.status).toBe(200);
  const { cookie: aliceCookie } = await login("alice", "alice-pw");
  expect((await app.request("/api/invites", { method: "POST", headers: { cookie: aliceCookie, "content-type": "application/json" } })).status).toBe(403);
  // reused invite rejected
  const reuse = await app.request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite, username: "bob", password: "pw" }),
  });
  expect(reuse.status).toBe(403);
});

test("instances: pairing token, list with online flag, account isolation, rpc stamping", async () => {
  const { app, instances, login, rpcCalls } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const tokenRes = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  expect(tokenRes.status).toBe(200);
  const { token } = (await tokenRes.json()) as { token: string };
  const redeemed = instances.redeemPairingToken(token)!;

  const listRes = await app.request("/api/instances", { headers: { cookie } });
  const { instances: listed } = (await listRes.json()) as { instances: Array<{ id: string; online: boolean }> };
  expect(listed[0]?.id).toBe(redeemed.instanceId);
  expect(listed[0]?.online).toBe(true);

  // rpc: stamps chatKey/senderId/isOwner server-side, ignoring client-supplied values
  const rpcRes = await app.request(`/api/instances/${redeemed.instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.prompt, payload: { chatKey: "forged", senderId: "forged", sessionAlias: "s", text: "hi" } }),
  });
  expect(rpcRes.status).toBe(200);
  const stamped = rpcCalls[0]?.payload as { chatKey: string; senderId: string; isOwner: boolean };
  expect(stamped.chatKey).toBe(`relay:${redeemed.accountId}`);
  expect(stamped.senderId).toBe(redeemed.accountId);
  expect(stamped.isOwner).toBe(true);

  // non-control types rejected; foreign instance 404
  expect((await app.request(`/api/instances/${redeemed.instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "instance.register", payload: {} }),
  })).status).toBe(400);
  expect((await app.request(`/api/instances/not-mine/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.sessionsList, payload: {} }),
  })).status).toBe(404);
});

test("rpc command.execute echoes input and output into history", async () => {
  const { app, instances, gateway, messages, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const tokenRes = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const { instanceId, accountId } = instances.redeemPairingToken(token)!;

  (gateway as unknown as { sendRequest: () => Promise<unknown> }).sendRequest = async () => ({ output: "ran ok" });

  const res = await app.request(`/api/instances/${instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.commandExecute, payload: { sessionAlias: "s", text: "/status" } }),
  });
  expect(res.status).toBe(200);
  const cached = messages.listBySession(accountId, instanceId, "s");
  expect(cached.map((m) => [m.direction, m.text])).toEqual([["in", "/status"], ["out", "ran ok"]]);
});

test("rpc prompt persists the inbound message before the turn's out message (history order)", async () => {
  const { app, instances, gateway, messages, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const tokenRes = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const { instanceId, accountId } = instances.redeemPairingToken(token)!;

  // Real flow: the agent's turn-finished fires (appending "out") WHILE
  // sendRequest is still awaiting, before it resolves. Simulate that here.
  (gateway as unknown as { sendRequest: () => Promise<unknown> }).sendRequest = async () => {
    messages.append(instanceId, "s", "out", "agent reply");
    return {};
  };

  const res = await app.request(`/api/instances/${instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.prompt, payload: { sessionAlias: "s", text: "hi" } }),
  });
  expect(res.status).toBe(200);
  const cached = messages.listBySession(accountId, instanceId, "s");
  expect(cached.map((m) => [m.direction, m.text])).toEqual([["in", "hi"], ["out", "agent reply"]]);
});

test("GET /api/config returns the retention policy from deps", async () => {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  accounts.createAccount("admin", "admin-pw", "admin");
  const messages = new MessageStore(db);
  const gateway = {
    isOnline: () => true,
    sendRequest: async () => ({}),
  };
  const app = createApp({
    accounts, instances, gateway, messages,
    historyRetentionDays: 14, maxMessagesPerSession: 500,
  });
  const loginRes = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pw" }),
  });
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  const res = await app.request("/api/config", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ historyRetention: { days: 14, maxPerSession: 500 } });
});

test("pairing-token rejects non-JSON bodies with 415", async () => {
  const { app, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const res = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "text/plain" }, body: JSON.stringify({ name: "pc" }),
  });
  expect(res.status).toBe(415);
});

test("invites rejects non-JSON bodies with 415", async () => {
  const { app, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const res = await app.request("/api/invites", {
    method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "whatever",
  });
  expect(res.status).toBe(415);
});

test("login rate-limiter evicts expired entries", async () => {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  accounts.createAccount("admin", "admin-pw", "admin");
  const messages = new MessageStore(db);
  const gateway = { isOnline: () => true, sendRequest: async () => ({}) };
  let clock = 0;
  const app = createApp({ accounts, instances, gateway, messages, now: () => new Date(clock) });
  const fail = (username: string) =>
    app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "nope" }),
    });

  const LOGIN_WINDOW_MS = 10 * 60 * 1000;
  const LOGIN_MAX_FAILURES = 10;

  // T=0: drive "u1" into the 429 state. The handler returns 401 on the request that reaches the
  // Nth failure and 429 only once a *subsequent* request sees count >= MAX, so it takes
  // LOGIN_MAX_FAILURES 401s before the next attempt is throttled.
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await fail("u1")).status).toBe(401);
  expect((await fail("u1")).status).toBe(429); // window is "hot"

  // Advance past the window so "u1"'s entry is stale, then drive enough distinct usernames to push
  // the failures map over the sweep threshold so the time-based eviction sweep runs and drops "u1".
  clock += LOGIN_WINDOW_MS + 1;
  for (let i = 0; i < 1100; i++) await fail(`flood-${i}`);

  // The stale "u1" entry must no longer count: a fresh failure starts a brand-new window, so it
  // again takes the full LOGIN_MAX_FAILURES failures before 429 (not immediately throttled). This
  // proves the entry was treated as evicted/reset rather than retaining its old throttled state.
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await fail("u1")).status).toBe(401);
  expect((await fail("u1")).status).toBe(429);
});

test("rpc rejects non-JSON content-type (CSRF backstop) but accepts application/json", async () => {
  const { app, instances, login, rpcCalls } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const tokenRes = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  const { token } = (await tokenRes.json()) as { token: string };
  const { instanceId } = instances.redeemPairingToken(token)!;

  // text/plain simple-request is refused; gateway never called
  const bad = await app.request(`/api/instances/${instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "text/plain" },
    body: JSON.stringify({ type: MSG.commandExecute, payload: { text: "/danger" } }),
  });
  expect(bad.status).toBe(415);
  expect(rpcCalls.length).toBe(0);

  // application/json works
  const ok = await app.request(`/api/instances/${instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.sessionsList, payload: {} }),
  });
  expect(ok.status).toBe(200);
  expect(rpcCalls.length).toBe(1);
});
