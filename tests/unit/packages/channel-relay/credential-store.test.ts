import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialStore } from "../../../../packages/channel-relay/src/credential-store";

test("load returns null before save; save/load/clear roundtrip with 0600 file", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "relay-cred-")), "nested", "credential.json");
  const store = new CredentialStore(filePath);
  expect(store.load()).toBeNull();
  const credential = { instanceId: "i-1", credential: "secret", relayUrl: "ws://h:8788" };
  store.save(credential);
  expect(store.load()).toEqual(credential);
  store.clear();
  expect(store.load()).toBeNull();
  store.clear(); // idempotent
});

test("load tolerates corrupt file content", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "relay-cred-")), "credential.json");
  writeFileSync(filePath, "{corrupt", "utf8");
  expect(new CredentialStore(filePath).load()).toBeNull();
});
