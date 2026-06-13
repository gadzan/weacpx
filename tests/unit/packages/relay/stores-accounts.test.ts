import { expect, test } from "bun:test";

import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";

async function makeStore(nowIso = "2026-06-13T10:00:00.000Z") {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  let now = new Date(nowIso);
  const store = new AccountStore(db, { now: () => now });
  return { store, setNow: (iso: string) => { now = new Date(iso); } };
}

test("createAccount + verifyLogin happy/sad paths", async () => {
  const { store } = await makeStore();
  const admin = store.createAccount("admin", "pw-1", "admin");
  expect(admin.role).toBe("admin");
  expect(store.verifyLogin("admin", "pw-1")?.id).toBe(admin.id);
  expect(store.verifyLogin("admin", "wrong")).toBeNull();
  expect(store.verifyLogin("ghost", "pw-1")).toBeNull();
  expect(() => store.createAccount("admin", "pw-2", "member")).toThrow();
});

test("invite lifecycle: validate, single-use, expiry", async () => {
  const { store, setNow } = await makeStore();
  const admin = store.createAccount("admin", "pw", "admin");
  const invite = store.createInvite(admin.id, 60_000);
  expect(store.validateInvite(invite.token)).toBe(true);
  const member = store.createAccount("alice", "pw", "member");
  store.markInviteUsed(invite.token, member.id);
  expect(store.validateInvite(invite.token)).toBe(false); // single-use

  const expiring = store.createInvite(admin.id, 60_000);
  setNow("2026-06-13T10:02:00.000Z");
  expect(store.validateInvite(expiring.token)).toBe(false); // expired
});

test("web session create/get/expire/delete", async () => {
  const { store, setNow } = await makeStore();
  const account = store.createAccount("admin", "pw", "admin");
  const token = store.createWebSession(account.id, 60_000);
  expect(store.getSessionAccount(token)?.username).toBe("admin");
  expect(store.getSessionAccount("nope")).toBeNull();
  setNow("2026-06-13T10:02:00.000Z");
  expect(store.getSessionAccount(token)).toBeNull(); // expired
  const token2 = store.createWebSession(account.id, 60_000);
  store.deleteWebSession(token2);
  expect(store.getSessionAccount(token2)).toBeNull();
});
