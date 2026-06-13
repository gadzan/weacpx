// tests/unit/packages/relay/runtime-fanout.test.ts
import { expect, test } from "bun:test";
import {
  MSG, RELAY_PROTOCOL_VERSION, decodeEnvelope, parseWebServerEvent,
} from "../../../../packages/relay-protocol/src/index";
import { createRelayRuntime } from "../../../../packages/relay/src/server";

class FakeSocket {
  sent: string[] = [];
  on() { return this; }
  send(data: string) { this.sent.push(data); }
}

async function seeded() {
  const runtime = await createRelayRuntime(":memory:");
  runtime.db.run("INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)", ["a1", "u", "h", "member", "t"]);
  runtime.db.run("INSERT INTO instances (id, account_id, name, credential_hash, created_at) VALUES (?,?,?,?,?)", ["i1", "a1", "pc", "h", "t"]);
  return runtime;
}

test("control events broadcast to web sockets and turn output is cached on finish", async () => {
  const runtime = await seeded();
  const web = new FakeSocket();
  runtime.webGateway.register("a1", web as never);

  const fire = (event: unknown) => runtime.gateway["deps"].onEvent!("i1", "a1", {
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: { event },
  });

  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" });
  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "lo" });
  fire({ type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true });

  expect(web.sent.length).toBe(3);
  const first = decodeEnvelope(web.sent[0]!);
  expect(first.ok && parseWebServerEvent(first.envelope)).toEqual({
    kind: "control-event", instanceId: "i1",
    event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hel" },
  });

  const third = decodeEnvelope(web.sent[2]!);
  expect(third.ok && parseWebServerEvent(third.envelope)).toEqual({
    kind: "control-event", instanceId: "i1",
    event: { type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true },
  });

  const cached = runtime.messages.listBySession("a1", "i1", "backend");
  expect(cached.map((m) => [m.direction, m.text])).toEqual([["out", "hello"]]);

  runtime.close();
});

test("offline clears an in-flight turn buffer so a later finish flushes nothing", async () => {
  const runtime = await seeded();
  const fire = (event: unknown) => runtime.gateway["deps"].onEvent!("i1", "a1", {
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: { event },
  });
  fire({ type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "partial" });
  runtime.gateway["deps"].onStatusChange!("i1", "a1", false);
  fire({ type: "turn-finished", chatKey: "relay:a1", sessionAlias: "backend", ok: true });
  expect(runtime.messages.listBySession("a1", "i1", "backend")).toEqual([]);
  runtime.close();
});

test("status changes broadcast instance-status events", async () => {
  const runtime = await seeded();
  const web = new FakeSocket();
  runtime.webGateway.register("a1", web as never);
  runtime.gateway["deps"].onStatusChange!("i1", "a1", false);
  const decoded = decodeEnvelope(web.sent[0]!);
  expect(decoded.ok && parseWebServerEvent(decoded.envelope)).toEqual({ kind: "instance-status", instanceId: "i1", online: false });
  runtime.close();
});
