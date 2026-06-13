import { expect, test } from "bun:test";
import { WebSocketServer } from "ws";

import {
  MSG,
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  errorPayload,
  type RelayEnvelope,
} from "../../../../packages/relay-protocol/src/index";
import { RelayClient } from "../../../../packages/channel-relay/src/relay-client";
import type { RelayCredential } from "../../../../packages/channel-relay/src/credential-store";

class MemoryCredentialStore {
  constructor(private value: RelayCredential | null = null) {}
  load() { return this.value; }
  save(credential: RelayCredential) { this.value = credential; }
  clear() { this.value = null; }
}

async function makeFakeRelay(onEnvelope: (envelope: RelayEnvelope, reply: (env: RelayEnvelope) => void, raw: import("ws").WebSocket) => void) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const decoded = decodeEnvelope(String(data));
      if (decoded.ok) onEnvelope(decoded.envelope, (env) => socket.send(encodeEnvelope(env)), socket);
    });
  });
  return { wss, url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}` };
}

const res = (envelope: RelayEnvelope, payload: unknown): RelayEnvelope => ({
  protocolVersion: RELAY_PROTOCOL_VERSION, kind: "res", id: envelope.id, type: envelope.type, payload,
});

test("registers with pairing token, saves credential, reports ready", async () => {
  const { wss, url } = await makeFakeRelay((envelope, reply) => {
    if (envelope.type === MSG.instanceRegister) {
      expect((envelope.payload as { pairingToken: string }).pairingToken).toBe("pair-1");
      reply(res(envelope, { instanceId: "i-1", credential: "cred-1" }));
    }
  });
  const store = new MemoryCredentialStore();
  const controller = new AbortController();
  const ready = new Promise<void>((resolve) => {
    const client = new RelayClient({
      url, credentialStore: store, pairingToken: "pair-1", coreVersion: "0.11.0",
      onRequest: () => {}, onReady: resolve, reconnectDelaysMs: [0],
    });
    client.start(controller.signal);
  });
  await ready;
  expect(store.load()).toEqual({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  controller.abort();
  wss.close();
});

test("auths with stored credential, dispatches incoming req to onRequest, sends events", async () => {
  const seen: RelayEnvelope[] = [];
  let instanceSocketSend: ((env: RelayEnvelope) => void) | undefined;
  const { wss, url } = await makeFakeRelay((envelope, reply) => {
    seen.push(envelope);
    if (envelope.type === MSG.instanceAuth) {
      reply(res(envelope, { ok: true }));
      instanceSocketSend = reply;
      // immediately push a control req at the instance
      reply({ protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "r-1", type: MSG.sessionsList, payload: {} });
    }
  });
  const store = new MemoryCredentialStore({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  const controller = new AbortController();
  const client = new RelayClient({
    url, credentialStore: store,
    onRequest: (envelope, respond) => {
      if (envelope.type === MSG.sessionsList) respond({ sessions: [] });
    },
    reconnectDelaysMs: [0],
  });
  client.start(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const resEnvelope = seen.find((e) => e.kind === "res" && e.id === "r-1");
  expect(resEnvelope?.payload).toEqual({ sessions: [] });

  client.sendEvent(MSG.instanceEvent, { event: { type: "sessions-changed" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(seen.some((e) => e.kind === "event" && e.type === MSG.instanceEvent)).toBe(true);
  controller.abort();
  wss.close();
});

test("reconnects after a drop; fatal handshake rejection stops retrying", async () => {
  let connections = 0;
  const { wss, url } = await makeFakeRelay((envelope, reply, raw) => {
    if (envelope.type === MSG.instanceAuth) {
      connections += 1;
      if (connections === 1) {
        reply(res(envelope, { ok: true }));
        setTimeout(() => raw.close(), 20); // drop after handshake -> should reconnect
      } else {
        reply(res(envelope, errorPayload("auth-failed", "bad credential"))); // fatal -> stop
      }
    }
  });
  const store = new MemoryCredentialStore({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  const controller = new AbortController();
  const client = new RelayClient({ url, credentialStore: store, onRequest: () => {}, reconnectDelaysMs: [0] });
  client.start(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(connections).toBe(2); // reconnected once, then stopped after fatal rejection
  controller.abort();
  wss.close();
});
