import { expect, test } from "bun:test";

import { MSG } from "../../../../packages/relay-protocol/src/index";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";
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
  const app = createApp({ accounts, instances, gateway });
  const login = async (username: string, password: string) => {
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  return { app, accounts, instances, admin, gateway, rpcCalls, login };
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
  const inviteRes = await app.request("/api/invites", { method: "POST", headers: { cookie } });
  expect(inviteRes.status).toBe(200);
  const { invite } = (await inviteRes.json()) as { invite: string };
  const registerRes = await app.request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite, username: "alice", password: "alice-pw" }),
  });
  expect(registerRes.status).toBe(200);
  const { cookie: aliceCookie } = await login("alice", "alice-pw");
  expect((await app.request("/api/invites", { method: "POST", headers: { cookie: aliceCookie } })).status).toBe(403);
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
