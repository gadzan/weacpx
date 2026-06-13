// tests/unit/packages/relay-protocol/web-dtos.test.ts
import { expect, test } from "bun:test";
import {
  WEB_EVENT_TYPE,
  decodeEnvelope,
  encodeEnvelope,
  parseWebServerEvent,
  webEventEnvelope,
  type WebServerEvent,
} from "../../../../packages/relay-protocol/src/index";

test("webEventEnvelope wraps an event and round-trips through encode/decode", () => {
  const event: WebServerEvent = {
    kind: "control-event",
    instanceId: "i1",
    event: { type: "turn-output", chatKey: "relay:a1", sessionAlias: "backend", chunk: "hi" },
  };
  const wire = encodeEnvelope(webEventEnvelope(event));
  const decoded = decodeEnvelope(wire);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.envelope.type).toBe(WEB_EVENT_TYPE);
  expect(parseWebServerEvent(decoded.envelope)).toEqual(event);
});

test("parseWebServerEvent rejects non-web envelopes", () => {
  expect(parseWebServerEvent({ protocolVersion: 1, kind: "event", type: "instance.event", payload: {} } as never)).toBeNull();
});

test("instance-status and notice events are representable", () => {
  const status: WebServerEvent = { kind: "instance-status", instanceId: "i1", online: false };
  const notice: WebServerEvent = { kind: "notice", instanceId: "i1", notice: { kind: "task-completion", text: "done" } };
  expect(parseWebServerEvent(decodeOk(status))).toEqual(status);
  expect(parseWebServerEvent(decodeOk(notice))).toEqual(notice);
});

function decodeOk(event: WebServerEvent) {
  const decoded = decodeEnvelope(encodeEnvelope(webEventEnvelope(event)));
  if (!decoded.ok) throw new Error("decode failed");
  return decoded.envelope;
}

test("parseWebServerEvent rejects malformed payloads", () => {
  const wrap = (payload: unknown) => ({ protocolVersion: 1, kind: "event", type: WEB_EVENT_TYPE, payload }) as never;
  expect(parseWebServerEvent(wrap(null))).toBeNull();
  expect(parseWebServerEvent(wrap("nope"))).toBeNull();
  expect(parseWebServerEvent(wrap({ kind: "future-variant", instanceId: "i1" }))).toBeNull();
  expect(parseWebServerEvent(wrap({ kind: "instance-status", instanceId: "i1" }))).toBeNull(); // missing online
  expect(parseWebServerEvent(wrap({ kind: "instance-status", online: true }))).toBeNull(); // missing instanceId
  expect(parseWebServerEvent(wrap({ kind: "control-event", instanceId: "i1", event: "x" }))).toBeNull();
  expect(parseWebServerEvent(wrap({ kind: "notice", instanceId: "i1", notice: 5 }))).toBeNull();
});
